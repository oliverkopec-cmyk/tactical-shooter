// Connections in a Durable Object (match rooms and the central object): the same calls as server/realtime.js's
// sockets (on, emit, join, leave, disconnect, io.to(...).emit), over hibernatable WebSockets.

import { encode } from '../server/protocol.js';

const KICKED = 4001;   // server/realtime.js CLOSE.KICKED

/** One player's connection: the same calls as server/realtime.js's sockets, over a hibernatable WebSocket. */
export class DoSocket {
  constructor(io, ws, { id, account, spectator }) {
    this.io = io;
    this.ws = ws;
    this.id = id;
    this.data = { account };
    this.spectator = !!spectator;
    this.handlers = new Map();
    this.channels = new Set();
    this.connected = true;
    io.sockets.sockets.set(id, this);
  }

  get conn() { return { transport: { writable: true } }; }
  on(event, fn) { if (!this.handlers.has(event)) this.handlers.set(event, []); this.handlers.get(event).push(fn); }
  emit(event, payload) { this.sendText(encode(event, payload)); }
  sendText(text) { if (this.connected) try { this.ws.send(text); } catch { /* closing */ } }
  join(channel) {
    if (!this.io.channels.has(channel)) this.io.channels.set(channel, new Set());
    this.io.channels.get(channel).add(this.id);
    this.channels.add(channel);
  }
  leave(channel) {
    const set = this.io.channels.get(channel);
    if (set) { set.delete(this.id); if (!set.size) this.io.channels.delete(channel); }
    this.channels.delete(channel);
  }
  dispatch(event, args) {
    for (const fn of this.handlers.get(event) || []) {
      try { fn(...args); } catch (err) { console.error(`Handler for "${event}" failed:`, err); }
    }
  }
  /** The server ends this connection: "~kicked" with why ('replaced': another tab took over; 'blocked'), then a close.
   * The page closes it from its side on "~kicked" too. */
  disconnect(reason = 'replaced') {
    if (!this.connected) return;
    this.sendText(JSON.stringify(['~kicked', typeof reason === 'string' ? reason : 'replaced']));
    try { this.ws.close(KICKED, 'disconnected by the server'); } catch { /* gone */ }
    this.closed();
  }
  closed() {
    if (!this.connected) return;
    this.connected = false;
    for (const channel of [...this.channels]) this.leave(channel);
    if (this.io.sockets.sockets.get(this.id) === this) this.io.sockets.sockets.delete(this.id);
    this.dispatch('disconnect', ['transport close']);
  }
}

/** Socket.IO's io.to(...).emit and io.sockets.sockets, for one Durable Object's connections. */
export class DoIo {
  constructor() {
    this.sockets = { sockets: new Map() };
    this.channels = new Map();
  }
  to(target) {
    return {
      emit: (event, payload) => {
        this.onEmit?.(target, event);
        const members = this.channels.get(target);
        if (members) {
          const text = encode(event, payload);
          for (const id of members) this.sockets.sockets.get(id)?.sendText(text);
        } else this.sockets.sockets.get(target)?.emit(event, payload);
      },
    };
  }
}

