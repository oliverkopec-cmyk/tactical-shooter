// Thin wrapper around the Socket.IO connection.

import { io } from 'socket.io-client';
import { INTERP_DELAY_MS } from '../../shared/constants.js';

export class Network {
  constructor() {
    // Connects only once logged in: the server checks the login cookie on connect.
    this.socket = io({ transports: ['websocket', 'polling'], autoConnect: false, auth: { version: __SHARED_VERSION__ } });
    this.serverOffset = null; // estimate of (server clock - local clock) in ms
    this.ping = 0;

    // Snapshots arrive trimmed and as changes only (server/snapshots.js): put each back together into the full
    // picture before anything else sees it.
    this.snapListeners = [];
    this.snapState = null;
    this.lastSnapAt = -1e9;
    this.socket.on('snapshot', (msg) => {
      this.lastSnapAt = performance.now();
      const snap = this.decodeSnapshot(msg);
      this.trackClock(snap.t);
      for (const fn of this.snapListeners) fn(snap);
    });
    setInterval(() => this.measurePing(), 2000);
  }

  get id() {
    return this.socket.id;
  }

  connect() {
    if (!this.socket.connected) this.socket.connect();
  }

  disconnect() {
    this.socket.disconnect();
  }

  /** Resolves true once connected (reconnecting if needed), false on failure or timeout. */
  ensureConnected(timeoutMs = 5000) {
    if (this.socket.connected) return Promise.resolve(true);
    return new Promise((resolve) => {
      const finish = (ok) => {
        clearTimeout(timer);
        this.socket.off('connect', onOk);
        this.socket.off('connect_error', onFail);
        resolve(ok);
      };
      const onOk = () => finish(true);
      const onFail = () => finish(false);
      const timer = setTimeout(() => finish(false), timeoutMs);
      this.socket.once('connect', onOk);
      this.socket.once('connect_error', onFail);
      this.socket.connect();
    });
  }

  on(event, fn) {
    if (event === 'snapshot') this.snapListeners.push(fn);
    else this.socket.on(event, fn);
  }

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

  request(event, payload) {
    return new Promise((resolve) => {
      const done = (res) => resolve(res || {});
      if (payload === undefined) this.socket.timeout(5000).emit(event, (err, res) => done(err ? { error: 'Server did not respond.' } : res));
      else this.socket.timeout(5000).emit(event, payload, (err, res) => done(err ? { error: 'Server did not respond.' } : res));
    });
  }

  sendInputs(batch) {
    this.socket.emit('inputs', batch);
  }

  voteSite(index) {
    this.socket.emit('voteSite', index);
  }

  pickUtility(id) {
    this.socket.emit('pickUtility', id);
  }

  /** A held key went up (it may have been placing something). */
  sendActionEnd(type) {
    this.socket.emit('actionEnd', type);
  }

  /** Skins or charms were changed mid-match: the server re-reads them and tells everyone. */
  refreshLook() {
    this.socket.emit('refreshLook');
  }

  pickOperator(opId) {
    this.socket.emit('pickOperator', opId);
  }

  sendSpawnChoice(n) {
    this.socket.emit('spawnChoice', n);
  }

  sendAction(type) {
    this.socket.emit('action', type);
  }

  sendTeamPing(type) {
    this.socket.emit('teamPing', type);
  }

  leaveRoom() {
    this.socket.emit('leaveRoom');
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

  measurePing() {
    // Only shown in a match: in the menus (no snapshots for a while) nothing is sent
    if (!this.socket.connected || performance.now() - this.lastSnapAt > 3000) return;
    const start = performance.now();
    this.socket.volatile.emit('netPing', () => { this.ping = Math.round(performance.now() - start); });
  }
}
