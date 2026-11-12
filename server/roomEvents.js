// Everything a player does in a room: the lobby (teams, bots, map, mode, start), the match (input batches, actions,
// picks), chat and reports, and leaving. Shared by the Node server (server/index.js) and the Cloudflare match rooms
// (worker/matchRoom.js), so both run exactly the same rules. Each handler finds the room through socket.data.room.

const reply = (ack, payload) => { if (typeof ack === 'function') ack(payload); };
const obj = (v) => (v && typeof v === 'object' ? v : {});

// The in-match events a batch may carry (each is also handled below as an event of its own)
export const BATCH_EVENTS = new Set(['action', 'actionEnd', 'teamPing', 'pickOperator', 'pickUtility', 'voteSite', 'spawnChoice', 'refreshLook']);
const ACTIONS = new Set(['breach', 'reinforce', 'droneNext', 'ping', 'ability', 'utility', 'camView', 'barricade', 'melee']);
const HELD_ACTIONS = new Set(['breach', 'reinforce', 'ability', 'utility', 'barricade']);   // placing takes time while the key is held (Stage 27)

/** moderation: server/moderation.js (chat and reports). */
export function roomEvents(socket, { moderation }) {
  const inRoom = (fn) => (...args) => {
    const ack = typeof args.at(-1) === 'function' ? args.pop() : null;
    const room = socket.data.room;
    reply(ack, room ? fn(room, ...args) : { error: 'Not in a room.' });
  };

  socket.on('setTeam', inRoom((room, team) => room.setTeam(socket.id, team)));
  socket.on('setMap', inRoom((room, mapId) => room.setMap(socket.id, String(mapId))));
  socket.on('addBot', inRoom((room, { team, difficulty } = {}) => room.addBot(socket.id, String(team), String(difficulty))));
  socket.on('fillBots', inRoom((room, { difficulty } = {}) => room.fillBots(socket.id, String(difficulty))));
  socket.on('removeBot', inRoom((room, botId) => room.removeBot(socket.id, String(botId))));
  socket.on('setMode', inRoom((room, mode) => room.setMode(socket.id, String(mode))));
  socket.on('startMatch', inRoom((room) => room.start(socket.id)));

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

  socket.on('action', (type) => { if (ACTIONS.has(type)) socket.data.room?.handleAction(socket.id, type); });
  // A held key went up
  socket.on('actionEnd', (type) => { if (HELD_ACTIONS.has(type)) socket.data.room?.handleActionEnd(socket.id, type); });
  socket.on('teamPing', (type) => socket.data.room?.game?.teamPing(socket.id, String(type)));
  socket.on('pickOperator', (opId) => socket.data.room?.game?.pickOperator(socket.id, String(opId)));
  socket.on('pickUtility', (id) => socket.data.room?.game?.pickUtility(socket.id, String(id)));
  socket.on('voteSite', (i) => socket.data.room?.game?.voteSite(socket.id, i));
  socket.on('spawnChoice', (n) => socket.data.room?.game?.setSpawnChoice(socket.id, n));
  // Skins or charms changed on the loadout screen mid-match: everyone sees the new look
  socket.on('refreshLook', () => socket.data.room?.refreshLook(socket));

  // Chat in a match, and reporting someone from your current or last match
  socket.on('chat', (req, ack) => reply(ack, moderation.chat(socket, obj(req))));
  socket.on('report', async (req, ack) => {
    try { reply(ack, await moderation.report(socket, obj(req))); } catch (err) { console.error('Report failed:', err.message); reply(ack, { error: 'Server error.' }); }
  });

  socket.on('leaveRoom', () => { socket.data.room?.remove(socket); socket.data.spectating?.removeSpectator(socket); });
  socket.on('disconnect', () => { socket.data.room?.remove(socket); socket.data.spectating?.removeSpectator(socket); });
}
