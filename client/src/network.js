// The connection to the game server: a plain WebSocket with a small protocol of our own (Stage C1, replacing
// Socket.IO). The server side, and the full protocol, is in server/realtime.js.
//
// What the client sends, and when (Cloudflare's free plan counts every message a player sends):
//   - In a match: one batch about 7 times a second, holding every input since the last one, the in-match events
//     (actions, team pings, operator and gadget picks...) and, every 2 seconds, a ping time. A batch only goes when
//     there is something in it, so a dead or spectating player sends nothing.
//   - In the menus: only what the player does (create a room, open a gift, chat...). Nothing in the background:
//     the server's WebSocket pings are answered by the browser itself.

import { INTERP_DELAY_MS, INPUT_SEND_RATE } from '../../shared/constants.js';

const REQUEST_TIMEOUT_MS = 5000;
const PING_EVERY_MS = 2000;
const MAX_BATCH_INPUTS = 64;      // the server takes at most this many inputs from one batch
const MAX_WAITING_INPUTS = 128;   // more than this waiting (a stalled tab): the oldest are dropped, prediction corrects it
const RECONNECT_MS = [1000, 2000, 4000, 8000];
const KICKED = 4001;              // server/realtime.js CLOSE.KICKED: logged out elsewhere, suspended... don't reconnect

export class Network {
  constructor() {
    this.ws = null;
    this.id = null;              // this connection's player id, from the server's hello
    this.connected = false;      // open and logged in
    this.wanted = false;         // connect() was called and disconnect() wasn't: reconnect if the connection drops
    this.listeners = new Map();  // event -> [fn]
    this.requests = new Map();   // request id -> resolve
    this.nextRequest = 1;
    this.early = [];             // messages sent while still connecting: they go once the server says hello
    this.retry = { n: 0, timer: null };
    this.inputs = [];            // waiting for the next batch
    this.events = [];
    this.lastPingAt = -1e9;
    this.ping = 0;
    this.serverOffset = null;    // estimate of (server clock - local clock) in ms

    // Snapshots arrive trimmed and as changes only (server/snapshots.js): put each back together into the full
    // picture before anything else sees it.
    this.snapListeners = [];
    this.snapState = null;
    this.lastSnapAt = -1e9;
    this.on('pong', (t) => { if (typeof t === 'number') this.ping = Math.max(0, Math.round(performance.now() - t)); });
    setInterval(() => this.flush(), 1000 / INPUT_SEND_RATE);
  }

  // ---------------------------------------------------------------- connecting

  connect() {
    this.wanted = true;
    if (!this.ws) this.open();
  }

  disconnect() {
    this.wanted = false;
    clearTimeout(this.retry.timer);
    const ws = this.ws, was = this.connected;
    if (!ws) return;
    this.dropped();
    try { ws.close(1000); } catch { /* already closed */ }
    if (was) this.fire('disconnect', 'io client disconnect');
  }

  /** Resolves true once connected (reconnecting if needed), false on failure or timeout. */
  ensureConnected(timeoutMs = 5000) {
    if (this.connected) return Promise.resolve(true);
    return new Promise((resolve) => {
      const finish = (ok) => {
        clearTimeout(timer);
        this.off('connect', onOk);
        this.off('connect_error', onFail);
        resolve(ok);
      };
      const onOk = () => finish(true);
      const onFail = () => finish(false);
      const timer = setTimeout(() => finish(false), timeoutMs);
      this.on('connect', onOk);
      this.on('connect_error', onFail);
      this.connect();
    });
  }

