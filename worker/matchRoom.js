// One Durable Object per room code (Stage C3): the room's lobby and its match, run by the same code as on the Node
// server (server/rooms.js, GameState, bots, rounds, gadgets, server/roomEvents.js). Players connect straight to it
// with a WebSocket (/room/<CODE>/ws, through worker/index.js, which checks the login first) using the same protocol
// as the Node server (server/protocol.js).
//
// What is different from the Node server:
//   - WebSockets use the Hibernation API. While the room is in its lobby nothing runs, so the object can sleep
//     (no duration charged). The lobby (map, mode, host, teams, bots) is saved in the object's storage at every change
//     and rebuilt when it wakes; the connections stay open while it sleeps.
//   - The 60 Hz match loop is a setInterval, and Cloudflare charges a timer's CPU to the event that started it. One
//     event may use 30 s of CPU, so a busy match whose players send nothing (all dead, say) would be stopped after a
//     few minutes (Stage C0). An alarm restarts the loop every 15 seconds, so its CPU always belongs to a new event.
//   - The room code is the object's name: worker/index.js claims a free one (claim) when a player creates a room.
//   - Friends' status, parties and the admin's match list need the central object (Stage C4). Until then they don't
//     see Cloudflare rooms.

import { DurableObject } from 'cloudflare:workers';
import { RoomManager } from '../server/rooms.js';
import { roomEvents } from '../server/roomEvents.js';
import { encode, receive } from '../server/protocol.js';
import { Progression } from '../server/progression.js';
import { Moderation } from '../server/moderation.js';
import { loadoutOf } from '../server/accounts.js';
import { isStaff } from '../server/roles.js';
import { neonHttpDb } from '../server/dbHttp.js';
import { TEAMS, MAX_PER_TEAM } from '../shared/constants.js';
import { refuseSocket } from './sockets.js';

const REHOME_MS = 15_000;           // restart the match loop this often (see above)
const TICK_RATE = 60;               // server/gameState.js
const CLAIM_HOLD_MS = 60_000;       // a claimed code waits this long for its creator to connect
const KICKED = 4001;                // server/realtime.js CLOSE.KICKED

/** One player's connection: the same calls as server/realtime.js's sockets, over a hibernatable WebSocket. */
class RoomSocket {
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
  /** The server ends this connection (the same account joined from another tab). The page closes it on "~kicked". */
  disconnect() {
    if (!this.connected) return;
    this.sendText(JSON.stringify(['~kicked']));
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

/** Socket.IO's io.to(...).emit and io.sockets.sockets, for this one room. */
class RoomIo {
  constructor() {
    this.sockets = { sockets: new Map() };
    this.channels = new Map();
  }
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
}

export class MatchRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.room = null;
    this.code = null;
    this.alarmSet = false;
    this.bySocket = new Map();   // WebSocket -> RoomSocket
    const db = neonHttpDb(env.DATABASE_URL, { fetchEndpoint: env.NEON_FETCH_ENDPOINT });
    // What rooms.js, gameState.js and progression.js expect of `accounts`, for the players in this room
    this.accounts = {
      db,
      online: new Map(),   // account id -> RoomSocket
      refreshSocketLoadout: (row) => { const s = this.accounts.online.get(row.id); if (s) Object.assign(s.data.account, loadoutOf(row)); },
    };
    this.progression = new Progression(this.accounts);   // match payouts
    this.social = { presenceChanged() {}, partyOf: new Map() };   // Stage C4 tells the central object
    this.io = new RoomIo();
    this.moderation = new Moderation({ db, accounts: this.accounts, io: this.io, background: false });
    // Woken from hibernation with players still connected: rebuild the lobby
    ctx.blockConcurrencyWhile(async () => {
      const meta = await ctx.storage.get('meta');
      if (meta && ctx.getWebSockets().length) {
        await this.restore(meta);
        console.log(`Room ${meta.code}: woke up, lobby rebuilt with ${this.room.members.size} in it`);
      }
    });
  }

  // ---------------------------------------------------------------- the room

  makeRoom(code) {
    const manager = new RoomManager(this.io, this.progression, this.social);
    const room = manager.createRoom(code);
    const broadcast = room.broadcastState.bind(room);
    room.broadcastState = () => { broadcast(); this.saveLobby(); };   // every lobby change is saved
    this.room = room;
    this.code = code;
    return room;
  }

  /** The lobby, so it can be rebuilt after the object sleeps. Not during a match: the match loop keeps it awake. */
  saveLobby() {
    const r = this.room;
    if (!r || r.phase !== 'lobby') return;
    this.ctx.storage.put('lobby', {
      mapId: r.mapId, mode: r.mode, hostId: r.hostId, botCount: r.botCount || 0,
      members: [...r.members.values()],
    });
  }

  async restore(meta) {
    const room = this.makeRoom(meta.code);
    const saved = await this.ctx.storage.get('lobby');
    const sockets = this.ctx.getWebSockets().map((ws) => [ws, ws.deserializeAttachment() || {}]);
    const open = new Set(sockets.map(([, a]) => a.id));
    if (saved) {
      room.mapId = saved.mapId; room.mode = saved.mode; room.botCount = saved.botCount;
      for (const m of saved.members) if (m.bot || open.has(m.id)) room.members.set(m.id, m);
      room.hostId = room.members.has(saved.hostId) ? saved.hostId : ([...room.members.values()].find((m) => !m.bot)?.id || null);
    }
    for (const [ws, a] of sockets) {
      if (!a.id || !room.members.has(a.id)) { try { ws.close(1000, 'room closed'); } catch { /* gone */ } continue; }
      const socket = this.wire(ws, a);
      socket.join(room.channel);
      socket.data.room = room;
    }
  }

