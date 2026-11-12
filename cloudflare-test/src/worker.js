// Stage C0 test Worker: can Breachline run on Cloudflare Workers Free?
//
// One Durable Object (SQLite backend) per test room runs the REAL match code (server/rooms.js, GameState, bots,
// rounds, gadgets, snapshots) at 60 ticks a second. Players connect with plain WebSockets using the Hibernation API
// (ctx.acceptWebSocket). The object counts what it receives and sends, and how steady its ticks are, and saves the
// counts in its own storage so they survive it being moved or restarted. load.mjs plays the clients.
//
//   /                          what this is
//   /room/<name>/ws?id=<id>    WebSocket: join that test room (the first message {t:'start'} starts a match)
//   /room/<name>/stats         JSON: everything counted so far in that room
//   /room/<name>/reset         clear that room's counts
//   /room/<name>/cpu?kind=...  CPU test run inside a Durable Object
//   /cpu?kind=...              CPU test run in the plain Worker (the 10 ms Free limit)
//
// CPU test kinds: pbkdf2 (n = iterations, max 100000), bcrypt (checks a cost-11 hash, like the game's passwords
// today), spin (n = millions of loop steps).
//
// Messages from a client (JSON): {t:'start', fill:true, map:'villa', rehome:false} | {t:'in', b:[inputs...], p:<time>} | {t:'ping', p:<time>}
//                                | {t:'x'} (does nothing: for counting) | {t:'stop'}
// Messages to a client: JSON [event, payload], the same events the game sends today.

import { DurableObject } from 'cloudflare:workers';
import bcrypt from 'bcryptjs';
import { GameState } from '../../server/gameState.js';
import { MAP_IDS } from '../../shared/map.js';
import { TestMatch } from './harness.js';

// bcrypt of "breachline-test" at cost 11, the cost server/accounts.js uses today
const BCRYPT_TEST_HASH = '$2b$11$S2HtOD1CYO3JO/8o6gSyOeOM3QsIN3/.MpQ5Ij24CyH/IXSK35vue';
const SAVE_EVERY_MS = 10_000;
const REHOME_MS = 15_000;          // with {t:'start', rehome:true}: restart the loop from an alarm this often
const WINDOWS_KEPT = 90;          // 15 minutes of 10-second windows
const LATE_TICK_MS = 40;          // a gap this long between ticks means the loop fell behind (60 Hz is 16.7 ms)
const MAX_MESSAGE_BYTES = 64 * 1024;

// Every tick of every match tells its test room (one hook for the whole isolate; each room has its own counter)
const realUpdate = GameState.prototype.update;
GameState.prototype.update = function update() {
  realUpdate.call(this);
  this.room.c0Tick?.();
};

async function cpuTest(kind, n) {
  if (kind === 'pbkdf2') {
    const iterations = Math.min(100_000, Math.max(1, Number(n) || 100_000));
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode('breachline-test'), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: new Uint8Array(16), iterations }, key, 256);
    return { kind, iterations, ok: bits.byteLength === 32 };
  }
  if (kind === 'bcrypt') {
    return { kind, cost: 11, ok: bcrypt.compareSync('breachline-test', BCRYPT_TEST_HASH) };
  }
  if (kind === 'spin') {
    const steps = Math.min(5000, Math.max(1, Number(n) || 10)) * 1e6;
    let x = 0;
    for (let i = 0; i < steps; i++) x += Math.sqrt(i);
    return { kind, millionSteps: steps / 1e6, ok: x > 0 };
  }
  return { error: 'kind must be pbkdf2, bcrypt or spin' };
}

const json = (data, status = 200) => new Response(JSON.stringify(data, null, 2), { status, headers: { 'content-type': 'application/json' } });

function freshStats() {
  return {
    firstAt: Date.now(), wakes: 0, connects: 0, closes: 0, closeCodes: {},
    msgsIn: 0, bytesIn: 0, msgsOut: 0, bytesOut: 0,
    ticks: 0, lateTicks: 0, maxTickGapMs: 0, matchesStarted: 0,
    windows: [], errors: [],
  };
}

