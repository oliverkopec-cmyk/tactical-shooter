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
//   - The central object (worker/central.js, Stage C4) is told who is in the room and how the match is going
//     (presence: friends' status, the admin's Matches list), and who was in each match (recent: reports from the
//     menus). It claims rooms for parties (their members join the leader's team) and asks for blocked players to go.
//   - Usage (Stage C6, worker/usage.js): the room counts what it costs (messages, connections, alarms, awake time) and
//     sends it with its presence or every minute of a match. Before a match starts it asks the central object, which
//     says no when the servers are full for today or too many matches are running. A running match is never stopped.

import { DurableObject } from 'cloudflare:workers';
import { RoomManager } from '../server/rooms.js';
import { roomEvents } from '../server/roomEvents.js';
import { receive } from '../server/protocol.js';
import { Progression } from '../server/progression.js';
import { Moderation } from '../server/moderation.js';
import { loadoutOf } from '../server/accounts.js';
import { roomSummary } from '../server/admin.js';
import { isStaff } from '../server/roles.js';
import { neonHttpDb } from '../server/dbHttp.js';
import { TEAMS, MAX_PER_TEAM } from '../shared/constants.js';
import { refuseSocket } from './sockets.js';
import { DoSocket, DoIo } from './doSockets.js';
import { emptyCounts, hasCounts } from './usage.js';

const REHOME_MS = 15_000;           // restart the match loop this often (see above)
const TICK_RATE = 60;               // server/gameState.js
const CLAIM_HOLD_MS = 60_000;       // a claimed code waits this long for its creator to connect
const PRESENCE_DELAY_MS = 300;      // changes close together go to the central object as one

