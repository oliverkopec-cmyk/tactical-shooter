// Entry point: serves the built client and runs the realtime game server (plain WebSockets, server/realtime.js).

import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { Realtime } from './realtime.js';
import { RoomManager } from './rooms.js';
import { openDatabase } from './db.js';
import { Accounts } from './accounts.js';
import { sharedCodeVersion } from './sharedVersion.js';
import { Admin } from './admin.js';
import { Gifts } from './gifts.js';
import { Christmas } from './christmas.js';
import { Moderation } from './moderation.js';
import { staticFiles } from './staticFiles.js';
import { createApi } from './api.js';
import { httpApi } from './httpApi.js';

// Local secrets (e.g. DATABASE_URL) can live in a .env file, which git ignores.
try { process.loadEnvFile(); } catch { /* no .env file */ }

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(__dirname, '../dist');
const PORT = Number(process.env.PORT) || 3000;

const db = await openDatabase();
const accounts = new Accounts(db);

const app = express();
app.set('trust proxy', 1); // Render sits behind one proxy: lets req.ip / req.secure see the real client
app.get('/healthz', (_req, res) => res.send('ok'));
app.use('/api', httpApi(createApi(accounts)));   // server/api.js: the same routes the Cloudflare Worker serves
app.use(staticFiles(DIST));

const server = http.createServer(app);
// The WebSocket is at /ws on the same host (Vite proxies it in development). It compresses messages like before.
const io = new Realtime(server, { path: '/ws' });

const rooms = new RoomManager(io, accounts.progression, accounts.social);
const social = accounts.social;
const admin = new Admin({ db, accounts, rooms, social });
const gifts = new Gifts({ db, accounts });
const christmas = new Christmas({ db, accounts });
const moderation = new Moderation({ db, accounts, io });
accounts.moderation = moderation;   // suspended and banned accounts can't log in
const SHARED_VERSION = sharedCodeVersion();
// The in-match events a batch may carry (each is also handled below as an event of its own)
const BATCH_EVENTS = new Set(['action', 'actionEnd', 'teamPing', 'pickOperator', 'pickUtility', 'voteSite', 'spawnChoice', 'refreshLook']);
// Pages built from different shared code would mispredict movement: send them back to reload.
// ('dev' is the Vite dev server, which always runs the current files.)
io.use((socket, next) => {
  const version = socket.handshake.auth?.version;
  next(version === SHARED_VERSION || version === 'dev' ? undefined : new Error('outdated'));
});
io.use(accounts.socketAuth());

