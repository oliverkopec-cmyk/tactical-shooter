// Accounts: sessions (a cookie that keeps you logged in), who is connected, and the profile everything else
// reads. The HTTP routes (sign-up, log-in, equipping, the shop...) are in server/api.js. Sockets are only accepted
// from a logged-in browser, so socket.data.account is always the real account.
//
// Only the server ever changes Money, ranks or what an account owns. The client
// can read its profile and save its own settings, nothing else.

import crypto from 'node:crypto';
import { configureProfile, equippedSkinsOf, equippedOperatorsOf, equippedCharmsOf, equippedAttachmentsOf } from './profile.js';
import { ownedOperatorIds } from '../shared/account.js';
import { localPasswords } from './passwords.js';
import { Progression } from './progression.js';
import { Social } from './social.js';

export const COOKIE = 'bl_session';
export const SESSION_DAYS = 90;
const AUTH_LIMIT = 20;                 // log-in / sign-up attempts...
const AUTH_WINDOW_MS = 10 * 60 * 1000; // ...per IP address per 10 minutes

const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

export function readCookie(header, name) {
  for (const part of String(header || '').split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return null;
}

/** What a match needs to know about a player's equipped skins and operators. */
export const loadoutOf = (row) => ({ skins: equippedSkinsOf(row), charms: equippedCharmsOf(row), attachments: equippedAttachmentsOf(row), operators: equippedOperatorsOf(row), owned: ownedOperatorIds(row.owned_operators), opMatches: row.stats?.opMatches || {} });

export class Accounts {
  /**
   * background: run the hourly clean-up of expired sessions here (the Node server). The Worker leaves it to the
   * Node server for now, and later to a scheduled job.
   * passwords: { hash, verify, reject } (server/passwords.js), run here unless given (the Worker runs them in a
   * Durable Object).
   */
  constructor(db, { background = true, passwords = localPasswords } = {}) {
    this.db = db;
    this.passwords = passwords;
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
    const sweep = () => {
      this.db.query('DELETE FROM sessions WHERE expires_at < now()').catch((err) => console.error('Session cleanup failed:', err.message));
      const now = Date.now();
      for (const [ip, a] of this.attempts) if (a.resetAt < now) this.attempts.delete(ip);
      for (const [ip, l] of this.lookups) if (l.resetAt < now) this.lookups.delete(ip);
    };
    if (background) {
      sweep();
      setInterval(sweep, 60 * 60 * 1000).unref();
    }
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

  /** Log-in and sign-up attempts from one address. Counted in memory: per server process (per Worker instance). */
  rateLimited(ip) {
    const now = Date.now();
    if (this.attempts.size > 5000) for (const [k, v] of this.attempts) if (v.resetAt < now) this.attempts.delete(k);   // no hourly sweep in a Worker
    let a = this.attempts.get(ip);
    if (!a || a.resetAt < now) this.attempts.set(ip, (a = { count: 0, resetAt: now + AUTH_WINDOW_MS }));
    return ++a.count > AUTH_LIMIT;
  }

  /** Friend searches from one address: a few a second is plenty; more looks like someone listing every username. */
  lookupLimited(ip) {
    const now = Date.now();
    if (this.lookups.size > 5000) for (const [k, v] of this.lookups) if (v.resetAt < now) this.lookups.delete(k);
    let l = this.lookups.get(ip);
    if (!l || l.resetAt < now) this.lookups.set(ip, (l = { count: 0, resetAt: now + 60000 }));
    return ++l.count > 60;
  }

  /** A logged-out session: close its game connection, if it has one here. */
  kickSession(accountId, tokenHash) {
    const sock = this.online.get(accountId);
    if (sock?.data.tokenHash === tokenHash) sock.disconnect(true);
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
