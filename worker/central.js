// The central Durable Object (Stage C4): one for the whole game. Every logged-in page keeps its main connection here
// (/ws, through worker/index.js, which checks the login first). It runs the same code as the Node server's menus
// (server/menuEvents.js): who is online, friends' status, parties, gifts and Christmas presents, announcements, the
// admin and owner tools, warnings, reports and suspensions. Match rooms are their own objects (worker/matchRoom.js);
// they tell this one who is in them and how their match is going (presence), and who was in each match (recent).
//
// It also keeps the day's usage against the free plan (worker/usage.js, Stage C6): every object reports what it
// counted, and from 80% of any daily allowance new rooms and matches are refused ("full for today") while the matches
// already running finish. Pages are told (serverStatus), and the admin panel shows it (adminUsage).
//
// It hibernates when idle: a page in the menus sends nothing, so most of the time nothing runs here and no duration is
// charged. What must survive that (which room each player is in, parties, everyone's last match for reports) is in
// its storage, and rebuilt when it wakes. The connections stay open while it sleeps.

import { DurableObject } from 'cloudflare:workers';
import { Accounts } from '../server/accounts.js';
import { Moderation } from '../server/moderation.js';
import { Admin } from '../server/admin.js';
import { Gifts } from '../server/gifts.js';
import { Christmas } from '../server/christmas.js';
import { menuEvents } from '../server/menuEvents.js';
import { receive } from '../server/protocol.js';
import { isStaff } from '../server/roles.js';
import { neonHttpDb } from '../server/dbHttp.js';
import { ROOM_CODE_LENGTH, TEAMS } from '../shared/constants.js';
import { DoSocket, DoIo } from './doSockets.js';
import { UsageBook, FULL_MESSAGE, BUSY_MESSAGE, MAX_LIVE_MATCHES, nextReset } from './usage.js';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';   // no I or O (as server/rooms.js)
const randomCode = () => Array.from({ length: ROOM_CODE_LENGTH }, () => CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]).join('');

