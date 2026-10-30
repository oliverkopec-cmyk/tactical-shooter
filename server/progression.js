// Money, XP, rank points and daily quests. Everything here runs on the server
// from the match the server itself watched: the client never reports a result
// and has no way to ask for money, XP or rank points.

import { QUESTS, QUEST_COUNT, QUEST_LIFETIME_MS, levelFromXp } from '../shared/progression.js';
import { profileOf } from './profile.js';

// ---------------------------------------------------------------- the numbers

export const REWARD = {
  participation: 100,   // for finishing a match
  win: 150,             // on top, for winning it
  perRoundWon: 25,
  perKill: 10,
  perHeadshotKill: 5,   // extra, on top of the kill
  perPlant: 5,          // breach charge planted
  objectivePerSec: 2,   // seconds spent inside the objective zone
  objectiveCap: 80,
};

export const RANK = {
  win: 25,
  loss: -20,
  forfeit: -25,         // leaving a match that is still going counts as a bit worse than losing
  adjustMax: 7,         // performance moves the result by up to this much either way
  winRange: [15, 35],
  lossRange: [-30, -8],
};

/** The most Money one account can earn from matches and quests per UTC day. Crate refunds don't count. */
export const DAILY_MONEY_CAP = 3500;
export const utcDay = (now = Date.now()) => Math.floor(now / 86400000);
/** Money earned today (0 if the saved day is an earlier one). */
export const earnedToday = (stats, now = Date.now()) => (stats?.daily?.day === utcDay(now) ? stats.daily.earned || 0 : 0);

/** A match only counts for a player who was in it for at least this many rounds. */
export const MIN_ROUNDS_TO_COUNT = 2;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// ---------------------------------------------------------------- pure rules

/** stats: { kills, deaths, headshots, plants, objSecs, roundsWon, rounds } -> { lines: [{ label, amount }], total } */
/** Money from a match that had bots in it, compared with the same match against people. */
export const BOT_MONEY_FACTOR = 0.5;

export function computeMoney(stats, won) {
  const lines = [{ label: 'Match played', amount: REWARD.participation }];
  if (won) lines.push({ label: 'Victory', amount: REWARD.win });
  if (stats.roundsWon > 0) lines.push({ label: `Rounds won (${stats.roundsWon})`, amount: stats.roundsWon * REWARD.perRoundWon });
  if (stats.kills > 0) lines.push({ label: `Kills (${stats.kills})`, amount: stats.kills * REWARD.perKill });
  if (stats.headshots > 0) lines.push({ label: `Headshot kills (${stats.headshots})`, amount: stats.headshots * REWARD.perHeadshotKill });
  const objective = Math.min(REWARD.objectiveCap, Math.floor(stats.objSecs || 0) * REWARD.objectivePerSec);
  if (objective > 0) lines.push({ label: 'Objective play', amount: objective });
  if (stats.plants > 0) lines.push({ label: `Breach charges planted (${stats.plants})`, amount: stats.plants * REWARD.perPlant });
  return { lines, total: lines.reduce((n, l) => n + l.amount, 0) };
}

/** Rank point change for a finished match: win or loss, nudged up to a few points by how the player did. */
export function computeRankDelta(stats, won) {
  const rounds = Math.max(1, stats.rounds || 1);
  const kd = ((stats.kills || 0) - (stats.deaths || 0)) / rounds;
  const adjust = clamp(Math.round(kd * 5) + Math.min(3, Math.floor((stats.objSecs || 0) / 15)), -RANK.adjustMax, RANK.adjustMax);
  return won
    ? clamp(RANK.win + adjust, ...RANK.winRange)
    : clamp(RANK.loss + adjust, ...RANK.lossRange);
}

/** A fresh set of daily quests: distinct, and never more than one that only one side can do. */
export function generateQuests(now = Date.now(), rand = Math.random) {
  const ids = Object.keys(QUESTS);
  const pool = ids.slice();
  const picked = [];
  let sideSpecific = 0;
  while (picked.length < QUEST_COUNT && pool.length) {
    const id = pool.splice(Math.floor(rand() * pool.length), 1)[0];
    if (QUESTS[id].team) { if (sideSpecific >= 1) continue; sideSpecific++; }
    picked.push({ id, progress: 0, done: false });
  }
  return { issuedAt: new Date(now).toISOString(), expiresAt: new Date(now + QUEST_LIFETIME_MS).toISOString(), list: picked };
}

export const questsExpired = (q, now = Date.now()) => !q || !Array.isArray(q.list) || !q.list.length || !(Date.parse(q.expiresAt) > now);

/** Add a finished match to the quests. Returns the new quest object and the quests it completed. */
export function advanceQuests(quests, match) {
  const gain = {
    kills: match.kills, headshots: match.headshots, wins: match.won ? 1 : 0, played: 1, roundsWon: match.roundsWon,
    utilities: match.utilities, objSecs: Math.floor(match.objSecs || 0), plants: match.plants,
    reinforced: match.reinforced, barricades: match.barricades,
  };
  const completed = [];
  const list = quests.list.map((q) => {
    const def = QUESTS[q.id];
    if (!def || q.done) return q;
    const progress = Math.min(def.target, (q.progress || 0) + (gain[def.stat] || 0));
    const done = progress >= def.target;
    if (done) completed.push({ id: q.id, label: def.label, reward: def.reward });
    return { ...q, progress, done };
  });
  return { quests: { ...quests, list }, completed };
}