io.on('connection', (socket) => {
  const reply = (ack, payload) => { if (typeof ack === 'function') ack(payload); };
  accounts.trackOnline(socket);
  gifts.sendPending(socket);   // unopened gifts wait in the menu as presents
  christmas.sendState(socket);

  socket.on('createRoom', (ack) => {
    const me = socket.data.account.id;
    const party = social.partyOf.get(me);
    // A party's room is made by its leader, and the whole party comes with them
    if (party && party.leader !== me) {
      return reply(ack, { ok: false, error: 'Only the party leader can create a room for the party. Leave the party to make your own.' });
    }
    if (socket.data.room) socket.data.room.remove(socket);
    socket.data.spectating?.removeSpectator(socket);
    const room = rooms.createRoom();
    room.add(socket);
    const joined = [], busy = [];
    if (party) {
      const leaderTeam = room.members.get(socket.id).team;
      for (const id of party.members) {
        if (id === me) continue;
        const member = social.socketOf(id);
        if (!member) continue;
        if (member.data.room) { busy.push(member.data.account.username); social.notice(me, `${member.data.account.username} is in another room, so they didn't join.`); continue; }
        room.add(member);
        room.setTeam(member.id, leaderTeam);   // the party plays together
        joined.push(member.data.account.username);
      }
    }
    reply(ack, { ok: true, code: room.code, id: socket.id, party: party ? { joined, busy } : null });
  });

  // ---- parties (invites come from the Friends tab)
  socket.on('partyInvite', async (accountId, ack) => {
    const res = await social.invite(socket.data.account.id, Number(accountId));
    reply(ack, res);
  });
  socket.on('partyRespond', ({ partyId, accept } = {}, ack) => reply(ack, social.respondInvite(socket.data.account.id, Number(partyId), !!accept)));
  socket.on('partyLeave', (ack) => { social.leaveParty(socket.data.account.id); reply(ack, { ok: true }); });
  socket.on('partyState', (ack) => reply(ack, { party: social.partyState(social.partyOf.get(socket.data.account.id)) }));

  socket.on('joinRoom', ({ code } = {}, ack) => {
    const room = rooms.get(code);
    if (!room) return reply(ack, { ok: false, error: 'No room with that code.' });
    if (room.isFull()) return reply(ack, { ok: false, error: 'That room is full.' });
    if (socket.data.room) socket.data.room.remove(socket);
    socket.data.spectating?.removeSpectator(socket);
    room.add(socket);
    reply(ack, { ok: true, code: room.code, id: socket.id });
  });

  // ---- admin tools (each one re-checks the caller's role on the server)
  socket.on('adminOnline', async (ack) => { try { reply(ack, await admin.online(socket)); } catch (err) { console.error('Admin list failed:', err.message); reply(ack, { error: 'Server error.' }); } });
  socket.on('adminMatches', (ack) => reply(ack, admin.matches(socket)));
  // ---- announcements and gifts (admins send, anyone opens their own)
  const safely = (fn) => async (...args) => {
    const ack = typeof args.at(-1) === 'function' ? args.pop() : null;
    try { reply(ack, await fn(...args)); } catch (err) { console.error('Gift request failed:', err.message); reply(ack, { error: 'Server error.' }); }
  };
  const obj = (v) => (v && typeof v === 'object' ? v : {});
  socket.on('adminAnnounce', safely((req) => gifts.announce(socket, obj(req))));
  socket.on('adminGift', safely((req) => gifts.create(socket, obj(req))));
  socket.on('adminGifts', safely(() => gifts.history(socket)));
  socket.on('adminFindPlayer', safely((q) => gifts.findPlayers(socket, q)));
  socket.on('giftClaim', safely((id) => gifts.claim(socket, id)));
  socket.on('giftList', safely(async () => ({ gifts: await gifts.pendingFor(socket.data.account.id) })));
  socket.on('christmasClaim', safely((day) => christmas.claim(socket, day)));
  socket.on('christmasState', safely(async () => ({ christmas: await christmas.stateFor(socket.data.account.id) })));
  socket.on('christmasDevDate', safely((date) => christmas.devDate(date)));
  socket.on('christmasDevReset', safely(() => christmas.devReset(socket)));

  // ---- chat, reports and the owner's moderation tools (the owner-only ones re-check the caller on the server)
  socket.on('chat', (req, ack) => reply(ack, moderation.chat(socket, obj(req))));
  socket.on('report', safely((req) => moderation.report(socket, obj(req))));
  socket.on('warnings', safely(() => moderation.deliverWarnings(socket)));
  socket.on('warningsSeen', safely((ids) => moderation.markWarningsSeen(socket, ids)));
  socket.on('modReports', safely((req) => moderation.reports(socket, obj(req))));
  socket.on('modReport', safely((req) => moderation.reportDetail(socket, obj(req))));
  socket.on('modResolve', safely((req) => moderation.resolve(socket, obj(req))));
  socket.on('modSanction', safely((req) => moderation.sanction(socket, obj(req))));
  socket.on('modLift', safely((req) => moderation.lift(socket, obj(req))));
  socket.on('modBlocked', safely(() => moderation.blocked(socket)));
  socket.on('modChat', safely((req) => moderation.chatLog(socket, obj(req))));

  socket.on('adminJoin', (req, ack) => reply(ack, admin.join(socket, req && typeof req === 'object' ? { code: String(req.code || ''), mode: String(req.mode || '') } : {})));

  socket.on('setTeam', (team, ack) => {
    const room = socket.data.room;
    reply(ack, room ? room.setTeam(socket.id, team) : { error: 'Not in a room.' });
  });

  socket.on('setMap', (mapId, ack) => {
    const room = socket.data.room;
    reply(ack, room ? room.setMap(socket.id, String(mapId)) : { error: 'Not in a room.' });
  });

  socket.on('addBot', ({ team, difficulty } = {}, ack) => {
    const room = socket.data.room;
    reply(ack, room ? room.addBot(socket.id, String(team), String(difficulty)) : { error: 'Not in a room.' });
  });
  socket.on('fillBots', ({ difficulty } = {}, ack) => {
    const room = socket.data.room;
    reply(ack, room ? room.fillBots(socket.id, String(difficulty)) : { error: 'Not in a room.' });
  });
  socket.on('removeBot', (botId, ack) => {
    const room = socket.data.room;
    reply(ack, room ? room.removeBot(socket.id, String(botId)) : { error: 'Not in a room.' });
  });

  socket.on('setMode', (mode, ack) => {
    const room = socket.data.room;
    reply(ack, room ? room.setMode(socket.id, String(mode)) : { error: 'Not in a room.' });
  });

  socket.on('startMatch', (ack) => {
    const room = socket.data.room;
    reply(ack, room ? room.start(socket.id) : { error: 'Not in a room.' });
  });

  // A match batch (Stage C1): the client sends one about 7 times a second while it has something to send, and nothing
  // while dead, spectating or in the menus. Inputs first, then the in-match events in the order they happened, then
  // the ping time to send straight back.
  socket.on('batch', (b) => {
    if (Array.isArray(b.i) && b.i.length) socket.data.room?.handleInputs(socket.id, b.i);
    if (Array.isArray(b.a)) {
      for (const ev of b.a.slice(0, 24)) {
        if (Array.isArray(ev) && BATCH_EVENTS.has(ev[0])) socket.dispatch(ev[0], ev.length > 1 ? [ev[1]] : []);
      }
    }
    if (typeof b.p === 'number') socket.emit('pong', b.p);
  });

  socket.on('action', (type) => {
    if (type === 'breach' || type === 'reinforce' || type === 'droneNext' || type === 'ping' || type === 'ability' || type === 'utility' || type === 'camView' || type === 'barricade' || type === 'melee') socket.data.room?.handleAction(socket.id, type);
  });

  // A held key went up (placing takes time while the key is held: Stage 27)
  socket.on('actionEnd', (type) => {
    if (type === 'breach' || type === 'reinforce' || type === 'ability' || type === 'utility' || type === 'barricade') socket.data.room?.handleActionEnd(socket.id, type);
  });

  socket.on('teamPing', (type) => socket.data.room?.game?.teamPing(socket.id, String(type)));

  socket.on('pickOperator', (opId) => socket.data.room?.game?.pickOperator(socket.id, String(opId)));

  socket.on('pickUtility', (id) => socket.data.room?.game?.pickUtility(socket.id, String(id)));

  socket.on('voteSite', (i) => socket.data.room?.game?.voteSite(socket.id, i));

  socket.on('spawnChoice', (n) => socket.data.room?.game?.setSpawnChoice(socket.id, n));

  // Skins or charms changed on the loadout screen mid-match: everyone sees the new look
  socket.on('refreshLook', () => socket.data.room?.refreshLook(socket));

  socket.on('leaveRoom', () => { socket.data.room?.remove(socket); socket.data.spectating?.removeSpectator(socket); });
  socket.on('disconnect', () => { socket.data.room?.remove(socket); socket.data.spectating?.removeSpectator(socket); });
});

server.listen(PORT, () => {
  console.log(`Breachline server listening on port ${PORT}`);
});