export class Central extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    const db = neonHttpDb(env.DATABASE_URL, { fetchEndpoint: env.NEON_FETCH_ENDPOINT });
    this.io = new DoIo();
    this.accounts = new Accounts(db, { background: false });
    this.accounts.refreshSocketLoadout = () => {};   // a room reads the loadout from the database when a player joins
    this.social = this.accounts.social;
    this.moderation = new Moderation({ db, accounts: this.accounts, io: this.io, background: false });
    this.accounts.moderation = this.moderation;
    this.moderation.onBlocked = (accountId) => this.kickFromRoom(accountId);
    this.rooms = new Map();     // code -> { summary, players: [account ids], spectators: [account ids] }
    this.whereIs = new Map();   // account id -> { code, spectator }
    this.admin = new Admin({ db, accounts: this.accounts, rooms: null, social: this.social, matchList: () => [...this.rooms.values()].map((r) => r.summary) });
    this.gifts = new Gifts({ db, accounts: this.accounts });
    this.christmas = new Christmas({ db, accounts: this.accounts });
    this.bySocket = new Map();   // WebSocket -> DoSocket
    this.usage = new UsageBook(ctx.storage, env.DAILY_LIMIT_SCALE);
    this.savedParties = '';
    // Parties live in server/social.js's memory: save them after every change (some come after a database wait, and
    // an invite running out comes from a timer), so they survive this object sleeping
    for (const name of ['invite', 'respondInvite', 'removeFromParty', 'disband', 'expireInvite', 'onDisconnect']) {
      const fn = this.social[name].bind(this.social);
      this.social[name] = (...args) => {
        const out = fn(...args);
        if (out instanceof Promise) return out.finally(() => this.saveParties());
        this.saveParties();
        return out;
      };
    }
    ctx.blockConcurrencyWhile(async () => {
      await this.restore();
      if (this.accounts.online.size) console.log(`Central: woke up with ${this.accounts.online.size} players connected, ${this.social.parties.size} parties, ${this.rooms.size} rooms`);
    });
  }

  // ---------------------------------------------------------------- waking up

  async restore() {
    await this.usage.load();
    const [rooms, parties] = await Promise.all([this.ctx.storage.get('rooms'), this.ctx.storage.get('parties')]);
    for (const [code, r] of rooms || []) this.setRoom(code, r, false);
    const sockets = this.ctx.getWebSockets();
    const recents = sockets.length ? await this.ctx.storage.get(sockets.map((ws) => `recent:${ws.deserializeAttachment()?.account?.id}`)) : new Map();
    for (const ws of sockets) {
      const a = ws.deserializeAttachment();
      if (!a?.account) continue;
      const socket = this.wire(ws, a);
      this.accounts.online.set(a.account.id, socket);
      this.placeSocket(socket);
      const recent = recents.get(`recent:${a.account.id}`);
      if (recent) socket.data.recent = { ...recent, players: new Map(recent.players) };
    }
    if (parties) {
      const online = this.accounts.online;
      this.social.nextPartyId = parties.next;
      for (const p of parties.list) {
        const members = p.members.filter((m) => online.has(m));
        if (members.length < 2) continue;
        const party = { id: p.id, leader: members.includes(p.leader) ? p.leader : members[0], members };
        this.social.parties.set(party.id, party);
        for (const m of members) this.social.partyOf.set(m, party);
      }
      this.savedParties = JSON.stringify(parties);
    }
  }

  saveParties() {
    const state = { next: this.social.nextPartyId, list: [...this.social.parties.values()].map((p) => ({ id: p.id, leader: p.leader, members: p.members })) };
    const json = JSON.stringify(state);
    if (json === this.savedParties) return;
    this.savedParties = json;
    this.ctx.storage.put('parties', state);
  }

  /** A main connection, with every menu handler (server/menuEvents.js) and the room operations below. */
  wire(ws, attachment) {
    const socket = new DoSocket(this.io, ws, attachment);
    socket.data.tokenHash = attachment.tokenHash;
    this.bySocket.set(ws, socket);
    menuEvents(socket, {
      social: this.social, admin: this.admin, gifts: this.gifts, christmas: this.christmas, moderation: this.moderation,
      rooms: this.roomOps(),
      usage: (s) => this.usageFor(s),
    });
    // A report from the menus (after leaving the room): the room told us who was in that match
    socket.on('report', async (req, ack) => {
      try { ack?.(await this.moderation.report(socket, req && typeof req === 'object' ? req : {})); } catch { ack?.({ error: 'Server error.' }); }
    });
    // The same as accounts.trackOnline's, for a connection rebuilt after waking up
    socket.on('disconnect', () => {
      const id = attachment.account.id;
      if (this.accounts.online.get(id) !== socket) return;
      this.accounts.online.delete(id);
      this.social.onDisconnect(id);
    });
    return socket;
  }

  /** What the menus and server code read from socket.data about where a player is (server/social.js statusOf...). */
  placeSocket(socket) {
    const where = this.whereIs.get(socket.data.account.id);
    const room = where && this.rooms.get(where.code);
    socket.data.room = where && !where.spectator && room ? { code: where.code, phase: room.summary.phase, remove() {} } : null;
    socket.data.spectating = where?.spectator && room ? { code: where.code, removeSpectator() {} } : null;
  }

  // ---------------------------------------------------------------- rooms

  /** Creating, joining and admin-joining (server/menuEvents.js): here they only answer which room to connect to. */
  roomOps() {
    return {
      create: (socket) => this.createRoom(socket),
      join: (_socket, code) => ({ ok: true, code: String(code || '').toUpperCase() }),
      adminJoin: (socket, { code, mode }) => {
        if (!isStaff(socket.data.account.username)) return { error: 'Not allowed.' };
        const room = this.rooms.get(String(code).toUpperCase());
        if (!room) return { error: 'No room with that code.' };
        if (mode !== 'spectate' && mode !== TEAMS.ATTACK && mode !== TEAMS.DEFENSE) return { error: 'Unknown way to join.' };
        return { ok: true, code: room.summary.code, as: mode, spectator: mode === 'spectate' };
      },
    };
  }

  /** A new room on a free code. A party's leader brings the party: they are told to join it, on the leader's team. */
  async createRoom(socket) {
    if (this.usage.view().full) return { ok: false, error: FULL_MESSAGE };
    const me = socket.data.account.id;
    const party = this.social.partyOf.get(me);
    if (party && party.leader !== me) {
      return { ok: false, error: 'Only the party leader can create a room for the party. Leave the party to make your own.' };
    }
    const joined = [], busy = [], coming = [];
    if (party) {
      for (const id of party.members) {
        if (id === me) continue;
        const member = this.accounts.online.get(id);
        if (!member) continue;
        if (this.whereIs.has(id)) { busy.push(member.data.account.username); this.social.notice(me, `${member.data.account.username} is in another room, so they didn't join.`); continue; }
        coming.push(id);
        joined.push(member.data.account.username);
      }
    }
    for (let attempt = 0; attempt < 20; attempt++) {
      const code = randomCode();
      const res = await this.roomStub(code).claim(code, party ? { leader: me, members: coming } : null);
      if (!res.ok) continue;
      for (const id of coming) this.accounts.online.get(id)?.emit('partyRoom', { code });
      return { ok: true, code, party: party ? { joined, busy } : null };
    }
    return { ok: false, error: 'No free room codes. Try again.' };
  }

  roomStub(code) { return this.env.MATCH_ROOMS.get(this.env.MATCH_ROOMS.idFromName(code)); }

  /** Suspended or banned: out of their room too (the menus' connection is closed by server/moderation.js). */
  kickFromRoom(accountId) {
    const where = this.whereIs.get(accountId);
    if (where) this.ctx.waitUntil(this.roomStub(where.code).kick(accountId).catch(() => {}));
  }

  setRoom(code, r, save = true) {
    if (r) this.rooms.set(code, { ...r, seenAt: r.seenAt || Date.now() }); else this.rooms.delete(code);
    if (save) this.ctx.storage.put('rooms', [...this.rooms]);
    // Who is where, rebuilt from every room
    this.whereIs.clear();
    for (const [c, room] of this.rooms) {
      for (const id of room.players) this.whereIs.set(id, { code: c, spectator: false });
      for (const id of room.spectators) if (!this.whereIs.has(id)) this.whereIs.set(id, { code: c, spectator: true });
    }
  }

  // ---------------------------------------------------------------- usage (worker/usage.js)

  /** Add to today's usage; when the servers become full (or the day resets), every page is told. */
  count(delta) {
    if (this.usage.add(delta)) this.broadcastStatus();
  }

  status() {
    const v = this.usage.view();
    return { full: v.full, resetsAt: nextReset(), message: v.full ? FULL_MESSAGE : null };
  }

  broadcastStatus() {
    const status = this.status();
    for (const socket of this.accounts.online.values()) socket.emit('serverStatus', status);
  }

  liveMatches(except = null) {
    let n = 0;
    for (const [code, r] of this.rooms) if (code !== except && r.summary?.phase === 'match') n++;
    return n;
  }

  /** The admin panel's Daily usage (staff only). */
  async usageFor(socket) {
    if (!isStaff(socket.data.account.username)) return { error: 'Not allowed.' };
    await this.checkQuietRooms();
    return {
      available: true, today: this.usage.view(), history: await this.usage.history(7),
      liveMatches: this.liveMatches(), maxLiveMatches: MAX_LIVE_MATCHES, online: this.accounts.online.size,
    };
  }

  // ---------------------------------------------------------------- called by match rooms (worker/matchRoom.js)

  /** What a room (code) or the Worker counted since it last reported. A running match reports every minute. */
  usageReport(delta, code = null) {
    this.count({ ...delta, doCalls: (Number(delta?.doCalls) || 0) + 1 });
    const room = code && this.rooms.get(code);
    if (room) room.seenAt = Date.now();
  }

  /**
   * Rooms that haven't reported for a while (onlyMatches: just the ones in a match) are asked whether they still exist.
   * A room whose object was restarted (a deploy, say) can't say goodbye, and would otherwise count as running for ever.
   */
  async checkQuietRooms(onlyMatches = false) {
    const quiet = [...this.rooms].filter(([, r]) => Date.now() - (r.seenAt || 0) > 90_000 && (!onlyMatches || r.summary?.phase === 'match'));
    await Promise.all(quiet.map(async ([code]) => {
      const now = await this.roomStub(code).currentPresence().catch(() => ({ closed: true }));
      this.presence(code, now);
    }));
  }

  /** May this room start a match? Not when the servers are full for today, or too many matches are running. */
  async allowMatch(code) {
    this.count({ doCalls: 1 });
    if (this.usage.view().full) return { ok: false, error: FULL_MESSAGE };
    if (this.liveMatches(code) >= MAX_LIVE_MATCHES) await this.checkQuietRooms(true);
    if (this.liveMatches(code) >= MAX_LIVE_MATCHES) return { ok: false, error: BUSY_MESSAGE };
    return { ok: true };
  }

  /** A room's players, spectators and match (summary: server/admin.js roomSummary). closed: the room has gone. */
  presence(code, { summary = null, players = [], spectators = [], closed = false } = {}, usage = null) {
    this.usageReport(usage);
    const before = this.rooms.get(code);
    const was = new Map([...(before?.players || [])].map((id) => [id, before.summary.phase]));
    this.setRoom(code, closed ? null : { summary, players, spectators });
    // Everyone whose status changed: their sockets learn where they are, and their friends and party are told
    const changed = new Set();
    for (const id of new Set([...was.keys(), ...players])) {
      const now = !closed && players.includes(id) ? summary.phase : null;
      if (was.get(id) !== now) changed.add(id);
    }
    for (const id of [...(before?.spectators || []), ...spectators]) changed.add(id);
    for (const id of changed) {
      const socket = this.accounts.online.get(id);
      if (socket) this.placeSocket(socket);
      this.social.presenceChanged(id);
    }
  }

  /** Who was in an account's latest match, so it can still report them from the menus. */
  async recent(accountId, recent) {
    this.count({ doCalls: 1 });
    await this.ctx.storage.put(`recent:${accountId}`, recent);
    const socket = this.accounts.online.get(accountId);
    if (socket) socket.data.recent = { ...recent, players: new Map(recent.players) };
  }

  // ---------------------------------------------------------------- called by worker/index.js

  /** Logged out: close that session's connection. */
  kickSession(accountId, tokenHash) { this.count({ doCalls: 1 }); this.accounts.kickSession(accountId, tokenHash); }

  /** The friends API (/api/friends...) runs here, where who is online is known. -> { status, body } */
  async friends(accountId, op, args = {}) {
    this.count({ doCalls: 1 });
    const s = this.social;
    let out;
    if (op === 'list') out = await s.list(accountId);
    else if (op === 'search') out = { results: await s.search(accountId, args.q) };
    else if (op === 'request') out = await s.request(accountId, args.username);
    else if (op === 'respond') out = await s.respond(accountId, Number(args.id), !!args.accept);
    else if (op === 'remove') out = await s.remove(accountId, Number(args.id));
    else return { status: 404, body: { error: 'Not found.' } };
    this.saveParties();   // removing a friend can take them out of your party
    const { status = 200, ...body } = out;
    return { status, body };
  }

  /** A main connection. worker/index.js has checked the login and passes the account in X-Account. */
  async fetch(request) {
    let account, tokenHash;
    try {
      account = JSON.parse(request.headers.get('x-account'));
      tokenHash = request.headers.get('x-token') || '';
    } catch { return new Response('Bad request', { status: 400 }); }
    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);
    const attachment = { id: crypto.randomUUID().replace(/-/g, '').slice(0, 12), account, tokenHash };
    server.serializeAttachment(attachment);
    const socket = this.wire(server, attachment);
    socket.sendText(JSON.stringify(['~hello', { id: attachment.id }]));
    // As server/index.js does for each connection
    this.accounts.trackOnline(socket);   // one connection per account: an older tab is told and closed
    this.placeSocket(socket);
    const recent = await this.ctx.storage.get(`recent:${account.id}`);
    if (recent) socket.data.recent = { ...recent, players: new Map(recent.players) };
    this.gifts.sendPending(socket);
    this.christmas.sendState(socket);
    this.count({ doCalls: 1, connections: 1 });
    if (this.usage.view().full) socket.emit('serverStatus', this.status());
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
    this.count({ wsMessages: 1 });
    if (!socket || typeof message !== 'string' || message.length > 64 * 1024) return;
    receive(socket, message);
    this.saveParties();
  }

  async webSocketClose(ws) {
    const socket = this.socketOf(ws);
    this.bySocket.delete(ws);
    try { ws.close(1000, 'bye'); } catch { /* already closed */ }
    socket?.closed();
    this.saveParties();
  }

  async webSocketError(ws) { await this.webSocketClose(ws); }
}
