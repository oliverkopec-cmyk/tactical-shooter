// The realtime connection (Stage C1): plain WebSockets in place of Socket.IO, with a small protocol of our own.
// Cloudflare (later stages) speaks plain WebSockets, and its free plan counts the messages each player sends,
// so the client batches everything it sends during a match (client/src/network.js).
//
// This file gives the rest of the server the same few calls it used from Socket.IO, so rooms, games, social,
// admin and moderation code didn't have to change:
//   io.use(fn), io.on('connection', fn), io.to(socket id or channel).emit(event, payload), io.sockets.sockets
//   socket.id / data / handshake.auth / request.headers, socket.on(event, handler), socket.emit(event, payload),
//   socket.join / leave(channel), socket.disconnect(), socket.connected, socket.conn.transport.writable
//
// The protocol. Every message is a JSON array.
//   Client -> server:
//     ["e", event, payload]         an event; handlers get (payload)
//     ["r", id, event, payload]     a request; handlers get (payload, reply) and the reply goes back as an ack
//     ["b", { i, a, p }]            a match batch (about 7 a second): inputs, then events [[event, payload], ...],
//                                   and p, a ping time the server sends straight back as "pong"
//   Server -> client:
//     [event, payload]              an event
//     ["~ack", id, result]          the answer to a request
//     ["~hello", { id }]            connected and logged in; id is this connection's player id
//     ["~error", message]           refused ("outdated", "unauthorized" or "server error"), then closed
//
// The server sends a WebSocket ping every 25 seconds. Browsers answer it themselves, so a client in the menu
// sends nothing at all, and a connection that stops answering is closed.

import crypto from 'node:crypto';
import { WebSocketServer } from 'ws';
import { encode, receive } from './protocol.js';

const PING_MS = 25_000;
const MAX_MESSAGE_BYTES = 64 * 1024;
// A snapshot is skipped for a player whose connection already has this much waiting (like Socket.IO's "volatile")
const BUSY_BYTES = 64 * 1024;

/** Close codes the client acts on (client/src/network.js) */
export const CLOSE = { REFUSED: 4000, KICKED: 4001 };

export class Realtime {
  /** server: the node http server. path: where the WebSocket is (the client connects to it on the same host). */
  constructor(server, { path = '/ws' } = {}) {
    this.sockets = { sockets: new Map() };   // socket id -> RealtimeSocket (Socket.IO's io.sockets.sockets)
    this.channels = new Map();               // channel -> Set of socket ids
    this.middleware = [];
    this.listeners = [];
    this.wss = new WebSocketServer({
      noServer: true,
      maxPayload: MAX_MESSAGE_BYTES,
      // Compress every message bigger than a few bytes (permessage-deflate, which browsers do natively). Snapshots
      // repeat the same names and numbers all the time, so each connection's running dictionary makes them tiny.
      // This is most of the bandwidth saving. Memory: about 300 KB per connected player.
      perMessageDeflate: { threshold: 64 },
    });
    server.on('upgrade', (req, socket, head) => {
      let url;
      try { url = new URL(req.url, 'http://x'); } catch { socket.destroy(); return; }
      if (url.pathname !== path) { socket.destroy(); return; }
      this.wss.handleUpgrade(req, socket, head, (ws) => this.accept(ws, req, url));
    });
    this.pinger = setInterval(() => {
      for (const s of this.sockets.sockets.values()) {
        if (!s.alive) { s.ws.terminate(); continue; }   // no pong since the last ping: gone
        s.alive = false;
        try { s.ws.ping(); } catch { /* closing */ }
      }
    }, PING_MS);
    this.pinger.unref?.();
  }

  use(fn) { this.middleware.push(fn); }

  on(event, fn) { if (event === 'connection') this.listeners.push(fn); }

  to(target) {
    return {
      emit: (event, payload) => {
        const members = this.channels.get(target);
        if (members) {
          const text = encode(event, payload);
          for (const id of members) this.sockets.sockets.get(id)?.sendText(text);
        } else this.sockets.sockets.get(target)?.emit(event, payload);
      },
    };
  }

  async accept(ws, req, url) {
    const socket = new RealtimeSocket(this, ws, req, url);
    ws.on('pong', () => { socket.alive = true; });
    // Messages that arrive before the checks below finish wait for them
    const early = [];
    ws.on('message', (data, isBinary) => {
      if (isBinary) return;
      if (socket.ready) socket.receive(data.toString());
      else early.push(data.toString());
    });
    ws.on('close', () => socket.closed());
    ws.on('error', () => { /* 'close' follows */ });
    for (const fn of this.middleware) {
      const err = await new Promise((resolve) => {
        try { Promise.resolve(fn(socket, resolve)).catch(resolve); } catch (e) { resolve(e); }
      });
      if (ws.readyState !== ws.OPEN) return;
      if (err) {
        ws.send(JSON.stringify(['~error', err.message || 'refused']));
        ws.close(CLOSE.REFUSED, String(err.message || 'refused').slice(0, 100));
        return;
      }
    }
    this.sockets.sockets.set(socket.id, socket);
    socket.ready = true;
    socket.sendText(JSON.stringify(['~hello', { id: socket.id }]));
    for (const fn of this.listeners) fn(socket);
    for (const text of early) socket.receive(text);
  }
}

class RealtimeSocket {
  constructor(io, ws, req, url) {
    this.io = io;
    this.ws = ws;
    this.id = crypto.randomBytes(9).toString('base64url');
    this.data = {};
    this.handshake = { auth: { version: url.searchParams.get('v') || '' } };
    this.request = { headers: req.headers };
    this.handlers = new Map();   // event -> [fn]
    this.channels = new Set();
    this.ready = false;
    this.alive = true;
    this.connected = true;
  }

  /** Socket.IO's socket.conn.transport.writable, used to skip a snapshot for a player whose connection is backed up. */
  get conn() { return { transport: { writable: this.ws.bufferedAmount < BUSY_BYTES } }; }

  on(event, fn) {
    if (!this.handlers.has(event)) this.handlers.set(event, []);
    this.handlers.get(event).push(fn);
  }

  emit(event, payload) { this.sendText(encode(event, payload)); }

  sendText(text) {
    if (!this.connected || this.ws.readyState !== this.ws.OPEN) return;
    this.ws.send(text);
  }

  join(channel) {
    if (!this.io.channels.has(channel)) this.io.channels.set(channel, new Set());
    this.io.channels.get(channel).add(this.id);
    this.channels.add(channel);
  }

  leave(channel) {
    const set = this.io.channels.get(channel);
    if (set) {
      set.delete(this.id);
      if (!set.size) this.io.channels.delete(channel);
    }
    this.channels.delete(channel);
  }

  /** The server ends this connection (logged out, replaced by a newer tab, suspended). The client won't reconnect. */
  disconnect() {
    if (!this.connected) return;
    this.ws.close(CLOSE.KICKED, 'disconnected by the server');
    this.closed();
  }

  /** Run an event's handlers. args are what they get; a request adds its reply function last. */
  dispatch(event, args) {
    for (const fn of this.handlers.get(event) || []) {
      try { fn(...args); } catch (err) { console.error(`Handler for "${event}" failed:`, err); }
    }
  }

  receive(text) { receive(this, text); }

  closed() {
    if (!this.connected) return;
    this.connected = false;
    for (const channel of [...this.channels]) this.leave(channel);
    if (this.io.sockets.sockets.get(this.id) === this) this.io.sockets.sockets.delete(this.id);
    if (this.ready) this.dispatch('disconnect', ['transport close']);
  }
}
