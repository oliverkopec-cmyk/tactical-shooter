// Admin announcements and gifts.
//
// Announcements go straight to every connected player and are not stored, so offline players
// never get them. Gifts are stored: `gifts` holds what was sent, `gift_recipients` who it was sent
// to (one player, or everyone online at that moment), and a gift for the whole server has no
// recipient rows and goes to every account that existed when it was sent (offline ones see it at
// their next login). `gift_claims` records who opened what: its primary key makes a second claim
// impossible, and the claim and the reward are written in one statement, so a gift can't be
// opened twice or faked. Only the server decides what is inside; the client only names the gift.

import crypto from 'node:crypto';
import { SKINS, CRATE, rollCrate, isExclusive } from '../shared/skins.js';
import { CHARMS, CHARM_CRATE, rollCharmCrate } from '../shared/charms.js';
import { WEAPONS } from '../shared/weapons.js';
import { isAdmin } from './roles.js';
import { profileOf, ownsSkin, ownsCharm } from './profile.js';

export const GIFT_LIMITS = { title: 60, message: 300, money: 10000000, announce: 200, seconds: [5, 10, 30], pending: 20, history: 50 };
const MONEY_CEILING = 2000000000;   // the money column is a 32-bit integer
const AUDIENCES = ['player', 'online', 'everyone'];

const cleanText = (s, max) => String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);

/** What a gift may contain: Money, a skin, a charm and/or a crate (a gun's id or 'charm'). Null if empty or invalid. */
export function cleanContents(raw) {
  const c = raw && typeof raw === 'object' ? raw : {};
  const out = {};
  const money = Math.floor(Number(c.money) || 0);
  if (money < 0 || money > GIFT_LIMITS.money) return null;
  if (money > 0) out.money = money;
  if (c.skin) { if (!SKINS[c.skin]) return null; out.skin = c.skin; }
  if (c.charm) { if (!CHARMS[c.charm]) return null; out.charm = c.charm; }
  if (c.crate) { if (c.crate !== 'charm' && !WEAPONS[c.crate]) return null; out.crate = c.crate; }
  return Object.keys(out).length ? out : null;
}

export class Gifts {
  constructor({ db, accounts }) {
    this.db = db;
    this.accounts = accounts;
    this.progression = accounts.progression;
    this.lastSend = new Map();   // admin account id -> time of their last announcement or gift
  }

  allowed(socket) {
    return isAdmin(socket.data.account?.username);
  }

  /** A short pause between sends, so a stuck button can't flood everyone. */
  tooSoon(socket) {
    const id = socket.data.account.id, now = Date.now();
    if (now - (this.lastSend.get(id) || 0) < 1500) return true;
    this.lastSend.set(id, now);
    return false;
  }

  // ---------------------------------------------------------------- announcements

  /** Admin: a banner for everyone online right now, for 5, 10 or 30 seconds. */
  announce(socket, { text, seconds } = {}) {
    if (!this.allowed(socket)) return { error: 'Not allowed.' };
    const msg = cleanText(text, GIFT_LIMITS.announce);
    if (!msg) return { error: 'Type a message first.' };
    const secs = GIFT_LIMITS.seconds.includes(Number(seconds)) ? Number(seconds) : 10;
    if (this.tooSoon(socket)) return { error: 'Wait a moment before sending another.' };
    const payload = { text: msg, seconds: secs, from: socket.data.account.username };
    for (const s of this.accounts.online.values()) s.emit('announcement', payload);
    return { ok: true, sent: this.accounts.online.size };
  }

  // ---------------------------------------------------------------- sending gifts

