// Breachline on Cloudflare Workers: the whole game on one site, so the login cookie works everywhere.
// - The game's files (dist/, built by `npm run build`) are Workers static assets (wrangler.jsonc, Stage C5): served
//   without running this code.
// - /api/...: server/api.js, the same code the Node server serves, with Neon through HTTP (server/dbHttp.js). The
//   friends routes go to the central object, which knows who is online.
// - /ws: a page's main connection, to the central object (worker/central.js), once the login cookie is checked.
// - /room/<CODE>/ws: a player's connection to a room (worker/matchRoom.js), the same way. The central object claims
//   the code when a player creates a room.
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
import { SHARED_VERSION } from './generated/sharedVersion.js';
import { refuseSocket } from './sockets.js';
import { emptyCounts, hasCounts } from './usage.js';

export { MatchRoom } from './matchRoom.js';
export { Central } from './central.js';


// Usage (Stage C6): this Worker instance's requests (and its calls to the Passwords objects) since it last told the
// central object, which keeps the day's total (worker/usage.js). Told about once a minute, or every 50 requests.
let meter = emptyCounts();
let meterSentAt = Date.now();
function countRequest(env, ctx) {
  meter.workerRequests++;
  if (meter.workerRequests < 50 && Date.now() - meterSentAt < 60_000) return;
  const delta = meter;
  meter = emptyCounts();
  meterSentAt = Date.now();
  if (hasCounts(delta)) ctx.waitUntil(centralStub(env).usageReport(delta).catch(() => {}));
}

const PASSWORD_OBJECTS = 8;   // spread log-ins over a few objects, so a burst of them doesn't queue behind one

export class Passwords extends DurableObject {
  hash(password) { return hashPassword(password); }
  verify(password, stored) { return verifyPassword(password, stored); }
  reject(password) { return rejectSlowly(password); }
}

/** The password functions, each call run in one of the Passwords objects. */
function remotePasswords(env) {
  const stub = () => {
    meter.doCalls++;   // each check is a request to a Durable Object
    return env.PASSWORDS.get(env.PASSWORDS.idFromName(`passwords-${Math.floor(Math.random() * PASSWORD_OBJECTS)}`));
  };
  return {
    hash: (password) => stub().hash(password),
    verify: (password, stored) => stub().verify(password, stored),
    reject: (password) => stub().reject(password),
  };
}

const roomStub = (env, code) => env.MATCH_ROOMS.get(env.MATCH_ROOMS.idFromName(code));

const centralStub = (env) => env.CENTRAL.get(env.CENTRAL.idFromName('central'));

/** Check a page's version and login for a WebSocket: { account, tokenHash } or a refused socket. */
async function socketLogin(request, app, url) {
  if (request.headers.get('upgrade') !== 'websocket') return { refused: new Response('Expected a WebSocket', { status: 426 }) };
  const version = url.searchParams.get('v');
  if (version !== SHARED_VERSION && version !== 'dev') return { refused: refuseSocket('outdated') };
  const found = await app.accounts.fromCookie(request.headers.get('cookie'));
  if (!found) return { refused: refuseSocket('unauthorized') };
  return { account: { id: found.row.id, username: found.row.username, ...loadoutOf(found.row) }, tokenHash: found.tokenHash };
}

/** /ws: the page's main connection, to the central object. */
async function joinCentral(request, env, app, url) {
  const login = await socketLogin(request, app, url);
  if (login.refused) return login.refused;
  const headers = new Headers(request.headers);
  headers.set('x-account', JSON.stringify(login.account));
  headers.set('x-token', login.tokenHash);
  return centralStub(env).fetch(new Request(request.url, { method: 'GET', headers }));
}

/** /api/friends...: run by the central object, which knows who is online and can tell them straight away. */
async function friendsApi(request, env, app, url) {
  const found = await app.accounts.fromCookie(request.headers.get('cookie'));
  if (!found) return Response.json({ error: 'Not logged in.' }, { status: 401 });
  const op = { 'GET /api/friends': 'list', 'GET /api/friends/search': 'search', 'POST /api/friends/request': 'request', 'POST /api/friends/respond': 'respond', 'POST /api/friends/remove': 'remove' }[`${request.method} ${url.pathname}`];
  if (!op) return Response.json({ error: 'Not found.' }, { status: 404 });
  if (op === 'search' && app.accounts.lookupLimited(request.headers.get('cf-connecting-ip') || '')) return Response.json({ error: 'Too many searches. Wait a minute.' }, { status: 429 });
  let args = op === 'search' ? { q: url.searchParams.get('q') } : {};
  if (request.method === 'POST') { try { args = await request.json(); } catch { return Response.json({ error: 'Bad request.' }, { status: 400 }); } }
  const { status, body } = await centralStub(env).friends(found.row.id, op, args && typeof args === 'object' ? args : {});
  return Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

/** /room/<CODE>/ws: check the page's version and the login, then hand the WebSocket to that room. */
async function joinRoom(request, env, app, code, url) {
  const login = await socketLogin(request, app, url);
  if (login.refused) return login.refused;
  const headers = new Headers(request.headers);
  headers.set('x-account', JSON.stringify(login.account));
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
    // Logging out closes that session's connection, which is in the central object
    accounts.kickSession = (accountId, tokenHash) => centralStub(env).kickSession(accountId, tokenHash).catch(() => {});
    accounts.moderation = new Moderation({ db, accounts, io: null, background: false });
    return { db, accounts, api: createApi(accounts, { session: { rooms: 'worker' } }) };
  })().catch((err) => { ready = null; throw err; });
  return ready;
}

export default {
  async fetch(request, env, ctx) {
    countRequest(env, ctx);   // everything that reaches this code is a Worker request (the game's files never do)
    const url = new URL(request.url);
    if (url.pathname === '/healthz') return new Response('ok');
    const roomSocket = url.pathname.match(/^\/room\/([A-Za-z]{4})\/ws$/);
    const mainSocket = url.pathname === '/ws';
    // The game's files are served before this runs (wrangler.jsonc "assets"): anything else unknown is a 404
    if (!url.pathname.startsWith('/api/') && !roomSocket && !mainSocket) {
      return new Response('Not found\n', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });
    }
    let app;
    try { app = await setup(env); } catch (err) {
      console.error(err.message);
      return roomSocket || mainSocket ? refuseSocket('server error') : Response.json({ error: 'The server is not set up yet.' }, { status: 503 });
    }
    if (mainSocket) return joinCentral(request, env, app, url);
    if (roomSocket) return joinRoom(request, env, app, roomSocket[1].toUpperCase(), url);
    if (url.pathname === '/api/friends' || url.pathname.startsWith('/api/friends/')) return friendsApi(request, env, app, url);
    return app.api.handle(request, {
      ip: request.headers.get('cf-connecting-ip') || '',
      secure: url.protocol === 'https:',
    });
  },

  // Hourly: delete expired sessions (the Node server also does this while it runs)
  async scheduled(_event, env, ctx) {
    countRequest(env, ctx);
    const { db } = await setup(env);
    ctx.waitUntil(db.query('DELETE FROM sessions WHERE expires_at < now()'));
  },
};