export class MatchTest extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.match = null;
    this.lastTickAt = 0;
    this.window = null;
    this.savedAt = 0;
    // Runs on every start, including waking from hibernation: count the wakes
    ctx.blockConcurrencyWhile(async () => {
      this.stats = { ...freshStats(), ...((await this.ctx.storage.get('stats')) || {}) };
      this.stats.wakes++;
      this.stats.lastWakeAt = Date.now();
      await this.save(true);
    });
  }

  async save(force = false) {
    const now = Date.now();
    if (!force && now - this.savedAt < SAVE_EVERY_MS) return;
    this.savedAt = now;
    this.stats.savedAt = now;
    await this.ctx.storage.put('stats', this.stats);
  }

  note(error) {
    this.stats.errors.push({ at: Date.now(), error: String(error).slice(0, 200) });
    if (this.stats.errors.length > 10) this.stats.errors.shift();
  }

  /** The window of counts for the current 10 seconds; closes the last one when its time is up. */
  win() {
    const now = Date.now();
    if (!this.window || now - this.window.at >= SAVE_EVERY_MS) {
      if (this.window) {
        this.window.sec = (now - this.window.at) / 1000;
        this.window.players = this.match?.players ?? 0;
        this.window.bots = this.match?.bots ?? 0;
        this.window.phase = this.match?.room.game?.rounds?.phase ?? null;
        this.stats.windows.push(this.window);
        if (this.stats.windows.length > WINDOWS_KEPT) this.stats.windows.shift();
        this.save();
      }
      this.window = { at: now, ticks: 0, msgsIn: 0, msgsOut: 0, bytesOut: 0 };
    }
    return this.window;
  }

  onTick() {
    const now = Date.now();
    const gap = this.lastTickAt ? now - this.lastTickAt : 0;
    this.lastTickAt = now;
    this.stats.ticks++;
    if (gap > LATE_TICK_MS) this.stats.lateTicks++;
    if (gap > this.stats.maxTickGapMs && gap < 60_000) this.stats.maxTickGapMs = gap;
    this.win().ticks++;
  }

  sender(ws) {
    return (event, payload) => {
      const text = JSON.stringify([event, payload]);
      try {
        ws.send(text);
        this.stats.msgsOut++;
        this.stats.bytesOut += text.length;
        const w = this.win();
        w.msgsOut++;
        w.bytesOut += text.length;
      } catch { /* closing */ }
    };
  }

  /** The room in memory, rebuilt after a wake with everyone still connected. */
  ensureMatch() {
    if (!this.match) {
      this.match = new TestMatch();
      this.match.room.c0Tick = () => this.onTick();
      this.lastTickAt = 0;
    }
    for (const ws of this.ctx.getWebSockets()) {
      const { id } = ws.deserializeAttachment() || {};
      if (id && !this.match.io.sockets.sockets.has(id)) this.match.addPlayer(id, this.sender(ws));
    }
    return this.match;
  }

  async fetch(request) {
    const url = new URL(request.url);
    const action = url.pathname.split('/')[3] || '';

    if (action === 'ws') {
      if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected a WebSocket', { status: 426 });
      const id = (url.searchParams.get('id') || crypto.randomUUID().slice(0, 8)).replace(/[^\w-]/g, '').slice(0, 24);
      const { 0: client, 1: server } = new WebSocketPair();
      this.ctx.acceptWebSocket(server);
      server.serializeAttachment({ id });
      this.stats.connects++;
      try {
        if (this.match?.io.sockets.sockets.has(id)) this.match.removePlayer(id);
        this.ensureMatch();
      } catch (err) { this.note(err.stack || err); }
      await this.save();
      return new Response(null, { status: 101, webSocket: client });
    }

    if (action === 'stats') {
      const m = this.match;
      return json({
        ...this.stats,
        now: Date.now(),
        current: {
          socketsOpen: this.ctx.getWebSockets().length,
          players: m?.players ?? 0, bots: m?.bots ?? 0, running: !!m?.running,
          phase: m?.room.game?.rounds?.phase ?? null, map: m?.room.mapId ?? null, matchesInThisWake: m?.matches ?? 0,
          window: this.window,
        },
      });
    }

    if (action === 'reset') {
      this.stats = { ...freshStats(), wakes: 1, lastWakeAt: Date.now() };
      await this.save(true);
      return json({ ok: true });
    }

    if (action === 'cpu') return json({ where: 'durable-object', ...(await cpuTest(url.searchParams.get('kind'), url.searchParams.get('n'))) });

    return new Response('Unknown room action', { status: 404 });
  }

  async webSocketMessage(ws, message) {
    const size = typeof message === 'string' ? message.length : message.byteLength;
    this.stats.msgsIn++;
    this.stats.bytesIn += size;
    this.win().msgsIn++;
    if (size > MAX_MESSAGE_BYTES || typeof message !== 'string') return;
    let msg;
    try { msg = JSON.parse(message); } catch { return; }
    const { id } = ws.deserializeAttachment() || {};
    try {
      const match = this.ensureMatch();
      if (msg.t === 'in') {
        match.room.handleInputs(id, msg.b);
        if (msg.p) ws.send(JSON.stringify(['pong', msg.p]));
      } else if (msg.t === 'ping') {
        ws.send(JSON.stringify(['pong', msg.p ?? null]));
      } else if (msg.t === 'start') {
        if (typeof msg.map === 'string' && !match.running && MAP_IDS.includes(msg.map)) match.room.mapId = msg.map;
        const res = match.start({ fill: msg.fill !== false });
        if (res.ok && !res.already) this.stats.matchesStarted++;
        // rehome: restart the loop from an alarm every REHOME_MS, so its CPU always belongs to a fresh invocation
        this.rehome = !!msg.rehome;
        this.stats.rehome = this.rehome;
        if (this.rehome) await this.ctx.storage.setAlarm(Date.now() + REHOME_MS);
        ws.send(JSON.stringify(['started', { ...res, players: match.players, bots: match.bots, map: match.room.mapId }]));
      } else if (msg.t === 'stop') {
        match.stop();
      }
      // 'x' does nothing: it is only there to be counted
    } catch (err) {
      this.note(err.stack || err);
    }
    await this.save();
  }

  /**
   * The 60 Hz loop is a setInterval, and Cloudflare charges a timer's CPU to the invocation that created it. One
   * invocation may use 30 s of CPU, so a loop started by one message dies after 30 s of CPU (about 5 minutes of a
   * busy match) unless it is restarted. The alarm restarts it here, inside a fresh invocation.
   */
  async alarm() {
    this.stats.alarms = (this.stats.alarms || 0) + 1;
    const game = this.match?.room.game;
    if (!this.rehome || !this.match) return;
    if (game?.timer) {
      clearInterval(game.timer);
      game.timer = setInterval(() => game.update(), 1000 / 60);
    }
    this.match.watchForEnd();
    await this.save();
    await this.ctx.storage.setAlarm(Date.now() + REHOME_MS);
  }

  async webSocketClose(ws, code) {
    this.stats.closes++;
    this.stats.closeCodes[code] = (this.stats.closeCodes[code] || 0) + 1;
    const { id } = ws.deserializeAttachment() || {};
    try { ws.close(1000, 'bye'); } catch { /* already closed */ }
    if (this.match && id) {
      try { this.match.removePlayer(id); } catch (err) { this.note(err.stack || err); }
      if (this.match.players === 0) {
        // Nobody left: stop every timer so the object can hibernate
        this.match.stop();
        this.match = null;
      }
    }
    await this.save(true);
  }

  async webSocketError(ws, error) {
    this.note(`socket error: ${error?.message || error}`);
    await this.webSocketClose(ws, 1006);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts[0] === 'room' && parts[1]) {
      const name = parts[1].replace(/[^\w-]/g, '').slice(0, 32);
      return env.MATCH.get(env.MATCH.idFromName(name)).fetch(request);
    }
    if (parts[0] === 'cpu') {
      return json({ where: 'worker', ...(await cpuTest(url.searchParams.get('kind'), url.searchParams.get('n'))) });
    }
    return new Response('Breachline Stage C0 test Worker. See cloudflare-test/README.md in the repo.\n', { headers: { 'content-type': 'text/plain' } });
  },
};
