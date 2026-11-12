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
import { roomEvents } from './roomEvents.js';
import { menuEvents } from './menuEvents.js';
import { nodeRooms } from './nodeRooms.js';

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
// Pages built from different shared code would mispredict movement: send them back to reload.
// ('dev' is the Vite dev server, which always runs the current files.)
io.use((socket, next) => {
  const version = socket.handshake.auth?.version;
  next(version === SHARED_VERSION || version === 'dev' ? undefined : new Error('outdated'));
});
io.use(accounts.socketAuth());

const roomsHere = nodeRooms({ rooms, social, admin });
io.on('connection', (socket) => {
  accounts.trackOnline(socket);
  gifts.sendPending(socket);   // unopened gifts wait in the menu as presents
  christmas.sendState(socket);
  // The menus (shared with the Cloudflare central object) and everything in a room (shared with the match rooms)
  menuEvents(socket, { social, admin, gifts, christmas, moderation, rooms: roomsHere });
  roomEvents(socket, { moderation });
});

server.listen(PORT, () => {
  console.log(`Breachline server listening on port ${PORT}`);
});