export class MatchRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.room = null;
    this.code = null;
    this.alarmSet = false;
    this.meter = emptyCounts();          // usage since the last report to the central object
    this.meter.durationSec += 10;        // waking up: about this long awake for each event, a rough allowance
    this.alarmsSinceReport = 0;
    this.bySocket = new Map();   // WebSocket -> DoSocket
    const db = neonHttpDb(env.DATABASE_URL, { fetchEndpoint: env.NEON_FETCH_ENDPOINT });
    // What rooms.js, gameState.js and progression.js expect of `accounts`, for the players in this room
    this.accounts = {
      db,
      online: new Map(),   // account id -> DoSocket
      refreshSocketLoadout: (row) => { const s = this.accounts.online.get(row.id); if (s) Object.assign(s.data.account, loadoutOf(row)); },
    };
    this.progression = new Progression(this.accounts);   // match payouts
    this.social = { presenceChanged: () => this.presenceSoon(), partyOf: new Map() };   // the central object is told
    this.io = new DoIo();
    // A round starting or ending changes the score and round the admin's Matches list shows
    this.io.onEmit = (_target, event) => { if (event === 'roundStart' || event === 'roundEnd' || event === 'phase') this.presenceSoon(); };
    this.presenceTimer = null;
    this.recentTimer = null;
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
    room.broadcastState = () => { broadcast(); this.saveLobby(); this.presenceSoon(); };   // every lobby change is saved
    // Who is in each match goes to the central object, so players can report each other from the menus afterwards
    const note = room.noteMatchPlayer.bind(room);
    room.noteMatchPlayer = (...args) => { note(...args); this.recentSoon(); };
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

  /** A DoSocket for a WebSocket, with every room event handler. */
  wire(ws, attachment) {
    const socket = new DoSocket(this.io, ws, attachment);
    this.bySocket.set(ws, socket);
    this.accounts.online.set(attachment.account.id, socket);
    roomEvents(socket, { moderation: this.moderation });
    // Starting a match: only if the central object agrees (not when the servers are full for today, or too many matches
    // are running). Matches already running are never stopped.
    socket.handlers.set('startMatch', [async (ack) => {
      const reply = (res) => { if (typeof ack === 'function') ack(res); };
      const room = socket.data.room;
      if (!room) return reply({ error: 'Not in a room.' });
      if (room.hostId !== socket.id) return reply(room.start(socket.id));   // the room's own answer (not the host...)
      const allowed = await this.central().allowMatch(this.code).catch(() => ({ ok: true }));
      if (!allowed.ok) return reply({ error: allowed.error });
      const res = room.start(socket.id);
      if (!res.error) { this.meter.matches++; await this.keepLoopFresh(); }
      reply(res);
    }]);
    // Skins or charms changed mid-match: the shop and equipping go through the API, so read them from the database first
    socket.handlers.set('refreshLook', [async () => {
      try {
        const row = await this.progression.load(attachment.account.id);
        if (row) Object.assign(socket.data.account, loadoutOf(row));
      } catch (e) { console.error('Loadout reload failed:', e.message); }
      socket.data.room?.refreshLook(socket);
    }]);
    socket.on('disconnect', () => {
      if (this.accounts.online.get(attachment.account.id) === socket) this.accounts.online.delete(attachment.account.id);
    });
    return socket;
  }

  humans() { return this.room ? [...this.room.members.values()].filter((m) => !m.bot).length : 0; }

  // ---------------------------------------------------------------- telling the central object

  central() { return this.env.CENTRAL.get(this.env.CENTRAL.idFromName('central')); }

  /** Who is in this room and how its match is going (server/admin.js roomSummary), or closed. */
  presencePayload() {
    const room = this.room;
    if (!room || this.humans() === 0) return { closed: true };
    const accountOf = (id) => this.io.sockets.sockets.get(id)?.data.account.id;
    return {
      summary: roomSummary(room),
      players: [...room.members.values()].filter((m) => !m.bot).map((m) => m.accountId ?? accountOf(m.id)).filter(Boolean),
      spectators: [...room.spectators.keys()].map(accountOf).filter(Boolean),
    };
  }

  /** The central object hasn't heard from this room for a while: is it still there? (After a deploy, say.) */
  async currentPresence() {
    this.meter.doCalls++;
    const meta = await this.ctx.storage.get('meta');
    if (meta && !this.room && this.ctx.getWebSockets().length) await this.restore(meta);
    return this.presencePayload();
  }

  /** What this room counted since it last reported, and start again. */
  takeMeter() {
    const out = this.meter;
    this.meter = emptyCounts();
    return out;
  }

  /** Who is in this room and how its match is going, a moment after it changes. */
  presenceSoon() {
    if (this.presenceTimer || !this.code) return;
    this.presenceTimer = setTimeout(() => {
      this.presenceTimer = null;
      const payload = this.presencePayload();
      this.ctx.waitUntil(this.central().presence(this.code, payload, this.takeMeter()).catch((e) => console.error('Presence failed:', e.message)));
    }, PRESENCE_DELAY_MS);
  }

  /** Each human in the match: who was in it (server/rooms.js noteMatchPlayer), for reports from the menus. */
  recentSoon() {
    if (this.recentTimer) return;
    this.recentTimer = setTimeout(() => {
      this.recentTimer = null;
      for (const socket of this.accounts.online.values()) {
        const r = socket.data.recent;
        if (!r) continue;
        const recent = { matchId: r.matchId, roomCode: r.roomCode, players: [...r.players] };
        this.ctx.waitUntil(this.central().recent(socket.data.account.id, recent).catch(() => {}));
      }
    }, 1000);
  }

  /** Nobody left (closing: a connection that is going away): the room is closed and its code is free again. */
  async closeIfEmpty(closing = null) {
    const open = this.ctx.getWebSockets().filter((w) => w !== closing && w.readyState === WebSocket.OPEN);
    if (this.humans() > 0 || open.length > 0) return;
    this.room?.game?.stop();
    this.room = null;
    clearTimeout(this.presenceTimer);
    this.presenceTimer = null;
    if (this.code) await this.central().presence(this.code, { closed: true }, this.takeMeter()).catch(() => {});
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
    this.meter.doCalls++;
    const game = this.room?.game;
    if (!game?.timer) return;
    // A match keeps the object awake: 15 more seconds of it. Every minute, tell the central object what was used.
    this.meter.durationSec += REHOME_MS / 1000;
    if (++this.alarmsSinceReport >= 4 && hasCounts(this.meter)) {
      this.alarmsSinceReport = 0;
      this.ctx.waitUntil(this.central().usageReport(this.takeMeter(), this.code).catch(() => {}));
    }
    clearInterval(game.timer);
    game.timer = setInterval(() => game.update(), 1000 / TICK_RATE);
    await this.keepLoopFresh();
  }

  // ---------------------------------------------------------------- called by worker/index.js

  /** Make this code a new room, unless it is in use. party: { leader, members } (account ids) to play together. */
  async claim(code, party = null) {
    this.meter.doCalls++;
    const meta = await this.ctx.storage.get('meta');
    if (meta && (this.ctx.getWebSockets().length > 0 || Date.now() - meta.claimedAt < CLAIM_HOLD_MS)) return { ok: false };
    await this.ctx.storage.deleteAll();
    await this.ctx.storage.put('meta', { code, claimedAt: Date.now(), party });
    this.room = null;
    this.code = code;
    return { ok: true };
  }

  /** Suspended or banned (the central object asks): out of this room. */
  kick(accountId) {
    this.meter.doCalls++;
    const socket = this.accounts.online.get(accountId);
    if (socket) socket.disconnect('blocked');
  }

  /** A player's WebSocket. worker/index.js has checked the login and passes the account in X-Account. */
  async fetch(request) {
    this.meter.doCalls++;
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
      // A party member joining the room their leader made: onto the leader's team, as on the Node server
      const party = meta.party;
      if (party && party.members.includes(account.id)) {
        const leader = this.accounts.online.get(party.leader);
        const leaderTeam = leader && room.members.get(leader.id)?.team;
        if (leaderTeam) room.setTeam(socket.id, leaderTeam);
      }
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
    this.meter.wsMessages++;
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
