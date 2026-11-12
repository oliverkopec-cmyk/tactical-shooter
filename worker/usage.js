// Daily usage against the Workers Free plan (Stage C6), and when to call the servers "full for today".
//
// Cloudflare doesn't tell a Worker how much of its daily allowance it has used, so the game counts it itself: every
// Durable Object counts what it receives, the Worker counts its own requests, and the central object adds it all up per
// UTC day (worker/central.js). The numbers follow the billing rules measured in Stage C0:
//   - Durable Object requests (100,000 a day): an incoming WebSocket message counts 1/20; a connection, a call from
//     the Worker or another object, and an alarm count 1 each.
//   - Worker requests (100,000 a day): every request that runs the Worker (the API, /ws, /room). The game's files are
//     static assets: free and not counted.
//   - Duration (13,000 GB-s a day): a Durable Object is charged as 128 MB for every second it is awake. A match room
//     is awake for the whole match (its 60 Hz loop); a lobby or the central object sleeps between events.
// They are estimates: Cloudflare's own dashboard is the final word. FULL_AT leaves room for the matches already running
// to finish (a 15-minute match of 10 players is about 3,000 requests) and for the menus.
//
// DAILY_LIMIT_SCALE (a setting, for testing only) shrinks the allowances, e.g. 0.001 fills up after 100 requests.

export const FREE = { doRequests: 100_000, workerRequests: 100_000, durationGBs: 13_000 };
export const FULL_AT = 0.8;             // from 80% of any allowance: no new matches or rooms until the reset
export const MAX_LIVE_MATCHES = 6;      // matches running at once (memory: 15–30 MB each, Stage C0)
const MESSAGES_PER_REQUEST = 20;
const GB_PER_OBJECT = 0.125;            // 128 MB
const HISTORY_DAYS = 14;

export const utcDay = (t = Date.now()) => new Date(t).toISOString().slice(0, 10);
/** Next 00:00 UTC, when Cloudflare resets the daily allowances. */
export const nextReset = (t = Date.now()) => { const d = new Date(t); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1); };

/** What one object counted since it last reported. */
export const emptyCounts = () => ({ wsMessages: 0, doCalls: 0, workerRequests: 0, durationSec: 0, matches: 0, connections: 0 });

export function addCounts(into, add) {
  for (const k of Object.keys(into)) into[k] += Number(add?.[k]) || 0;
  return into;
}

export const hasCounts = (c) => Object.values(c).some((v) => v > 0);

export function budgets(scale = 1) {
  const s = Number(scale) > 0 ? Number(scale) : 1;
  return { doRequests: FREE.doRequests * s, workerRequests: FREE.workerRequests * s, durationGBs: FREE.durationGBs * s };
}

/** One day's counts as the admin panel shows them, and whether the servers are full. */
export function usageView(day, counts, scale = 1) {
  const b = budgets(scale);
  const used = {
    doRequests: Math.round(counts.wsMessages / MESSAGES_PER_REQUEST + counts.doCalls),
    workerRequests: Math.round(counts.workerRequests),
    durationGBs: Math.round(counts.durationSec * GB_PER_OBJECT),
  };
  const share = { doRequests: used.doRequests / b.doRequests, workerRequests: used.workerRequests / b.workerRequests, durationGBs: used.durationGBs / b.durationGBs };
  const worst = Math.max(...Object.values(share));
  return {
    day, used, limits: b, share, worst,
    full: worst >= FULL_AT,
    matches: counts.matches, connections: counts.connections, wsMessages: counts.wsMessages,
    resetsAt: Date.parse(`${day}T00:00:00Z`) + 24 * 3600 * 1000,
  };
}

export const FULL_MESSAGE = 'Breachline\'s servers are full for today, so new matches can\'t start. Matches already running will finish. Come back after the daily reset!';
export const BUSY_MESSAGE = `All the match servers are busy (${MAX_LIVE_MATCHES} matches are running). Try again in a few minutes.`;

/** The central object's running total, saved to its storage now and then (row writes are limited too). */
export class UsageBook {
  constructor(storage, scale) {
    this.storage = storage;
    this.scale = scale;
    this.day = utcDay();
    this.counts = emptyCounts();
    this.savedAt = 0;
    this.dirty = false;
  }

  async load() {
    const saved = await this.storage.get(`usage:${this.day}`);
    if (saved) addCounts(this.counts, saved);
  }

  /** Add counts; returns true when that changed whether the servers are full. */
  add(delta) {
    const before = this.view().full;
    if (utcDay() !== this.day) {
      this.save(true);
      this.day = utcDay();
      this.counts = emptyCounts();
      this.storage.delete(`usage:${utcDay(Date.now() - HISTORY_DAYS * 24 * 3600 * 1000)}`);
    }
    addCounts(this.counts, delta);
    this.dirty = true;
    this.save();
    return this.view().full !== before;
  }

  save(now = false) {
    if (!this.dirty || (!now && Date.now() - this.savedAt < 30_000)) return;
    this.dirty = false;
    this.savedAt = Date.now();
    this.storage.put(`usage:${this.day}`, { ...this.counts });
  }

  view() {
    if (utcDay() !== this.day) return usageView(utcDay(), emptyCounts(), this.scale);
    return usageView(this.day, this.counts, this.scale);
  }

  /** The last few days, newest first, for the admin panel. */
  async history(days = 7) {
    const keys = [];
    for (let i = 1; i <= days; i++) keys.push(`usage:${utcDay(Date.now() - i * 24 * 3600 * 1000)}`);
    const got = await this.storage.get(keys);
    return keys.filter((k) => got.get(k)).map((k) => usageView(k.slice(6), { ...emptyCounts(), ...got.get(k) }, this.scale));
  }
}