  /** Admin: create a gift for one player (by username), everyone online, or every account. */
  async create(socket, { title, message, contents, audience, username } = {}) {
    if (!this.allowed(socket)) return { error: 'Not allowed.' };
    const t = cleanText(title, GIFT_LIMITS.title) || 'A gift';
    const msg = cleanText(message, GIFT_LIMITS.message);
    const c = cleanContents(contents);
    if (!c) return { error: `Put something in the gift: Money (up to ${GIFT_LIMITS.money.toLocaleString()}), a skin, a charm or a crate.` };
    if (!AUDIENCES.includes(audience)) return { error: 'Choose who gets it.' };
    let ids = [];
    if (audience === 'player') {
      const { rows } = await this.db.query('SELECT id FROM accounts WHERE username_lower = $1', [String(username || '').trim().toLowerCase()]);
      if (!rows.length) return { error: 'No player with that username.' };
      ids = [rows[0].id];
    } else if (audience === 'online') {
      ids = [...this.accounts.online.keys()];
      if (!ids.length) return { error: 'Nobody is online.' };
    }
    if (this.tooSoon(socket)) return { error: 'Wait a moment before sending another.' };
    const { rows } = await this.db.query(
      'INSERT INTO gifts (title, message, contents, audience, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING id, created_at',
      [t, msg, JSON.stringify(c), audience, socket.data.account.username],
    );
    const gift = rows[0];
    if (ids.length) {
      await this.db.query('INSERT INTO gift_recipients (gift_id, account_id) SELECT $1, unnest($2::bigint[]) ON CONFLICT DO NOTHING', [gift.id, ids]);
    }
    // Tell whoever is online now; everyone else sees it at their next login
    const notify = audience === 'everyone' ? [...this.accounts.online.keys()] : ids;
    for (const id of notify) { const s = this.accounts.online.get(id); if (s) this.sendPending(s); }
    const recipients = audience === 'everyone' ? (await this.db.query('SELECT count(*)::int AS n FROM accounts WHERE created_at <= $1', [gift.created_at])).rows[0].n : ids.length;
    return { ok: true, id: gift.id, recipients };
  }

  /** Admin: the last gifts sent, with how many players could open each and how many have. */
  async history(socket) {
    if (!this.allowed(socket)) return { error: 'Not allowed.' };
    const { rows } = await this.db.query(`
      SELECT g.id, g.title, g.message, g.contents, g.audience, g.created_by, g.created_at,
        (SELECT count(*)::int FROM gift_claims c WHERE c.gift_id = g.id) AS claimed,
        CASE WHEN g.audience = 'everyone'
          THEN (SELECT count(*)::int FROM accounts a WHERE a.created_at <= g.created_at)
          ELSE (SELECT count(*)::int FROM gift_recipients r WHERE r.gift_id = g.id) END AS recipients,
        CASE WHEN g.audience = 'player'
          THEN (SELECT a.username FROM gift_recipients r JOIN accounts a ON a.id = r.account_id WHERE r.gift_id = g.id LIMIT 1) END AS player
      FROM gifts g ORDER BY g.id DESC LIMIT $1`, [GIFT_LIMITS.history]);
    return { gifts: rows.map((r) => ({ ...r, created_at: new Date(r.created_at).toISOString() })) };
  }

  /** Admin: usernames starting with what was typed, for picking one player. */
  async findPlayers(socket, q) {
    if (!this.allowed(socket)) return { error: 'Not allowed.' };
    const prefix = String(q || '').trim().toLowerCase().replace(/[%_\\]/g, '');
    if (!prefix) return { players: [] };
    const { rows } = await this.db.query('SELECT username FROM accounts WHERE username_lower LIKE $1 ORDER BY username_lower LIMIT 8', [`${prefix}%`]);
    return { players: rows.map((r) => r.username) };
  }

  // ---------------------------------------------------------------- receiving

  /** Gifts this account may open and hasn't yet: [{ id, title, exclusive }] (what's inside stays secret until it's opened). */
  async pendingFor(accountId) {
    const { rows } = await this.db.query(`
      SELECT g.id, g.title, g.contents FROM gifts g JOIN accounts a ON a.id = $1
      WHERE ((g.audience = 'everyone' AND a.created_at <= g.created_at)
          OR EXISTS (SELECT 1 FROM gift_recipients r WHERE r.gift_id = g.id AND r.account_id = $1))
        AND NOT EXISTS (SELECT 1 FROM gift_claims c WHERE c.gift_id = g.id AND c.account_id = $1)
      ORDER BY g.id LIMIT $2`, [accountId, GIFT_LIMITS.pending]);
    return rows.map((r) => ({ id: r.id, title: r.title, exclusive: isExclusive(r.contents?.skin) }));
  }

