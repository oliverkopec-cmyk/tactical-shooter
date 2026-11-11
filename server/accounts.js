// Accounts: sign-up / log-in over HTTP, a session cookie that keeps you logged
// in, and the profile everything else reads. Sockets are only accepted from a
// logged-in browser, so socket.data.account is always the real account.
//
// Only the server ever changes Money, ranks or what an account owns. The client
// can read its profile and save its own settings, nothing else.

import crypto from 'node:crypto';
import bcrypt from 'bcrypt';
import express from 'express';
import { usernameError, passwordError } from '../shared/account.js';
import { sanitizeSettings } from '../shared/settings.js';
import { profileOf, configureProfile, ownsSkin, equippedSkinsOf, equippedOperatorsOf, devToolsEnabled, ownsCharm, equippedCharmsOf, equippedAttachmentsOf } from './profile.js';
import { OPERATORS as OPERATOR_DEFS } from '../shared/operators.js';
import { SKINS, CRATE } from '../shared/skins.js';
import { SLOTS, optionsFor, cleanAttachments } from '../shared/attachments.js';
import { shopState, purchase, openCrate, rollChristmasCrate } from './shop.js';
import { CHRISTMAS, christmasOn } from '../shared/christmas.js';
import { christmasNow } from './christmas.js';
import { WEAPONS } from '../shared/weapons.js';
import { OPERATORS } from '../shared/operators.js';
import { ownedOperatorIds } from '../shared/account.js';
import { Progression } from './progression.js';
import { Social } from './social.js';

const COOKIE = 'bl_session';
const SESSION_DAYS = 90;
const BCRYPT_ROUNDS = 11;
const AUTH_LIMIT = 20;                 // log-in / sign-up attempts...
const AUTH_WINDOW_MS = 10 * 60 * 1000; // ...per IP address per 10 minutes

const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

