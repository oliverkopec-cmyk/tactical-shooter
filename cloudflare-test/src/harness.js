// Stage C0 test harness: runs a real Breachline room (server/rooms.js, GameState, bots, rounds, gadgets) without
// Socket.IO. A tiny stand-in for the `io` object routes the game's emits to whatever transport the caller gives it:
// plain WebSockets in the Durable Object (src/worker.js), or nothing in the local benchmark (bench.mjs).
// Nothing here changes how the live game runs.

import { RoomManager } from '../../server/rooms.js';
import { OPERATORS } from '../../shared/operators.js';

/** Just enough of Socket.IO's server object for rooms.js and gameState.js: io.to(room or socket id).emit(...). */
export class FakeIo {
  constructor() {
    this.sockets = { sockets: new Map() };   // socket id -> FakeSocket (snapshots.js looks players up here)
    this.channels = new Map();               // channel -> Set of socket ids
  }

  to(target) {
    return {
      emit: (event, payload) => {
        const members = this.channels.get(target);
        if (members) for (const id of members) this.sockets.sockets.get(id)?.emit(event, payload);
        else this.sockets.sockets.get(target)?.emit(event, payload);   // a socket id (bots have none: dropped)
      },
    };
  }
}

/** Stands in for one Socket.IO socket. send(event, payload) is the transport. */
export class FakeSocket {
  constructor(io, id, username, send) {
    this.io = io;
    this.id = id;
    this.connected = true;
    this.conn = { transport: { writable: true } };
    this.send = send;
    this.data = {
      account: {
        id: null, username,
        skins: {}, charms: {}, attachments: {}, operators: {}, owned: Object.keys(OPERATORS), opMatches: {},
      },
    };
    io.sockets.sockets.set(id, this);
  }

  join(channel) {
    if (!this.io.channels.has(channel)) this.io.channels.set(channel, new Set());
    this.io.channels.get(channel).add(this.id);
  }

  leave(channel) { this.io.channels.get(channel)?.delete(this.id); }

  emit(event, payload) { if (this.connected) this.send(event, payload); }

  close() {
    this.connected = false;
    for (const set of this.io.channels.values()) set.delete(this.id);
    this.io.sockets.sockets.delete(this.id);
  }
}

/**
 * One test match. Players join, then start() fills the empty slots with bots (or not) and starts the match.
 * When a match ends the room goes back to the lobby; the test starts the next one straight away, so the
 * load never stops while the test runs.
 */
export class TestMatch {
  constructor({ mapId = null, difficulty = 'normal' } = {}) {
    this.io = new FakeIo();
    this.rooms = new RoomManager(this.io);
    this.room = this.rooms.createRoom();
    if (mapId) this.room.mapId = mapId;
    this.difficulty = difficulty;
    this.fill = true;
    this.matches = 0;
    this.restartTimer = null;
  }

  addPlayer(id, send) {
    const socket = new FakeSocket(this.io, id, `tester-${id}`, send);
    this.room.add(socket);
    return socket;
  }

  removePlayer(id) {
    const socket = this.io.sockets.sockets.get(id);
    if (!socket) return;
    this.room.remove(socket);
    socket.close();
  }

  get players() { return [...this.room.members.values()].filter((m) => !m.bot).length; }
  get bots() { return [...this.room.members.values()].filter((m) => m.bot).length; }
  get running() { return this.room.phase === 'match' && !!this.room.game; }

  /** fill: put bots in every empty slot (a 10-player match). */
  start({ fill = true } = {}) {
    this.fill = fill;
    if (!this.room.hostId) return { error: 'Nobody is in the room.' };
    if (this.running) return { ok: true, already: true };
    if (fill) {
      const res = this.room.fillBots(this.room.hostId, this.difficulty);
      if (res.error) return res;
    }
    const res = this.room.start(this.room.hostId);
    if (res.error) return res;
    this.matches++;
    this.watchForEnd();
    return { ok: true };
  }

  /** A finished match goes back to the lobby: start another one so the test keeps its load. */
  watchForEnd() {
    clearInterval(this.restartTimer);
    this.restartTimer = setInterval(() => {
      if (this.running || !this.room.hostId) return;
      const res = this.room.start(this.room.hostId);
      if (!res.error) this.matches++;
    }, 1000);
  }

  stop() {
    clearInterval(this.restartTimer);
    this.restartTimer = null;
    if (this.room.game) this.room.game.stop();
  }
}

/**
 * What a client would send: inputs for every frame since the last batch, at 60 frames a second.
 * Walks in a slowly turning circle and fires now and then, so the server does real movement, collision and shooting.
 */
export class FakeInputs {
  constructor(seed = 1) {
    this.seq = 0;
    this.yaw = seed;
    this.frame = 0;
  }

  batch(frames) {
    const out = [];
    for (let i = 0; i < frames; i++) {
      this.frame++;
      this.yaw = (this.yaw + 0.01) % (Math.PI * 2);
      let keys = 1;                                    // forward
      if (this.frame % 240 < 60) keys |= 8;            // strafe right a quarter of the time
      if (this.frame % 180 < 20) keys |= 256;          // fire in short bursts
      if (this.frame % 600 < 120) keys |= 32768;       // aim sometimes
      out.push({ seq: ++this.seq, dt: 1 / 60, keys, yaw: this.yaw, pitch: 0, wsel: 0, rt: Date.now() });
    }
    return out;
  }
}