  open() {
    clearTimeout(this.retry.timer);
    const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws?v=${encodeURIComponent(__SHARED_VERSION__)}`;
    const ws = new WebSocket(url);
    this.ws = ws;
    let refused = null;
    ws.onmessage = (e) => {
      if (this.ws !== ws || typeof e.data !== 'string') return;
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      if (!Array.isArray(msg)) return;
      const [event, a, b] = msg;
      if (event === '~hello') {
        this.id = a?.id ?? null;
        this.connected = true;
        this.retry.n = 0;
        for (const text of this.early.splice(0)) ws.send(text);
        this.fire('connect');
      } else if (event === '~error') {
        refused = String(a || 'refused');
      } else if (event === '~ack') {
        const done = this.requests.get(a);
        this.requests.delete(a);
        done?.(b);
      } else if (event === 'snapshot') {
        this.lastSnapAt = performance.now();
        const snap = this.decodeSnapshot(a);
        this.trackClock(snap.t);
        for (const fn of this.snapListeners) fn(snap);
      } else {
        this.fire(event, a);
      }
    };
    ws.onclose = (e) => {
      if (this.ws !== ws) return;   // disconnect() already dealt with it
      const was = this.connected;
      this.dropped();
      if (refused) {
        // Refused (an old page, or the login ran out): like Socket.IO, don't keep trying by itself
        this.wanted = false;
        this.fire('connect_error', new Error(refused));
        return;
      }
      if (e.code === KICKED) this.wanted = false;
      if (was) this.fire('disconnect', e.code === KICKED ? 'io server disconnect' : 'transport close');
      else this.fire('connect_error', new Error('could not connect'));
      if (this.wanted) {
        const wait = RECONNECT_MS[Math.min(this.retry.n++, RECONNECT_MS.length - 1)];
        this.retry.timer = setTimeout(() => { if (this.wanted && !this.ws) this.open(); }, wait);
      }
    };
  }

  /** The connection is gone: forget what was waiting to be sent, and answer every open request. */
  dropped() {
    this.ws = null;
    this.connected = false;
    this.id = null;
    this.early.length = 0;
    this.inputs.length = 0;
    this.events.length = 0;
    this.snapState = null;
    for (const done of this.requests.values()) done({ error: 'Server did not respond.' });
    this.requests.clear();
  }

  // ---------------------------------------------------------------- events

  on(event, fn) {
    if (event === 'snapshot') { this.snapListeners.push(fn); return; }
    if (!this.listeners.has(event)) this.listeners.set(event, []);
    this.listeners.get(event).push(fn);
  }

  off(event, fn) {
    const list = this.listeners.get(event);
    const i = list ? list.indexOf(fn) : -1;
    if (i >= 0) list.splice(i, 1);
  }

  fire(event, payload) {
    for (const fn of [...(this.listeners.get(event) || [])]) {
      try { fn(payload); } catch (err) { console.error(`Handler for "${event}" failed:`, err); }
    }
  }

  /** Send now (or as soon as the connection is up). Returns false when there is no connection at all. */
  sendNow(msg) {
    const text = JSON.stringify(msg);
    if (this.connected && this.ws?.readyState === WebSocket.OPEN) { this.ws.send(text); return true; }
    if (this.ws) { this.early.push(text); return true; }
    return false;
  }

  /** A request the server answers: resolves with its answer, or { error } after 5 seconds. */
  request(event, payload) {
    return new Promise((resolve) => {
      const id = this.nextRequest++;
      const timer = setTimeout(() => { this.requests.delete(id); resolve({ error: 'Server did not respond.' }); }, REQUEST_TIMEOUT_MS);
      this.requests.set(id, (res) => { clearTimeout(timer); resolve(res || {}); });
      if (!this.sendNow(payload === undefined ? ['r', id, event] : ['r', id, event, payload])) {
        clearTimeout(timer);
        this.requests.delete(id);
        resolve({ error: 'Server did not respond.' });
      }
    });
  }

  /** An event that goes straight away (menu actions with no answer). */
  send(event, payload) {
    this.sendNow(payload === undefined ? ['e', event] : ['e', event, payload]);
  }

  // ---------------------------------------------------------------- the match batch

  /** An in-match event: it goes with the next batch, after the inputs made before it. */
  queue(event, payload) {
    if (!this.connected) return;
    this.events.push(payload === undefined ? [event] : [event, payload]);
  }

  sendInputs(list) {
    if (!this.connected || !list.length) return;
    this.inputs.push(...list);
    if (this.inputs.length > MAX_WAITING_INPUTS) this.inputs.splice(0, this.inputs.length - MAX_WAITING_INPUTS);
  }

  /** About 7 times a second: send what is waiting, if anything is. */
  flush() {
    if (!this.connected || (!this.inputs.length && !this.events.length)) return;
    const batch = {};
    if (this.inputs.length) batch.i = this.inputs.splice(0, MAX_BATCH_INPUTS);
    if (this.events.length) batch.a = this.events.splice(0);
    // The ping rides along while playing (shown on the HUD). Spectating or dead, there are no inputs and no ping.
    const now = performance.now();
    if (batch.i && now - this.lastPingAt >= PING_EVERY_MS) {
      this.lastPingAt = now;
      batch.p = Math.round(now);
    }
    this.ws.send(JSON.stringify(['b', batch]));
  }

  voteSite(index) { this.queue('voteSite', index); }

  pickUtility(id) { this.queue('pickUtility', id); }

  /** A held key went up (it may have been placing something). */
  sendActionEnd(type) { this.queue('actionEnd', type); }

  /** Skins or charms were changed mid-match: the server re-reads them and tells everyone. */
  refreshLook() { this.queue('refreshLook'); }

  pickOperator(opId) { this.queue('pickOperator', opId); }

  sendSpawnChoice(n) { this.queue('spawnChoice', n); }

  sendAction(type) { this.queue('action', type); }

  sendTeamPing(type) { this.queue('teamPing', type); }

  leaveRoom() {
    this.inputs.length = 0;
    this.events.length = 0;
    this.send('leaveRoom');
  }

  // ---------------------------------------------------------------- snapshots and time

  /**
   * A snapshot message -> { t, players, cap, df, drones, grenades }, as complete as if the whole thing had been sent.
   * k: a full copy. Otherwise each player entry holds only what changed (null: the field has gone), and the other
   * parts are only there when they changed. Every entry is a new object, since remote players keep them in a buffer.
   */
  decodeSnapshot(msg) {
    if (msg.k || !this.snapState) this.snapState = { players: new Map(), cap: null, df: undefined, drones: [], grenades: [] };
    const st = this.snapState;
    const players = msg.p.map((d) => {
      const prev = msg.k ? null : st.players.get(d.id);
      const cur = prev ? { ...prev } : {};
      for (const k in d) { if (d[k] === null) delete cur[k]; else cur[k] = d[k]; }
      return cur;
    });
    st.players = new Map(players.map((p) => [p.id, p]));
    if ('cap' in msg) st.cap = msg.cap;
    if ('df' in msg) st.df = msg.df;
    if ('dr' in msg) st.drones = msg.dr || [];
    if ('gr' in msg) st.grenades = msg.gr || [];
    return { t: msg.t, players, cap: st.cap, df: st.df, drones: st.drones, grenades: st.grenades };
  }

  // Snapshots carry server time. Track the offset, favouring the lowest-latency
  // samples, so remote players can be rendered at a consistent point in the past.
  trackClock(serverTime) {
    const sample = serverTime - Date.now();
    if (this.serverOffset === null) this.serverOffset = sample;
    else if (sample > this.serverOffset) this.serverOffset += (sample - this.serverOffset) * 0.5;
    else this.serverOffset += (sample - this.serverOffset) * 0.02;
  }

  renderTime() {
    return Date.now() + (this.serverOffset ?? 0) - INTERP_DELAY_MS;
  }
}
