// Breachline on Cloudflare Workers. Stage C2: the HTTP API (/api/...) only. The game itself, its match rooms and
// the online features still run on the Node server on Render, and come here in later stages (C3 to C5).
//
// - /api/...: server/api.js, the same code the Node server serves, with Neon through HTTP (server/dbHttp.js).
// - Password checks run in a Durable Object (Passwords, below). A plain Worker request on the free plan gets 10 ms
//   of CPU, and checking a password takes 17 ms (PBKDF2) or 176 ms (an old bcrypt hash) (Stage C0). A Durable
//   Object gets 30 seconds.
// - Every hour (cron): expired sessions are deleted.
//
// Settings: DATABASE_URL, OWNER_USERNAME, ADMIN_USERNAMES and TESTER_USERNAMES are Cloudflare secrets (or .dev.vars
// locally). nodejs_compat puts them in process.env, where the shared server code reads them.

import { DurableObject } from 'cloudflare:workers';
import { neonHttpDb } from '../server/dbHttp.js';
import { Accounts } from '../server/accounts.js';
import { Moderation } from '../server/moderation.js';
import { createApi } from '../server/api.js';
import { hashPassword, verifyPassword, rejectSlowly } from '../server/passwords.js';

const PASSWORD_OBJECTS = 8;   // spread log-ins over a few objects, so a burst of them doesn't queue behind one

export class Passwords extends DurableObject {
  hash(password) { return hashPassword(password); }
  verify(password, stored) { return verifyPassword(password, stored); }
  reject(password) { return rejectSlowly(password); }
}

/** The password functions, each call run in one of the Passwords objects. */
function remotePasswords(env) {
  const stub = () => env.PASSWORDS.get(env.PASSWORDS.idFromName(`passwords-${Math.floor(Math.random() * PASSWORD_OBJECTS)}`));
  return {
    hash: (password) => stub().hash(password),
    verify: (password, stored) => stub().verify(password, stored),
    reject: (password) => stub().reject(password),
  };
}

// Built once per Worker instance, on its first request
let ready = null;
function setup(env) {
  ready ||= (async () => {
    if (!env.DATABASE_URL) throw new Error('DATABASE_URL is not set (a Cloudflare secret, or .dev.vars locally).');
    const db = neonHttpDb(env.DATABASE_URL, { fetchEndpoint: env.NEON_FETCH_ENDPOINT });
    const accounts = new Accounts(db, { background: false, passwords: remotePasswords(env) });
    accounts.moderation = new Moderation({ db, accounts, io: null, background: false });
    return { db, api: createApi(accounts) };
  })().catch((err) => { ready = null; throw err; });
  return ready;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/healthz') return new Response('ok');
    if (url.pathname.startsWith('/api/')) {
      let app;
      try { app = await setup(env); } catch (err) {
        console.error(err.message);
        return Response.json({ error: 'The server is not set up yet.' }, { status: 503 });
      }
      return app.api.handle(request, {
        ip: request.headers.get('cf-connecting-ip') || '',
        secure: url.protocol === 'https:',
      });
    }
    return new Response('Breachline on Cloudflare: Stage C2 serves only the API (/api/...). The game comes in Stage C5.\n', {
      status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  },

  // Hourly: delete expired sessions (the Node server also does this while it runs)
  async scheduled(_event, env, ctx) {
    const { db } = await setup(env);
    ctx.waitUntil(db.query('DELETE FROM sessions WHERE expires_at < now()'));
  },
};
