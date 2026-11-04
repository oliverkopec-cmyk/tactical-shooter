// The Christmas presents on the server (Stage M). `christmas_claims` records which days an account has opened: its
// primary key makes a second claim impossible, and the claim and the reward are written in one statement, like admin
// gifts. Only the server knows what is inside; the client only names the day.
//
// On a local test database the event's clock can be moved to try every date (dev tools only, never on Render).

import crypto from 'node:crypto';
import { CHARMS } from '../shared/charms.js';
import { SKINS } from '../shared/skins.js';
import { CHRISTMAS, CHRISTMAS_CHARM_IDS, christmasState, presentsOpen, presentSkin, presentDate } from '../shared/christmas.js';
import { profileOf, ownsCharm, devToolsEnabled } from './profile.js';

const MONEY_CEILING = 2000000000;   // the money column is a 32-bit integer
const randInt = (n) => crypto.randomInt(n);

let devOffset = 0;
/** The time the event goes by. The same as the real time except when testing on a local database. */
export const christmasNow = () => Date.now() + devOffset;

const someMoney = (rand) => {
  const { min, max, step } = CHRISTMAS.money;
  return min + rand(Math.floor((max - min) / step) + 1) * step;
};

/**
 * What a present holds, for an account row: { result, money, skins, charms, crates } with what to add.
 * The last 7 days: 1500 Money and that day's limited skin, owned on every gun. Before that: Money, a Christmas charm
 * you don't have yet (Money if you have them all) or a Christmas crate, which goes to the Christmas inventory unopened.
 */
export function rollPresent(row, day, rand = randInt) {
  const out = { result: {}, money: 0, skins: [], charms: [], crates: 0 };
  const skin = presentSkin(day);
  if (skin) {
    out.money = CHRISTMAS.skinMoney;
    const owned = Array.isArray(row.owned_skins) && row.owned_skins.includes(skin);
    out.result.skin = { id: skin, rarity: SKINS[skin].rarity, duplicate: owned };
    if (!owned) out.skins.push(skin);
  } else {
    const { money, charm } = CHRISTMAS.chances;
    const roll = rand(10000) / 10000;
    const missing = CHRISTMAS_CHARM_IDS.filter((id) => !ownsCharm(row, id));
    if (roll >= money + charm) {
      out.crates = 1;
      out.result.christmasCrate = true;
    } else if (roll >= money && missing.length) {
      const id = missing[rand(missing.length)];
      out.result.charm = { id, rarity: CHARMS[id].rarity, duplicate: false };
      out.charms.push(id);
    } else {
      out.money = someMoney(rand);
    }
  }
  if (out.money) out.result.money = out.money;
  return out;
}

export class Christmas {
  constructor({ db, accounts }) {
    this.db = db;
    this.accounts = accounts;
    this.progression = accounts.progression;
  }

  async stateFor(accountId) {
    const { rows } = await this.db.query('SELECT day FROM christmas_claims WHERE account_id = $1', [accountId]);
    return christmasState(christmasNow(), rows.map((r) => r.day));
  }

  async sendState(socket) {
    try { socket.emit('christmas', await this.stateFor(socket.data.account.id)); }
    catch (err) { console.error('Christmas state failed:', err.message); }
  }

  /** Open one day's present: check it has opened and isn't claimed, then add what's inside. */
  async claim(socket, rawDay) {
    const accountId = socket.data.account.id;
    const day = Number(rawDay);
    if (!presentsOpen(christmasNow()).includes(day)) return { error: 'That present can\'t be opened right now.' };
    const out = await this.progression.withLock(accountId, async () => {
      const { rows: seen } = await this.db.query('SELECT 1 FROM christmas_claims WHERE account_id = $1 AND day = $2', [accountId, day]);
      if (seen.length) return { error: 'You have already opened that present.' };
      const row = await this.progression.load(accountId);
      const { result, money, skins, charms, crates } = rollPresent(row, day);
      const { rows } = await this.db.query(`
        WITH claim AS (INSERT INTO christmas_claims (account_id, day) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING day)
        UPDATE accounts SET money = LEAST($6, money + $3), owned_skins = owned_skins || $4::jsonb, owned_charms = owned_charms || $5::jsonb, christmas_crates = christmas_crates + $7
        WHERE id = $1 AND EXISTS (SELECT 1 FROM claim) RETURNING *`,
      [accountId, day, money, JSON.stringify(skins), JSON.stringify(charms), MONEY_CEILING, crates]);
      if (!rows.length) return { error: 'You have already opened that present.' };
      return { ok: true, result: { title: `Christmas present · ${presentDate(day)}`, ...result }, row: rows[0] };
    });
    if (!out.ok) return out;
    this.accounts.refreshSocketLoadout(out.row);
    return { ok: true, result: out.result, account: profileOf(out.row), christmas: await this.stateFor(accountId) };
  }

  // ---------------------------------------------------------------- local test database only

  /** Pretend it is another time ('' goes back to the real time), and tell everyone online. */
  async devDate(date) {
    if (!devToolsEnabled()) return { error: 'Not found.' };
    const at = date ? Date.parse(date) : Date.now();
    if (!Number.isFinite(at)) return { error: 'That isn\'t a date.' };
    devOffset = at - Date.now();
    for (const s of this.accounts.online.values()) this.sendState(s);
    return { ok: true, now: christmasNow() };
  }

  /** Forget which presents this account has opened, so they can be tried again. */
  async devReset(socket) {
    if (!devToolsEnabled()) return { error: 'Not found.' };
    await this.db.query('DELETE FROM christmas_claims WHERE account_id = $1', [socket.data.account.id]);
    this.sendState(socket);
    return { ok: true };
  }
}
