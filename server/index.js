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

const rooms = new RoomManager(io, accounts.progression);
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
    if (socket.data.room) socket.data.room.remove(socket);
    const room = rooms.createRoom();
    room.add(socket);
    reply(ack, { ok: true, code: room.code, id: socket.id });
  });

  socket.on('joinRoom', ({ code } = {}, ack) => {
    const room = rooms.get(code);
    if (!room) return reply(ack, { ok: false, error: 'No room with that code.' });
    if (room.isFull()) return reply(ack, { ok: false, error: 'That room is full.' });
    if (socket.data.room) socket.data.room.remove(socket);
    room.add(socket);
    reply(ack, { ok: true, code: room.code, id: socket.id });
  });

  socket.on('setTeam', (team, ack) => {
    const room = socket.data.room;
    reply(ack, room ? room.setTeam(socket.id, team) : { error: 'Not in a room.' });
  });

  socket.on('setMap', (mapId, ack) => {
    const room = socket.data.room;
    reply(ack, room ? room.setMap(socket.id, String(mapId)) : { error: 'Not in a room.' });
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
  socket.on('leaveRoom', () => socket.data.room?.remove(socket));
  socket.on('disconnect', () => socket.data.room?.remove(socket));
});

server.listen(PORT, () => {
  console.log(`Breachline server listening on port ${PORT}`);
});
