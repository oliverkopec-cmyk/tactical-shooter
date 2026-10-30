// Entry point: serves the built client and runs the Socket.IO game server.

import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { Server } from 'socket.io';
import { RoomManager } from './rooms.js';
import { openDatabase } from './db.js';
import { Accounts } from './accounts.js';
import { sharedCodeVersion } from './sharedVersion.js';
import { Admin } from './admin.js';

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
app.use('/api', accounts.router());
app.use(express.static(DIST));

const server = http.createServer(app);
const io = new Server(server, {
  // Same origin in production; Vite proxies in development.
  pingInterval: 10000,
  pingTimeout: 8000,
});

const rooms = new RoomManager(io, accounts.progression, accounts.social);
const social = accounts.social;
const admin = new Admin({ db, accounts, rooms, social });
const SHARED_VERSION = sharedCodeVersion();
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
  socket.on('adminJoin', (req, ack) => reply(ack, admin.join(socket, req && typeof req === 'object' ? { code: String(req.code || ''), mode: String(req.mode || '') } : {})));

  socket.on('setTeam', (team, ack) => {
    const room = socket.data.room;
    reply(ack, room ? room.setTeam(socket.id, team) : { error: 'Not in a room.' });
  });

  socket.on('setMap', (mapId, ack) => {
    const room = socket.data.room;
    reply(ack, room ? room.setMap(socket.id, String(mapId)) : { error: 'Not in a room.' });
  });

  socket.on('setMode', (mode, ack) => {
    const room = socket.data.room;
    reply(ack, room ? room.setMode(socket.id, String(mode)) : { error: 'Not in a room.' });
  });

  socket.on('startMatch', (ack) => {
    const room = socket.data.room;
    reply(ack, room ? room.start(socket.id) : { error: 'Not in a room.' });
  });

  socket.on('inputs', (batch) => {
    socket.data.room?.handleInputs(socket.id, batch);
  });

  socket.on('action', (type) => {
    if (type === 'breach' || type === 'reinforce' || type === 'droneNext' || type === 'ping' || type === 'ability' || type === 'utility' || type === 'camView' || type === 'barricade' || type === 'melee') socket.data.room?.handleAction(socket.id, type);
  });

  socket.on('pickOperator', (opId) => socket.data.room?.game?.pickOperator(socket.id, String(opId)));

  socket.on('pickUtility', (id) => socket.data.room?.game?.pickUtility(socket.id, String(id)));

  socket.on('voteSite', (i) => socket.data.room?.game?.voteSite(socket.id, i));

  socket.on('spawnChoice', (n) => socket.data.room?.game?.setSpawnChoice(socket.id, n));

  socket.on('netPing', (ack) => reply(ack));
  socket.on('leaveRoom', () => { socket.data.room?.remove(socket); socket.data.spectating?.removeSpectator(socket); });
  socket.on('disconnect', () => { socket.data.room?.remove(socket); socket.data.spectating?.removeSpectator(socket); });
});

server.listen(PORT, () => {
  console.log(`Breachline server listening on port ${PORT}`);
});