  /** A RoomSocket for a WebSocket, with every room event handler. */
  wire(ws, attachment) {
    const socket = new RoomSocket(this.io, ws, attachment);
    this.bySocket.set(ws, socket);
    this.accounts.online.set(attachment.account.id, socket);
    roomEvents(socket, { moderation: this.moderation });
    socket.on('disconnect', () => {
      if (this.accounts.online.get(attachment.account.id) === socket) this.accounts.online.delete(attachment.account.id);
    });
    return socket;
  }

  humans() { return this.room ? [...this.room.members.values()].filter((m) => !m.bot).length : 0; }

  /** Nobody left (closing: a connection that is going away): the room is closed and its code is free again. */
  async closeIfEmpty(closing = null) {
    const open = this.ctx.getWebSockets().filter((w) => w !== closing && w.readyState === WebSocket.OPEN);
    if (this.humans() > 0 || open.length > 0) return;
    this.room?.game?.stop();
    this.room = null;
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
  }

  /** While a match runs, an alarm restarts its loop every 15 seconds (see the top of this file). */
  async keepLoopFresh() {
    if (this.room?.game?.timer && !this.alarmSet) {
      this.alarmSet = true;
      await this.ctx.storage.setAlarm(Date.now() + REHOME_MS);
    }
  }

  async alarm() {
    this.alarmSet = false;
    const game = this.room?.game;
    if (!game?.timer) return;
    clearInterval(game.timer);
    game.timer = setInterval(() => game.update(), 1000 / TICK_RATE);
    await this.keepLoopFresh();
  }

  // ---------------------------------------------------------------- called by worker/index.js

  /** Make this code a new room, unless it is in use. */
  async claim(code) {
    const meta = await this.ctx.storage.get('meta');
    if (meta && (this.ctx.getWebSockets().length > 0 || Date.now() - meta.claimedAt < CLAIM_HOLD_MS)) return { ok: false };
    await this.ctx.storage.deleteAll();
    await this.ctx.storage.put('meta', { code, claimedAt: Date.now() });
    this.room = null;
    return { ok: true };
  }

  /** A player's WebSocket. worker/index.js has checked the login and passes the account in X-Account. */
  async fetch(request) {
    let account, mode;
    try {
      account = JSON.parse(request.headers.get('x-account'));
      mode = request.headers.get('x-mode') || 'play';
    } catch { return new Response('Bad request', { status: 400 }); }
    const meta = await this.ctx.storage.get('meta');
    if (!meta) return refuseSocket('No room with that code.');
    const room = this.room || (await this.restore(meta), this.room);

    const spectator = mode === 'spectate';
    if ((spectator || mode === TEAMS.ATTACK || mode === TEAMS.DEFENSE) && !isStaff(account.username)) return refuseSocket('Not allowed.');
    if (spectator && room.phase !== 'match') return refuseSocket('That room has not started a match yet.');
    // The same account already here from another tab: the new tab takes its place (joins first, then the old one
    // leaves; the other way round, a room with only them in it would close in between)
    const previous = this.accounts.online.get(account.id) || null;
    if (!spectator && room.isFull() && !previous) return refuseSocket('That room is full.');
    if ((mode === TEAMS.ATTACK || mode === TEAMS.DEFENSE) && room.teamCount(mode) >= MAX_PER_TEAM) return refuseSocket('That side is full.');


    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);
    const attachment = { id: crypto.randomUUID().replace(/-/g, '').slice(0, 12), account, spectator };
    server.serializeAttachment(attachment);
    const socket = this.wire(server, attachment);
    socket.sendText(JSON.stringify(['~hello', { id: attachment.id, code: room.code }]));
    if (spectator) {
      const res = room.addSpectator(socket);
      if (res.error) { socket.disconnect(); return new Response(null, { status: 101, webSocket: client }); }
    } else {
      room.add(socket, mode === 'play' ? null : mode);
    }
    previous?.disconnect();
    await this.ctx.storage.put('meta', { ...meta, claimedAt: 0 });   // in use now: no longer just claimed
    return new Response(null, { status: 101, webSocket: client });
  }

  // ---------------------------------------------------------------- hibernatable WebSocket events

  socketOf(ws) {
    const known = this.bySocket.get(ws);
    if (known) return known;
    const a = ws.deserializeAttachment();
    return a?.id ? this.io.sockets.sockets.get(a.id) || null : null;
  }

  async webSocketMessage(ws, message) {
    const socket = this.socketOf(ws);
    if (!socket || typeof message !== 'string' || message.length > 64 * 1024) return;
    receive(socket, message);
    await this.keepLoopFresh();
  }

  async webSocketClose(ws) {
    const socket = this.socketOf(ws);
    this.bySocket.delete(ws);
    try { ws.close(1000, 'bye'); } catch { /* already closed */ }
    socket?.closed();
    await this.closeIfEmpty(ws);
  }

  async webSocketError(ws) {
    await this.webSocketClose(ws);
  }
}
