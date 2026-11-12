// The HTTP API under /api (Stage C2): sign-up, log-in, the profile, equipping, friends, the shop and crates.
//
// Written against the web's standard Request and Response, so the same code runs in two places:
//   - the Node server on Render, mounted into Express by server/httpApi.js
//   - the Cloudflare Worker (worker/index.js)
// handle(request, { ip, secure }) -> Response. ip: the player's address (for rate limits); secure: served over HTTPS.
//
// Things that need the live game connection (kicking a logged-out tab, refreshing a connected player's loadout,
// friends' online status) go through `accounts`, and do nothing where there is no live connection (the Worker, until
// Stage C4).

import { usernameError, passwordError } from '../shared/account.js';
import { sanitizeSettings } from '../shared/settings.js';
import { profileOf, ownsSkin, equippedSkinsOf, equippedOperatorsOf, devToolsEnabled, ownsCharm, equippedCharmsOf, equippedAttachmentsOf } from './profile.js';
import { OPERATORS } from '../shared/operators.js';
import { CRATE } from '../shared/skins.js';
import { SLOTS, optionsFor, cleanAttachments } from '../shared/attachments.js';
import { shopState, purchase, openCrate, rollChristmasCrate } from './shop.js';
import { CHRISTMAS, christmasOn } from '../shared/christmas.js';
import { christmasNow } from './christmas.js';
import { WEAPONS } from '../shared/weapons.js';
import { ownedOperatorIds } from '../shared/account.js';
import { COOKIE, SESSION_DAYS, readCookie } from './accounts.js';

const MAX_BODY_BYTES = 8 * 1024;