  async sendPending(socket) {
    try { socket.emit('gifts', await this.pendingFor(socket.data.account.id)); }
    catch (err) { console.error('Gift list failed:', err.message); }
  }

  /** Open a gift: check it is this account's and unopened, then add what's inside, all on the server. */
  async claim(socket, giftId) {
    const accountId = socket.data.account.id;
    const id = Number(giftId);
    if (!Number.isInteger(id) || id <= 0) return { error: 'Unknown gift.' };
    const out = await this.progression.withLock(accountId, async () => {
      const { rows: gifts } = await this.db.query(`
        SELECT g.* FROM gifts g JOIN accounts a ON a.id = $1
        WHERE g.id = $2 AND ((g.audience = 'everyone' AND a.created_at <= g.created_at)
          OR EXISTS (SELECT 1 FROM gift_recipients r WHERE r.gift_id = g.id AND r.account_id = $1))
          AND NOT EXISTS (SELECT 1 FROM gift_claims c WHERE c.gift_id = g.id AND c.account_id = $1)`, [accountId, id]);
      const gift = gifts[0];
      if (!gift) return { error: 'That gift has already been opened.' };
      const row = await this.progression.load(accountId);
      const c = gift.contents || {};
      const result = { title: gift.title, message: gift.message, from: gift.created_by };
      let money = c.money || 0;
      const skins = [], charms = [];
      if (c.money) result.money = c.money;
      if (c.skin && SKINS[c.skin]) {
        // A gifted skin is owned on every gun
        const owned = Array.isArray(row.owned_skins) && row.owned_skins.includes(c.skin);
        result.skin = { id: c.skin, rarity: SKINS[c.skin].rarity, duplicate: owned };
        if (!owned) skins.push(c.skin);
      }
      if (c.charm && CHARMS[c.charm]) {
        const owned = ownsCharm(row, c.charm);
        result.charm = { id: c.charm, rarity: CHARMS[c.charm].rarity, duplicate: owned };
        if (!owned) charms.push(c.charm);
      }
      if (c.crate === 'charm') {
        const { rarity, charm } = rollCharmCrate((n) => crypto.randomInt(n));
        const dup = ownsCharm(row, charm) || charms.includes(charm);
        result.crate = { kind: 'charm', charm, rarity, duplicate: dup, refund: dup ? CHARM_CRATE.refund : 0 };
        if (dup) money += CHARM_CRATE.refund; else charms.push(charm);
      } else if (c.crate && WEAPONS[c.crate]) {
        const { rarity, skin } = rollCrate((n) => crypto.randomInt(n));
        const dup = ownsSkin(row, c.crate, skin) || skins.includes(skin);
        result.crate = { kind: 'gun', weapon: c.crate, skin, rarity, duplicate: dup, refund: dup ? CRATE.refund : 0 };
        if (dup) money += CRATE.refund; else skins.push(`${c.crate}:${skin}`);
      }
      // Claim and reward in one statement: the claim row can only be inserted once
      const { rows } = await this.db.query(`
        WITH claim AS (INSERT INTO gift_claims (gift_id, account_id) VALUES ($2, $1) ON CONFLICT DO NOTHING RETURNING gift_id)
        UPDATE accounts SET money = LEAST($6, money + $3), owned_skins = owned_skins || $4::jsonb, owned_charms = owned_charms || $5::jsonb
        WHERE id = $1 AND EXISTS (SELECT 1 FROM claim) RETURNING *`,
      [accountId, id, money, JSON.stringify(skins), JSON.stringify(charms), MONEY_CEILING]);
      if (!rows.length) return { error: 'That gift has already been opened.' };
      return { ok: true, result, row: rows[0] };
    });
    if (!out.ok) return out;
    this.accounts.refreshSocketLoadout(out.row);
    this.sendPending(socket);
    return { ok: true, result: out.result, account: profileOf(out.row) };
  }
}
