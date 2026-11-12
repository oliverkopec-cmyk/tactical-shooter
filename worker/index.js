// Breachline on Cloudflare Workers. So far: the HTTP API (Stage C2) and the match rooms (Stage C3). The menus' live
// features (friends online, parties, gifts, admin) still run on the Node server until Stage C4, and the game's files
// come here in Stage C5.
//
// - /api/...: server/api.js, the same code the Node server serves, with Neon through HTTP (server/dbHttp.js).
// - POST /api/rooms: a new room. Claims a free 4-letter code; that code's MatchRoom Durable Object is the room.
// - /room/<CODE>/ws: a player's connection to a room (worker/matchRoom.js), once the login cookie is checked.
// - Password checks run in a Durable Object (Passwords, below). A plain Worker request on the free plan gets 10 ms
//   of CPU, and checking a password takes 17 ms (PBKDF2) or 176 ms (an old bcrypt hash) (Stage C0). A Durable
//   Object gets 30 seconds.
// - Every hour (cron): expired sessions are deleted.
//
// Settings: DATABASE_URL, OWNER_USERNAME, ADMIN_USERNAMES and TESTER_USERNAMES are Cloudflare secrets (or .dev.vars
// locally). nodejs_compat puts them in process.env, where the shared server code reads them.

import { DurableObject } from 'cloudflare:workers';
import { neonHttpDb } from '../server/dbHttp.js';
import { Accounts, loadoutOf } from '../server/accounts.js';
import { Moderation } from '../server/moderation.js';
import { createApi } from '../server/api.js';
import { hashPassword, verifyPassword, rejectSlowly } from '../server/passwords.js';
import { ROOM_CODE_LENGTH } from '../shared/constants.js';
import { SHARED_VERSION } from './generated/sharedVersion.js';
import { refuseSocket } from './sockets.js';

export { MatchRoom } from './matchRoom.js';

// No I or O, so codes can't be confused with 1 / 0 (as server/rooms.js)
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const randomCode = () => Array.from({ length: ROOM_CODE_LENGTH }, () => CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]).join('');

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

const roomStub = (env, code) => env.MATCH_ROOMS.get(env.MATCH_ROOMS.idFromName(code));

/** POST /api/rooms: a free code, claimed in its own MatchRoom object (it refuses a code that is in use). */
async function createRoom(request, env, app) {
  const found = await app.accounts.fromCookie(request.headers.get('cookie'));
  if (!found) return Response.json({ error: 'Not logged in.' }, { status: 401 });
  for (let attempt = 0; attempt < 20; attempt++) {
    const code = randomCode();
    if ((await roomStub(env, code).claim(code)).ok) return Response.json({ ok: true, code });
  }
  return Response.json({ error: 'No free room codes. Try again.' }, { status: 503 });
}

/** /room/<CODE>/ws: check the page's version and the login, then hand the WebSocket to that room. */
async function joinRoom(request, env, app, code, url) {
  if (request.headers.get('upgrade') !== 'websocket') return new Response('Expected a WebSocket', { status: 426 });
  const version = url.searchParams.get('v');
  if (version !== SHARED_VERSION && version !== 'dev') return refuseSocket('outdated');
  const found = await app.accounts.fromCookie(request.headers.get('cookie'));
  if (!found) return refuseSocket('unauthorized');
  const account = { id: found.row.id, username: found.row.username, ...loadoutOf(found.row) };
  const headers = new Headers(request.headers);
  headers.set('x-account', JSON.stringify(account));
  headers.set('x-mode', ['spectate', 'attack', 'defense'].includes(url.searchParams.get('as')) ? url.searchParams.get('as') : 'play');
  return roomStub(env, code).fetch(new Request(request.url, { method: 'GET', headers }));
}

// Built once per Worker instance, on its first request
let ready = null;
function setup(env) {
  ready ||= (async () => {
    if (!env.DATABASE_URL) throw new Error('DATABASE_URL is not set (a Cloudflare secret, or .dev.vars locally).');
    const db = neonHttpDb(env.DATABASE_URL, { fetchEndpoint: env.NEON_FETCH_ENDPOINT });
    const accounts = new Accounts(db, { background: false, passwords: remotePasswords(env) });
    accounts.moderation = new Moderation({ db, accounts, io: null, background: false });
    return { db, accounts, api: createApi(accounts, { session: { rooms: 'worker' } }) };
  })().catch((err) => { ready = null; throw err; });
  return ready;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/healthz') return new Response('ok');
    const roomSocket = url.pathname.match(/^\/room\/([A-Za-z]{4})\/ws$/);
    if (!url.pathname.startsWith('/api/') && !roomSocket) {
      return new Response('Breachline on Cloudflare: the API and match rooms so far. The game comes in Stage C5.\n', {
        status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' },
      });
    }
    let app;
    try { app = await setup(env); } catch (err) {
      console.error(err.message);
      return roomSocket ? refuseSocket('server error') : Response.json({ error: 'The server is not set up yet.' }, { status: 503 });
    }
    if (roomSocket) return joinRoom(request, env, app, roomSocket[1].toUpperCase(), url);
    if (url.pathname === '/api/rooms' && request.method === 'POST') return createRoom(request, env, app);
    return app.api.handle(request, {
      ip: request.headers.get('cf-connecting-ip') || '',
      secure: url.protocol === 'https:',
    });
  },

  // Hourly: delete expired sessions (the Node server also does this while it runs)
  async scheduled(_event, env, ctx) {
    const { db } = await setup(env);
    ctx.waitUntil(db.query('DELETE FROM sessions WHERE expires_at < now()'));
  },
};
