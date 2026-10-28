// Thin wrapper around the Socket.IO connection.

import { io } from 'socket.io-client';
import { INTERP_DELAY_MS } from '../../shared/constants.js';

export class Network {
  constructor() {
    this.socket = io({ transports: ['websocket', 'polling'] });
    this.serverOffset = null; // estimate of (server clock - local clock) in ms
    this.ping = 0;

    this.socket.on('snapshot', (snap) => this.trackClock(snap.t));
    setInterval(() => this.measurePing(), 2000);
  }

  get id() {
    return this.socket.id;
  }

  on(event, fn) {
    this.socket.on(event, fn);
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

  sendSpawnChoice(n) {
    this.socket.emit('spawnChoice', n);
  }

  sendAction(type) {
    this.socket.emit('action', type);
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
    if (!this.socket.connected) return;
    const start = performance.now();
    this.socket.volatile.emit('netPing', () => { this.ping = Math.round(performance.now() - start); });
  }
}
