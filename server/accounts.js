// Accounts: sign-up / log-in over HTTP, a session cookie that keeps you logged
// in, and the profile everything else reads. Sockets are only accepted from a
// logged-in browser, so socket.data.account is always the real account.
//
// Only the server ever changes Money, ranks or what an account owns. The client
// can read its profile and save its own settings, nothing else.

import crypto from 'node:crypto';
import bcrypt from 'bcrypt';
import express from 'express';
import { usernameError, passwordError, ownedOperatorIds } from '../shared/account.js';
import { sanitizeSettings } from '../shared/settings.js';

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

/** What the client gets to see about its own account. */
export function profileOf(row) {
  return {
    id: row.id,
    username: row.username,
    level: row.level,
    xp: row.xp,
    money: row.money,
    polishMoney: row.polish_money,
    rankPoints: row.rank_points,
    ownedOperators: ownedOperatorIds(row.owned_operators),
    ownedSkins: row.owned_skins,
    equippedSkins: row.equipped_skins,
    settings: sanitizeSettings(row.settings),
  };
}

export class Accounts {
  constructor(db) {
    this.db = db;
    this.online = new Map();   // accountId -> socket (one connection per account)
    this.attempts = new Map(); // ip -> { count, resetAt }
    // Compared against when the username doesn't exist, so a wrong username
    // takes as long to reject as a wrong password.
    this.dummyHash = bcrypt.hash(crypto.randomBytes(16).toString('hex'), BCRYPT_ROUNDS);

    const sweep = () => {
      this.db.query('DELETE FROM sessions WHERE expires_at < now()').catch((err) => console.error('Session cleanup failed:', err.message));
      const now = Date.now();
      for (const [ip, a] of this.attempts) if (a.resetAt < now) this.attempts.delete(ip);
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

  /** The account row for a Cookie header, or null if not logged in. */
  async fromCookie(cookieHeader) {
    const token = readCookie(cookieHeader, COOKIE);
    if (!token) return null;
    const { rows } = await this.db.query(
      `SELECT a.* FROM sessions s JOIN accounts a ON a.id = s.account_id
       WHERE s.token_hash = $1 AND s.expires_at > now()`,
      [hashToken(token)],
    );
    return rows[0] ? { row: rows[0], tokenHash: hashToken(token) } : null;
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
      const found = await this.fromCookie(req.headers.cookie);
      if (found) {
        // Each visit pushes the expiry back, so regular players never get logged out.
        await this.db.query(`UPDATE sessions SET expires_at = now() + interval '${SESSION_DAYS} days' WHERE token_hash = $1`, [found.tokenHash]);
        this.setCookie(req, res, readCookie(req.headers.cookie, COOKIE));
      }
      res.json({ account: found ? profileOf(found.row) : null, storage: this.db.kind });
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
      res.json({ account: profileOf(rows[0]) });
    });

    r.post('/login', async (req, res) => {
      if (this.rateLimited(req)) return res.status(429).json({ error: 'Too many attempts. Try again in a few minutes.' });
      const { username, password } = req.body || {};
      if (typeof username !== 'string' || typeof password !== 'string') return res.status(400).json({ error: 'Enter your username and password.' });

      const { rows } = await this.db.query('SELECT * FROM accounts WHERE username_lower = $1', [username.toLowerCase()]);
      const ok = await bcrypt.compare(password, rows[0]?.password_hash || await this.dummyHash);
      if (!rows[0] || !ok) return res.status(401).json({ error: 'Wrong username or password.' });
      this.setCookie(req, res, await this.createSession(rows[0].id));
      res.json({ account: profileOf(rows[0]) });
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

    r.use((err, _req, res, _next) => {
      console.error('Account API error:', err);
      res.status(500).json({ error: 'Something went wrong on the server. Try again.' });
    });
    return r;
  }

  // ---------------------------------------------------------------- sockets

  /** Socket.IO middleware: only logged-in browsers may connect. */
  socketAuth() {
    return async (socket, next) => {
      try {
        const found = await this.fromCookie(socket.request.headers.cookie);
        if (!found) return next(new Error('unauthorized'));
        socket.data.account = { id: found.row.id, username: found.row.username };
        socket.data.tokenHash = found.tokenHash;
        next();
      } catch (err) {
        console.error('Socket auth failed:', err.message);
        next(new Error('server error'));
      }
    };
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
    socket.on('disconnect', () => { if (this.online.get(id) === socket) this.online.delete(id); });
    this.db.query('UPDATE accounts SET last_seen = now() WHERE id = $1', [id]).catch(() => {});
  }
}