const json = (status, body, cookie = null) => {
  const headers = new Headers({ 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  if (cookie) headers.append('set-cookie', cookie);
  return new Response(JSON.stringify(body), { status, headers });
};

/** The login cookie: only the server can read it (httpOnly), sent back for 90 days. */
const sessionCookie = (token, secure) => `${COOKIE}=${encodeURIComponent(token)}; Max-Age=${SESSION_DAYS * 24 * 60 * 60}; Path=/; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
const clearedCookie = () => `${COOKIE}=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT`;

/** options.session: extra fields for /api/session (the Worker says its rooms are on Cloudflare: { rooms: 'worker' }). */
export function createApi(accounts, { session: sessionExtras = {} } = {}) {
  const db = accounts.db;
  const progression = accounts.progression;
  const social = accounts.social;
  const routes = new Map();   // "METHOD /path" -> handler(ctx) -> Response
  const route = (method, path, handler) => routes.set(`${method} ${path}`, handler);

  /** Only for a logged-in browser: handler(ctx, row). */
  const authed = (handler) => async (ctx) => {
    const found = await accounts.fromCookie(ctx.cookies);
    if (!found) return json(401, { error: 'Not logged in.' });
    return handler(ctx, found.row, found);
  };
  const answer = (out) => { const { status, ...rest } = out; return json(status || 200, rest); };

  route('GET', '/session', async (ctx) => {
    const found = await accounts.fromCookie(ctx.cookies, { withBlocked: true });
    if (found?.block) return json(200, { account: null, blocked: accounts.moderation.blockMessage(found.block), storage: db.kind, ...sessionExtras });
    let cookie = null;
    if (found) {
      // Each visit pushes the expiry back, so regular players never get logged out.
      await db.query(`UPDATE sessions SET expires_at = now() + interval '${SESSION_DAYS} days' WHERE token_hash = $1`, [found.tokenHash]);
      cookie = sessionCookie(readCookie(ctx.cookies, COOKIE), ctx.secure);
    }
    const row = found ? await progression.ensureQuests(found.row) : null;
    return json(200, { account: row ? profileOf(row) : null, storage: db.kind, ...sessionExtras }, cookie);
  });

  route('POST', '/signup', async (ctx) => {
    if (accounts.rateLimited(ctx.ip)) return json(429, { error: 'Too many attempts. Try again in a few minutes.' });
    const { username, password } = ctx.body || {};
    const err = usernameError(username) || passwordError(password);
    if (err) return json(400, { error: err });

    const hash = await accounts.passwords.hash(password);
    const { rows } = await db.query(
      `INSERT INTO accounts (username, username_lower, password_hash) VALUES ($1, $2, $3)
       ON CONFLICT (username_lower) DO NOTHING RETURNING *`,
      [username, username.toLowerCase(), hash],
    );
    if (!rows[0]) return json(409, { error: 'That username is taken.' });
    const token = await accounts.createSession(rows[0].id);
    return json(200, { account: profileOf(await progression.ensureQuests(rows[0])) }, sessionCookie(token, ctx.secure));
  });

  route('POST', '/login', async (ctx) => {
    if (accounts.rateLimited(ctx.ip)) return json(429, { error: 'Too many attempts. Try again in a few minutes.' });
    const { username, password } = ctx.body || {};
    if (typeof username !== 'string' || typeof password !== 'string') return json(400, { error: 'Enter your username and password.' });

    const { rows } = await db.query('SELECT * FROM accounts WHERE username_lower = $1', [username.toLowerCase()]);
    const row = rows[0];
    const check = row ? await accounts.passwords.verify(password, row.password_hash) : await accounts.passwords.reject(password);
    if (!row || !check.ok) return json(401, { error: 'Wrong username or password.' });
    if (check.upgrade) {
      // An old bcrypt hash and the right password: store a PBKDF2 hash in its place (only if it hasn't changed meanwhile)
      await db.query('UPDATE accounts SET password_hash = $2 WHERE id = $1 AND password_hash = $3', [row.id, check.upgrade, row.password_hash])
        .catch((e) => console.error('Password upgrade failed:', e.message));
    }
    const block = accounts.moderation ? await accounts.moderation.blockOf(row.id) : null;
    if (block) return json(403, { error: accounts.moderation.blockMessage(block) });
    const token = await accounts.createSession(row.id);
    return json(200, { account: profileOf(await progression.ensureQuests(row)) }, sessionCookie(token, ctx.secure));
  });

  route('POST', '/logout', async (ctx) => {
    const found = await accounts.fromCookie(ctx.cookies);
    if (found) {
      await db.query('DELETE FROM sessions WHERE token_hash = $1', [found.tokenHash]);
      accounts.kickSession(found.row.id, found.tokenHash);
    }
    return json(200, { ok: true }, clearedCookie());
  });

  route('PUT', '/settings', authed(async (ctx, row) => {
    const clean = sanitizeSettings(ctx.body?.settings);
    await db.query('UPDATE accounts SET settings = $2 WHERE id = $1', [row.id, JSON.stringify(clean)]);
    return json(200, { settings: clean });
  }));

  // Equip a skin on a gun (skin: null puts the gun back to its default look)
  route('PUT', '/equip/skin', authed(async (ctx, row) => {
    const { weapon, skin } = ctx.body || {};
    if (!WEAPONS[weapon]) return json(400, { error: 'Unknown gun.' });
    if (skin !== null && !ownsSkin(row, weapon, skin)) return json(403, { error: 'You don\'t own that skin.' });
    const equipped = { ...equippedSkinsOf(row) };
    if (skin === null) delete equipped[weapon]; else equipped[weapon] = skin;
    const { rows } = await db.query('UPDATE accounts SET equipped_skins = $2 WHERE id = $1 RETURNING *', [row.id, JSON.stringify(equipped)]);
    accounts.refreshSocketLoadout(rows[0]);
    return json(200, { account: profileOf(rows[0]) });
  }));

  // Equip a charm on a gun (charm: null takes it off)
  route('PUT', '/equip/charm', authed(async (ctx, row) => {
    const { weapon, charm } = ctx.body || {};
    if (!WEAPONS[weapon]) return json(400, { error: 'Unknown gun.' });
    if (charm !== null && !ownsCharm(row, charm)) return json(403, { error: 'You don\'t own that charm.' });
    const equipped = { ...equippedCharmsOf(row) };
    if (charm === null) delete equipped[weapon]; else equipped[weapon] = charm;
    const { rows } = await db.query('UPDATE accounts SET equipped_charms = $2 WHERE id = $1 RETURNING *', [row.id, JSON.stringify(equipped)]);
    accounts.refreshSocketLoadout(rows[0]);
    return json(200, { account: profileOf(rows[0]) });
  }));

  // Fit an attachment on a gun (value: null puts the gun's own back). Only what is allowed on that gun gets through.
  route('PUT', '/equip/attachment', authed(async (ctx, row) => {
    const { weapon, slot, value } = ctx.body || {};
    if (!WEAPONS[weapon]) return json(400, { error: 'Unknown gun.' });
    if (!SLOTS.includes(slot)) return json(400, { error: 'Unknown slot.' });
    if (value !== null && !optionsFor(WEAPONS[weapon])[slot].includes(value)) return json(400, { error: 'That doesn\'t fit this gun.' });
    const equipped = { ...equippedAttachmentsOf(row) };
    const att = { ...equipped[weapon] };
    if (value === null) delete att[slot]; else att[slot] = value;
    const clean = cleanAttachments(WEAPONS[weapon], att);
    if (clean) equipped[weapon] = clean; else delete equipped[weapon];
    const { rows } = await db.query('UPDATE accounts SET equipped_attachments = $2 WHERE id = $1 RETURNING *', [row.id, JSON.stringify(equipped)]);
    accounts.refreshSocketLoadout(rows[0]);
    return json(200, { account: profileOf(rows[0]) });
  }));

  // Equip an operator for their side; it is also the one shown in the main menu
  route('PUT', '/equip/operator', authed(async (ctx, row) => {
    const op = OPERATORS[ctx.body?.operator];
    if (!op) return json(400, { error: 'Unknown operator.' });
    if (!ownedOperatorIds(row.owned_operators).includes(op.id)) return json(403, { error: 'You don\'t own that operator.' });
    const equipped = { ...equippedOperatorsOf(row), [op.team]: op.id, menu: op.id };
    const { rows } = await db.query('UPDATE accounts SET equipped_operators = $2 WHERE id = $1 RETURNING *', [row.id, JSON.stringify(equipped)]);
    accounts.refreshSocketLoadout(rows[0]);
    return json(200, { account: profileOf(rows[0]) });
  }));

  // ---------------------------------------------------------------- friends

  route('GET', '/friends', authed(async (_ctx, row) => json(200, await social.list(row.id))));
  route('GET', '/friends/search', authed(async (ctx, row) => {
    // A few searches a second is plenty; more looks like someone listing every username
    if (accounts.lookupLimited(ctx.ip)) return json(429, { error: 'Too many searches. Wait a minute.' });
    return json(200, { results: await social.search(row.id, ctx.url.searchParams.get('q')) });
  }));
  route('POST', '/friends/request', authed(async (ctx, row) => answer(await social.request(row.id, ctx.body?.username))));
  route('POST', '/friends/respond', authed(async (ctx, row) => answer(await social.respond(row.id, Number(ctx.body?.id), !!ctx.body?.accept))));
  route('POST', '/friends/remove', authed(async (ctx, row) => answer(await social.remove(row.id, Number(ctx.body?.id)))));

  // ---------------------------------------------------------------- the shop (server/shop.js)

  // What is on sale now (the same for everyone), with this account's prices and what it owns
  route('GET', '/shop', authed(async (_ctx, row) => json(200, shopState(row, Date.now(), christmasNow()))));

  // Buy a daily item or a Limited skin. The server checks it is on sale now and what it costs; Money only.
  route('POST', '/shop/buy', authed(async (ctx, account) => {
    const out = await progression.withLock(account.id, async () => {
      const row = (await db.query('SELECT * FROM accounts WHERE id = $1', [account.id])).rows[0];
      if (!row) return { status: 404, body: { error: 'Account not found.' } };
      const buy = purchase(row, ctx.body?.id);
      if (buy.error) return { status: 400, body: { error: buy.error, account: profileOf(row) } };
      if (row.money < buy.price) return { status: 402, body: { error: `Not enough Money: that costs ${buy.price.toLocaleString()}.`, account: profileOf(row) } };
      const { rows } = await db.query(
        'UPDATE accounts SET money = money - $2, owned_skins = owned_skins || $3::jsonb WHERE id = $1 AND money >= $2 RETURNING *',
        [row.id, buy.price, JSON.stringify(buy.add)],
      );
      if (!rows.length) return { status: 402, body: { error: 'Not enough Money.', account: profileOf(row) } };
      return { status: 200, body: { account: profileOf(rows[0]), bought: { skin: buy.skin, guns: buy.guns, price: buy.price }, shop: shopState(rows[0], Date.now(), christmasNow()) } };
    });
    if (out.status === 200) accounts.refreshSocketLoadout(await progression.load(account.id));
    return json(out.status, out.body);
  }));

  // Open the crate: the server takes the Money and draws a skin (on a gun) or a charm; anything already owned refunds half.
  route('POST', '/crates/open', authed(async (_ctx, account) => {
    const out = await progression.withLock(account.id, async () => {
      const row = (await db.query('SELECT * FROM accounts WHERE id = $1', [account.id])).rows[0];
      if (!row) return { status: 404, body: { error: 'Account not found.' } };
      if (row.money < CRATE.price) return { status: 402, body: { error: `Not enough Money: the crate costs ${CRATE.price.toLocaleString()}.`, account: profileOf(row) } };
      const { result, skins, charms } = openCrate(row);
      const { rows } = await db.query(
        'UPDATE accounts SET money = money - $2 + $3, owned_skins = owned_skins || $4::jsonb, owned_charms = owned_charms || $5::jsonb WHERE id = $1 AND money >= $2 RETURNING *',
        [row.id, CRATE.price, result.refund, JSON.stringify(skins), JSON.stringify(charms)],
      );
      if (!rows.length) return { status: 402, body: { error: 'Not enough Money.', account: profileOf(row) } };
      return { status: 200, body: { account: profileOf(rows[0]), result } };
    });
    if (out.status === 200) accounts.refreshSocketLoadout(await progression.load(account.id));
    return json(out.status, out.body);
  }));

  // Buy a Christmas crate (only during the event): it goes to the Christmas inventory, unopened.
  route('POST', '/crates/christmas/buy', authed(async (_ctx, account) => {
    if (!christmasOn(christmasNow())) return json(410, { error: 'The Christmas crate has gone.' });
    const { rows } = await db.query(
      'UPDATE accounts SET money = money - $2, christmas_crates = christmas_crates + 1 WHERE id = $1 AND money >= $2 RETURNING *',
      [account.id, CHRISTMAS.crate.price],
    );
    if (rows.length) return json(200, { account: profileOf(rows[0]) });
    const row = (await db.query('SELECT * FROM accounts WHERE id = $1', [account.id])).rows[0];
    return json(402, { error: `Not enough Money: the crate costs ${CHRISTMAS.crate.price.toLocaleString()}.`, account: row ? profileOf(row) : undefined });
  }));

  // Open one Christmas crate from the inventory. Crates you already have can be opened after the event too.
  route('POST', '/crates/christmas/open', authed(async (_ctx, account) => {
    const out = await progression.withLock(account.id, async () => {
      const row = (await db.query('SELECT * FROM accounts WHERE id = $1', [account.id])).rows[0];
      if (!row) return { status: 404, body: { error: 'Account not found.' } };
      if (!(row.christmas_crates > 0)) return { status: 400, body: { error: 'You have no Christmas crates.', account: profileOf(row) } };
      const { result, skins, charms } = rollChristmasCrate(row);
      const { rows } = await db.query(
        'UPDATE accounts SET money = money + $2, owned_skins = owned_skins || $3::jsonb, owned_charms = owned_charms || $4::jsonb, christmas_crates = christmas_crates - 1 WHERE id = $1 AND christmas_crates > 0 RETURNING *',
        [row.id, result.refund, JSON.stringify(skins), JSON.stringify(charms)],
      );
      if (!rows.length) return { status: 400, body: { error: 'You have no Christmas crates.', account: profileOf(row) } };
      return { status: 200, body: { account: profileOf(rows[0]), result } };
    });
    if (out.status === 200) accounts.refreshSocketLoadout(await progression.load(account.id));
    return json(out.status, out.body);
  }));

  route('POST', '/operators/buy', authed(async (ctx, account) => {
    const op = OPERATORS[ctx.body?.operator];
    if (!op) return json(400, { error: 'Unknown operator.' });
    if (!op.price) return json(400, { error: `${op.name} is free: you already own them.` });
    const { rows } = await db.query(
      `UPDATE accounts SET money = money - $2, owned_operators = owned_operators || to_jsonb($3::text)
       WHERE id = $1 AND money >= $2 AND NOT (owned_operators @> to_jsonb($3::text)) RETURNING *`,
      [account.id, op.price, op.id],
    );
    if (!rows[0]) {
      const current = (await db.query('SELECT * FROM accounts WHERE id = $1', [account.id])).rows[0];
      const owned = current && ownedOperatorIds(current.owned_operators).includes(op.id);
      return json(owned ? 409 : 402, {
        error: owned ? `You already own ${op.name}.` : `Not enough Money: ${op.name} costs ${op.price.toLocaleString()}.`,
        account: current ? profileOf(current) : undefined,
      });
    }
    accounts.refreshSocketLoadout(rows[0]);
    return json(200, { account: profileOf(rows[0]), bought: op.id, price: op.price });
  }));

  // Developer tool: top up Money to test the shop. Only exists on a local test database.
  route('POST', '/dev/money', async (ctx) => {
    if (!devToolsEnabled()) return json(404, { error: 'Not found.' });
    const found = await accounts.fromCookie(ctx.cookies);
    if (!found) return json(401, { error: 'Not logged in.' });
    const { rows } = await db.query('UPDATE accounts SET money = money + 10000 WHERE id = $1 RETURNING *', [found.row.id]);
    return json(200, { account: profileOf(rows[0]) });
  });

  /** Answer one request to /api/... */
  async function handle(request, { ip = '', secure = false } = {}) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/api(?=\/)/, '');
    const handler = routes.get(`${request.method} ${path}`);
    if (!handler) return json(404, { error: 'Not found.' });
    let body = null;
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      const text = await request.text();
      if (text.length > MAX_BODY_BYTES) return json(413, { error: 'Request too large.' });
      if (text) {
        try { body = JSON.parse(text); } catch { return json(400, { error: 'Bad request.' }); }
      }
    }
    try {
      return await handler({ request, url, body, ip, secure, cookies: request.headers.get('cookie') || '' });
    } catch (err) {
      console.error('Account API error:', err);
      return json(500, { error: 'Something went wrong on the server. Try again.' });
    }
  }

  return { handle };
}