// ---------------------------------------------------------------- the database side

export class Progression {
  constructor(accounts) {
    this.accounts = accounts;
    this.db = accounts.db;
    this.locks = new Map();   // accountId -> promise chain, so two matches ending together can't overwrite each other
  }

  /** Run fn for one account at a time. */
  async withLock(accountId, fn) {
    const prev = this.locks.get(accountId) || Promise.resolve();
    const run = prev.catch(() => {}).then(fn);
    const tail = run.catch(() => {});
    this.locks.set(accountId, tail);
    try { return await run; } finally { if (this.locks.get(accountId) === tail) this.locks.delete(accountId); }
  }

  async load(accountId) {
    const { rows } = await this.db.query('SELECT * FROM accounts WHERE id = $1', [accountId]);
    return rows[0] || null;
  }

  /** The account row, with a new set of daily quests first if the old set has run out. */
  async ensureQuests(row) {
    if (!questsExpired(row.quests)) return row;
    const { rows } = await this.db.query('UPDATE accounts SET quests = $2 WHERE id = $1 RETURNING *', [row.id, JSON.stringify(generateQuests())]);
    return rows[0] || row;
  }

  /** Tell the account's open tab (if any) about its new numbers. */
  pushProfile(row) {
    this.accounts.online.get(row.id)?.emit('profile', profileOf(row));
  }

  /**
   * A finished match for one player. `match`: { won, rounds, roundsWon, kills, deaths, headshots, plants,
   * reinforced, barricades, utilities, objSecs, score: { yours, theirs } }.
   * Returns the summary the player sees, or null if the account is gone.
   */
  settle(accountId, match) {
    return this.withLock(accountId, async () => {
      let row = await this.load(accountId);
      if (!row) return null;
      row = await this.ensureQuests(row);

      let money = computeMoney(match, match.won);
      // Matches with bots pay half the Money and never move your rank
      if (match.withBots) {
        const lines = money.lines.map((l) => ({ ...l, amount: Math.floor(l.amount * BOT_MONEY_FACTOR) }));
        lines.push({ label: 'Bots in the match: half Money, no rank points', amount: 0 });
        money = { lines, total: lines.reduce((n, l) => n + l.amount, 0) };
      }
      const rankDelta = match.withBots ? 0 : computeRankDelta(match, match.won);
      const { quests, completed } = advanceQuests(row.quests, match);
      const questMoney = completed.reduce((n, q) => n + q.reward, 0);

      // Daily cap: only this much more Money can be earned today. Match Money is paid first, then quest rewards.
      const before = earnedToday(row.stats);
      let allowed = Math.max(0, DAILY_MONEY_CAP - before);
      const paidMatch = Math.min(money.total, allowed);
      allowed -= paidMatch;
      const paidQuests = Math.min(questMoney, allowed);
      const paid = paidMatch + paidQuests;
      const capped = paid < money.total + questMoney;
      const lines = capped ? [...money.lines, { label: 'Daily Money limit reached', amount: paidMatch - money.total }] : money.lines;

      const xp = row.xp + money.total;
      const level = levelFromXp(xp);
      const rankPoints = Math.max(0, row.rank_points + rankDelta);
      const lifetime = row.stats || {};
      const stats = {
        ...lifetime,
        matches: (lifetime.matches || 0) + 1,
        wins: (lifetime.wins || 0) + (match.won ? 1 : 0),
        kills: (lifetime.kills || 0) + match.kills,
        deaths: (lifetime.deaths || 0) + match.deaths,
        daily: { day: utcDay(), earned: before + paid },
      };
      const { rows } = await this.db.query(
        `UPDATE accounts SET money = money + $2, xp = $3, level = $4, rank_points = $5, quests = $6, stats = $7 WHERE id = $1 RETURNING *`,
        [accountId, paid, xp, level, rankPoints, JSON.stringify(quests), JSON.stringify(stats)],
      );
      const updated = rows[0];
      this.pushProfile(updated);
      return {
        won: match.won, score: match.score, rounds: match.rounds,
        stats: { kills: match.kills, deaths: match.deaths, headshots: match.headshots, objSecs: Math.floor(match.objSecs || 0), plants: match.plants },
        money: { lines, total: paidMatch, quests: completed, questTotal: paidQuests, balance: updated.money, cap: { limit: DAILY_MONEY_CAP, earnedToday: before + paid, reached: capped } },
        xp: { gained: money.total, total: xp, levelBefore: row.level, levelAfter: level },
        rank: { before: row.rank_points, after: rankPoints, delta: rankPoints - row.rank_points },
        quests: profileOf(updated).quests,
      };
    });
  }

  /** Leaving a match that is still going: no reward, and it counts against your rank. */
  forfeit(accountId) {
    return this.withLock(accountId, async () => {
      const row = await this.load(accountId);
      if (!row) return null;
      const rankPoints = Math.max(0, row.rank_points + RANK.forfeit);
      const lifetime = row.stats || {};
      const stats = { ...lifetime, matches: (lifetime.matches || 0) + 1, forfeits: (lifetime.forfeits || 0) + 1 };
      const { rows } = await this.db.query('UPDATE accounts SET rank_points = $2, stats = $3 WHERE id = $1 RETURNING *', [accountId, rankPoints, JSON.stringify(stats)]);
      this.pushProfile(rows[0]);
      return rows[0];
    });
  }
}