function readCookie(header, name) {
  for (const part of String(header || '').split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return null;
}

/** What a match needs to know about a player's equipped skins and operators. */
const loadoutOf = (row) => ({ skins: equippedSkinsOf(row), charms: equippedCharmsOf(row), attachments: equippedAttachmentsOf(row), operators: equippedOperatorsOf(row), owned: ownedOperatorIds(row.owned_operators), opMatches: row.stats?.opMatches || {} });

export class Accounts {
  constructor(db) {
    this.db = db;
    this.online = new Map();   // accountId -> socket (one connection per account)
    this.attempts = new Map(); // ip -> { count, resetAt }
    this.progression = new Progression(this);   // money, xp, rank points and daily quests
    this.social = new Social(this);             // friends, presence and parties
    this.moderation = null;                     // set by index.js (chat, reports, suspensions): checked at every login
    this.lookups = new Map();                   // ip -> { count, resetAt } for friend searches
    // Skins are earned or bought. UNLOCK_ALL_SKINS=1 is a developer switch that unlocks them all.
    configureProfile({
      unlockAll: process.env.UNLOCK_ALL_SKINS === '1',
      // Developer tools (a button that adds Money) only exist on a local test database, never on Render
      devTools: db.kind === 'local' && !process.env.RENDER,
    });
    // Compared against when the username doesn't exist, so a wrong username
    // takes as long to reject as a wrong password.
    this.dummyHash = bcrypt.hash(crypto.randomBytes(16).toString('hex'), BCRYPT_ROUNDS);

    const sweep = () => {
      this.db.query('DELETE FROM sessions WHERE expires_at < now()').catch((err) => console.error('Session cleanup failed:', err.message));
      const now = Date.now();
      for (const [ip, a] of this.attempts) if (a.resetAt < now) this.attempts.delete(ip);
      for (const [ip, l] of this.lookups) if (l.resetAt < now) this.lookups.delete(ip);
    };
    sweep();
    setInterval(sweep, 60 * 60 * 1000).unref();
  }

  // ---------------------------------------------------------------- sessions

  async createSession(accountId) {
    const token = crypto.randomBytes(32).toString('base64url');
    await this.db.query(
      `INSERT INTO sessions (token_hash, account_id, expires_at) VALUES ($1, $2, now() + interval '${SESSION_DAYS} days')`,
      [hashToken(token), accountId],
    );
    return token;
  }

  /**
   * The account row for a Cookie header, or null if not logged in. A suspended or banned account counts as not
   * logged in (`withBlocked` keeps it, with the reason, for the login page to explain).
   */
  async fromCookie(cookieHeader, { withBlocked = false } = {}) {
    const token = readCookie(cookieHeader, COOKIE);
    if (!token) return null;
    const { rows } = await this.db.query(
      `SELECT a.* FROM sessions s JOIN accounts a ON a.id = s.account_id
       WHERE s.token_hash = $1 AND s.expires_at > now()`,
      [hashToken(token)],
    );
    if (!rows[0]) return null;
    const block = this.moderation ? await this.moderation.blockOf(rows[0].id) : null;
    if (block && !withBlocked) return null;
    return { row: rows[0], tokenHash: hashToken(token), block };
  }

  setCookie(req, res, token) {
    res.cookie(COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: req.secure,
      path: '/',
      maxAge: SESSION_DAYS * 24 * 60 * 60 * 1000,
    });
  }

  rateLimited(req) {
    const now = Date.now();
    let a = this.attempts.get(req.ip);
    if (!a || a.resetAt < now) this.attempts.set(req.ip, (a = { count: 0, resetAt: now + AUTH_WINDOW_MS }));
    return ++a.count > AUTH_LIMIT;
  }

  // ---------------------------------------------------------------- HTTP API

  router() {
    const r = express.Router();
    r.use(express.json({ limit: '8kb' }));

    r.get('/session', async (req, res) => {
      const found = await this.fromCookie(req.headers.cookie, { withBlocked: true });
      if (found?.block) return res.json({ account: null, blocked: this.moderation.blockMessage(found.block), storage: this.db.kind });
      if (found) {
        // Each visit pushes the expiry back, so regular players never get logged out.
        await this.db.query(`UPDATE sessions SET expires_at = now() + interval '${SESSION_DAYS} days' WHERE token_hash = $1`, [found.tokenHash]);
        this.setCookie(req, res, readCookie(req.headers.cookie, COOKIE));
      }
      const row = found ? await this.progression.ensureQuests(found.row) : null;
      res.json({ account: row ? profileOf(row) : null, storage: this.db.kind });
    });

    r.post('/signup', async (req, res) => {
      if (this.rateLimited(req)) return res.status(429).json({ error: 'Too many attempts. Try again in a few minutes.' });
      const { username, password } = req.body || {};
      const err = usernameError(username) || passwordError(password);
      if (err) return res.status(400).json({ error: err });

      const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
      const { rows } = await this.db.query(
        `INSERT INTO accounts (username, username_lower, password_hash) VALUES ($1, $2, $3)
         ON CONFLICT (username_lower) DO NOTHING RETURNING *`,
        [username, username.toLowerCase(), hash],
      );
      if (!rows[0]) return res.status(409).json({ error: 'That username is taken.' });
      this.setCookie(req, res, await this.createSession(rows[0].id));
      res.json({ account: profileOf(await this.progression.ensureQuests(rows[0])) });
    });

    r.post('/login', async (req, res) => {
      if (this.rateLimited(req)) return res.status(429).json({ error: 'Too many attempts. Try again in a few minutes.' });
      const { username, password } = req.body || {};
      if (typeof username !== 'string' || typeof password !== 'string') return res.status(400).json({ error: 'Enter your username and password.' });

      const { rows } = await this.db.query('SELECT * FROM accounts WHERE username_lower = $1', [username.toLowerCase()]);
      const ok = await bcrypt.compare(password, rows[0]?.password_hash || await this.dummyHash);
      if (!rows[0] || !ok) return res.status(401).json({ error: 'Wrong username or password.' });
      const block = this.moderation ? await this.moderation.blockOf(rows[0].id) : null;
      if (block) return res.status(403).json({ error: this.moderation.blockMessage(block) });
      this.setCookie(req, res, await this.createSession(rows[0].id));
      res.json({ account: profileOf(await this.progression.ensureQuests(rows[0])) });
    });

    r.post('/logout', async (req, res) => {
      const found = await this.fromCookie(req.headers.cookie);
      if (found) {
        await this.db.query('DELETE FROM sessions WHERE token_hash = $1', [found.tokenHash]);
        const sock = this.online.get(found.row.id);
        if (sock?.data.tokenHash === found.tokenHash) sock.disconnect(true);
      }
      res.clearCookie(COOKIE, { path: '/' });
      res.json({ ok: true });
    });

    r.put('/settings', async (req, res) => {
      const found = await this.fromCookie(req.headers.cookie);
      if (!found) return res.status(401).json({ error: 'Not logged in.' });
      const clean = sanitizeSettings(req.body?.settings);
      await this.db.query('UPDATE accounts SET settings = $2 WHERE id = $1', [found.row.id, JSON.stringify(clean)]);
      res.json({ settings: clean });
    });

    // Equip a skin on a gun (skin: null puts the gun back to its default look)
    r.put('/equip/skin', async (req, res) => {
      const found = await this.fromCookie(req.headers.cookie);
      if (!found) return res.status(401).json({ error: 'Not logged in.' });
      const { weapon, skin } = req.body || {};
      if (!WEAPONS[weapon]) return res.status(400).json({ error: 'Unknown gun.' });
      if (skin !== null && !ownsSkin(found.row, weapon, skin)) return res.status(403).json({ error: 'You don\'t own that skin.' });
      const equipped = { ...equippedSkinsOf(found.row) };
      if (skin === null) delete equipped[weapon]; else equipped[weapon] = skin;
      const { rows } = await this.db.query('UPDATE accounts SET equipped_skins = $2 WHERE id = $1 RETURNING *', [found.row.id, JSON.stringify(equipped)]);
      this.refreshSocketLoadout(rows[0]);
      res.json({ account: profileOf(rows[0]) });
    });

    // Equip a charm on a gun (charm: null takes it off)
    r.put('/equip/charm', async (req, res) => {
      const found = await this.fromCookie(req.headers.cookie);
      if (!found) return res.status(401).json({ error: 'Not logged in.' });
      const { weapon, charm } = req.body || {};
      if (!WEAPONS[weapon]) return res.status(400).json({ error: 'Unknown gun.' });
      if (charm !== null && !ownsCharm(found.row, charm)) return res.status(403).json({ error: 'You don\'t own that charm.' });
      const equipped = { ...equippedCharmsOf(found.row) };
      if (charm === null) delete equipped[weapon]; else equipped[weapon] = charm;
      const { rows } = await this.db.query('UPDATE accounts SET equipped_charms = $2 WHERE id = $1 RETURNING *', [found.row.id, JSON.stringify(equipped)]);
      this.refreshSocketLoadout(rows[0]);
      res.json({ account: profileOf(rows[0]) });
    });

    // Fit an attachment on a gun (value: null puts the gun's own back). Only what is allowed on that gun gets through.
    r.put('/equip/attachment', async (req, res) => {
      const found = await this.fromCookie(req.headers.cookie);
      if (!found) return res.status(401).json({ error: 'Not logged in.' });
      const { weapon, slot, value } = req.body || {};
      if (!WEAPONS[weapon]) return res.status(400).json({ error: 'Unknown gun.' });
      if (!SLOTS.includes(slot)) return res.status(400).json({ error: 'Unknown slot.' });
      if (value !== null && !optionsFor(WEAPONS[weapon])[slot].includes(value)) return res.status(400).json({ error: 'That doesn\'t fit this gun.' });
      const equipped = { ...equippedAttachmentsOf(found.row) };
      const att = { ...equipped[weapon] };
      if (value === null) delete att[slot]; else att[slot] = value;
      const clean = cleanAttachments(WEAPONS[weapon], att);
      if (clean) equipped[weapon] = clean; else delete equipped[weapon];
      const { rows } = await this.db.query('UPDATE accounts SET equipped_attachments = $2 WHERE id = $1 RETURNING *', [found.row.id, JSON.stringify(equipped)]);
      this.refreshSocketLoadout(rows[0]);
      res.json({ account: profileOf(rows[0]) });
    });

    // Equip an operator for their side; it is also the one shown in the main menu
    r.put('/equip/operator', async (req, res) => {
      const found = await this.fromCookie(req.headers.cookie);
      if (!found) return res.status(401).json({ error: 'Not logged in.' });
      const op = OPERATORS[req.body?.operator];
      if (!op) return res.status(400).json({ error: 'Unknown operator.' });
      if (!ownedOperatorIds(found.row.owned_operators).includes(op.id)) return res.status(403).json({ error: 'You don\'t own that operator.' });
      const equipped = { ...equippedOperatorsOf(found.row), [op.team]: op.id, menu: op.id };
      const { rows } = await this.db.query('UPDATE accounts SET equipped_operators = $2 WHERE id = $1 RETURNING *', [found.row.id, JSON.stringify(equipped)]);
      this.refreshSocketLoadout(rows[0]);
      res.json({ account: profileOf(rows[0]) });
    });

    // ---------------------------------------------------------------- friends

    const authed = (handler) => async (req, res) => {
      const found = await this.fromCookie(req.headers.cookie);
      if (!found) return res.status(401).json({ error: 'Not logged in.' });
      return handler(found.row, req, res);
    };
    const answer = (res, out) => { const { status, ...rest } = out; res.status(status || 200).json(rest); };

    r.get('/friends', authed(async (row, _req, res) => res.json(await this.social.list(row.id))));
    r.get('/friends/search', authed(async (row, req, res) => {
      // A few searches a second is plenty; more looks like someone listing every username
      const now = Date.now();
      let l = this.lookups.get(req.ip);
      if (!l || l.resetAt < now) this.lookups.set(req.ip, (l = { count: 0, resetAt: now + 60000 }));
      if (++l.count > 60) return res.status(429).json({ error: 'Too many searches. Wait a minute.' });
      res.json({ results: await this.social.search(row.id, req.query.q) });
    }));
    r.post('/friends/request', authed(async (row, req, res) => answer(res, await this.social.request(row.id, req.body?.username))));
    r.post('/friends/respond', authed(async (row, req, res) => answer(res, await this.social.respond(row.id, Number(req.body?.id), !!req.body?.accept))));
    r.post('/friends/remove', authed(async (row, req, res) => answer(res, await this.social.remove(row.id, Number(req.body?.id)))));

    // ---------------------------------------------------------------- the shop (server/shop.js)

    // What is on sale now (the same for everyone), with this account's prices and what it owns
    r.get('/shop', authed(async (row, _req, res) => res.json(shopState(row, Date.now(), christmasNow()))));

    // Buy a daily item or a Limited skin. The server checks it is on sale now and what it costs; Money only.
    r.post('/shop/buy', authed(async (account, req, res) => {
      const out = await this.progression.withLock(account.id, async () => {
        const row = (await this.db.query('SELECT * FROM accounts WHERE id = $1', [account.id])).rows[0];
        if (!row) return { status: 404, body: { error: 'Account not found.' } };
        const buy = purchase(row, req.body?.id);
        if (buy.error) return { status: 400, body: { error: buy.error, account: profileOf(row) } };
        if (row.money < buy.price) return { status: 402, body: { error: `Not enough Money: that costs ${buy.price.toLocaleString()}.`, account: profileOf(row) } };
        const { rows } = await this.db.query(
          'UPDATE accounts SET money = money - $2, owned_skins = owned_skins || $3::jsonb WHERE id = $1 AND money >= $2 RETURNING *',
          [row.id, buy.price, JSON.stringify(buy.add)],
        );
        if (!rows.length) return { status: 402, body: { error: 'Not enough Money.', account: profileOf(row) } };
        return { status: 200, body: { account: profileOf(rows[0]), bought: { skin: buy.skin, guns: buy.guns, price: buy.price }, shop: shopState(rows[0], Date.now(), christmasNow()) } };
      });
      if (out.status === 200) this.refreshSocketLoadout(await this.progression.load(account.id));
      res.status(out.status).json(out.body);
    }));

    // Open the crate: the server takes the Money and draws a skin (on a gun) or a charm; anything already owned refunds half.
    r.post('/crates/open', authed(async (account, _req, res) => {
      const out = await this.progression.withLock(account.id, async () => {
        const row = (await this.db.query('SELECT * FROM accounts WHERE id = $1', [account.id])).rows[0];
        if (!row) return { status: 404, body: { error: 'Account not found.' } };
        if (row.money < CRATE.price) return { status: 402, body: { error: `Not enough Money: the crate costs ${CRATE.price.toLocaleString()}.`, account: profileOf(row) } };
        const { result, skins, charms } = openCrate(row);
        const { rows } = await this.db.query(
          'UPDATE accounts SET money = money - $2 + $3, owned_skins = owned_skins || $4::jsonb, owned_charms = owned_charms || $5::jsonb WHERE id = $1 AND money >= $2 RETURNING *',
          [row.id, CRATE.price, result.refund, JSON.stringify(skins), JSON.stringify(charms)],
        );
        if (!rows.length) return { status: 402, body: { error: 'Not enough Money.', account: profileOf(row) } };
        return { status: 200, body: { account: profileOf(rows[0]), result } };
      });
      if (out.status === 200) this.refreshSocketLoadout(await this.progression.load(account.id));
      res.status(out.status).json(out.body);
    }));

    // Buy a Christmas crate (only during the event): it goes to the Christmas inventory, unopened.
    r.post('/crates/christmas/buy', authed(async (account, _req, res) => {
      if (!christmasOn(christmasNow())) return res.status(410).json({ error: 'The Christmas crate has gone.' });
      const { rows } = await this.db.query(
        'UPDATE accounts SET money = money - $2, christmas_crates = christmas_crates + 1 WHERE id = $1 AND money >= $2 RETURNING *',
        [account.id, CHRISTMAS.crate.price],
      );
      if (rows.length) return res.json({ account: profileOf(rows[0]) });
      const row = (await this.db.query('SELECT * FROM accounts WHERE id = $1', [account.id])).rows[0];
      res.status(402).json({ error: `Not enough Money: the crate costs ${CHRISTMAS.crate.price.toLocaleString()}.`, account: row ? profileOf(row) : undefined });
    }));

    // Open one Christmas crate from the inventory. Crates you already have can be opened after the event too.
    r.post('/crates/christmas/open', authed(async (account, _req, res) => {
      const out = await this.progression.withLock(account.id, async () => {
        const row = (await this.db.query('SELECT * FROM accounts WHERE id = $1', [account.id])).rows[0];
        if (!row) return { status: 404, body: { error: 'Account not found.' } };
        if (!(row.christmas_crates > 0)) return { status: 400, body: { error: 'You have no Christmas crates.', account: profileOf(row) } };
        const { result, skins, charms } = rollChristmasCrate(row);
        const { rows } = await this.db.query(
          'UPDATE accounts SET money = money + $2, owned_skins = owned_skins || $3::jsonb, owned_charms = owned_charms || $4::jsonb, christmas_crates = christmas_crates - 1 WHERE id = $1 AND christmas_crates > 0 RETURNING *',
          [row.id, result.refund, JSON.stringify(skins), JSON.stringify(charms)],
        );
        if (!rows.length) return { status: 400, body: { error: 'You have no Christmas crates.', account: profileOf(row) } };
        return { status: 200, body: { account: profileOf(rows[0]), result } };
      });
      if (out.status === 200) this.refreshSocketLoadout(await this.progression.load(account.id));
      res.status(out.status).json(out.body);
    }));

    r.post('/operators/buy', async (req, res) => {
      const found = await this.fromCookie(req.headers.cookie);
      if (!found) return res.status(401).json({ error: 'Not logged in.' });
      const op = OPERATOR_DEFS[req.body?.operator];
      if (!op) return res.status(400).json({ error: 'Unknown operator.' });
      if (!op.price) return res.status(400).json({ error: `${op.name} is free: you already own them.` });
      const { rows } = await this.db.query(
        `UPDATE accounts SET money = money - $2, owned_operators = owned_operators || to_jsonb($3::text)
         WHERE id = $1 AND money >= $2 AND NOT (owned_operators @> to_jsonb($3::text)) RETURNING *`,
        [found.row.id, op.price, op.id],
      );
      if (!rows[0]) {
        const current = (await this.db.query('SELECT * FROM accounts WHERE id = $1', [found.row.id])).rows[0];
        const owned = current && ownedOperatorIds(current.owned_operators).includes(op.id);
        return res.status(owned ? 409 : 402).json({
          error: owned ? `You already own ${op.name}.` : `Not enough Money: ${op.name} costs ${op.price.toLocaleString()}.`,
          account: current ? profileOf(current) : undefined,
        });
      }
      this.refreshSocketLoadout(rows[0]);
      res.json({ account: profileOf(rows[0]), bought: op.id, price: op.price });
    });

    // Developer tool: top up Money to test the shop. Only exists on a local test database.
    r.post('/dev/money', async (req, res) => {
      if (!devToolsEnabled()) return res.status(404).json({ error: 'Not found.' });
      const found = await this.fromCookie(req.headers.cookie);
      if (!found) return res.status(401).json({ error: 'Not logged in.' });
      const { rows } = await this.db.query('UPDATE accounts SET money = money + 10000 WHERE id = $1 RETURNING *', [found.row.id]);
      res.json({ account: profileOf(rows[0]) });
    });

    r.use((err, _req, res, _next) => {
      console.error('Account API error:', err);
      res.status(500).json({ error: 'Something went wrong on the server. Try again.' });
    });
    return r;
  }

  // ---------------------------------------------------------------- sockets

  /** Connection middleware (server/realtime.js): only logged-in browsers may connect. */
  socketAuth() {
    return async (socket, next) => {
      try {
        const found = await this.fromCookie(socket.request.headers.cookie);
        if (!found) return next(new Error('unauthorized'));
        socket.data.account = { id: found.row.id, username: found.row.username, ...loadoutOf(found.row) };
        socket.data.tokenHash = found.tokenHash;
        next();
      } catch (err) {
        console.error('Socket auth failed:', err.message);
        next(new Error('server error'));
      }
    };
  }

  /** After an equip: the open connection carries the new look into the next match. */
  refreshSocketLoadout(row) {
    const sock = this.online.get(row.id);
    if (sock) Object.assign(sock.data.account, loadoutOf(row));
  }

  /** One live connection per account: a newer tab or device takes over from the old one. */
  trackOnline(socket) {
    const { id } = socket.data.account;
    const prev = this.online.get(id);
    if (prev && prev !== socket) {
      prev.emit('sessionReplaced');
      prev.disconnect(true);
    }
    this.online.set(id, socket);
    socket.on('disconnect', () => {
      if (this.online.get(id) !== socket) return;
      this.online.delete(id);
      this.social.onDisconnect(id);
    });
    this.social.onConnect(id);
    this.db.query('UPDATE accounts SET last_seen = now() WHERE id = $1', [id]).catch(() => {});
  }
}
