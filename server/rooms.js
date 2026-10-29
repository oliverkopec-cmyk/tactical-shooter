// Room lifecycle: codes, joining/leaving, team selection, host handover.

import { TEAMS, MAX_PER_TEAM, ROOM_CODE_LENGTH, MAX_NAME_LENGTH } from '../shared/constants.js';
import { GameState } from './gameState.js';
import { DEFAULT_MAP_ID, MAP_IDS } from '../shared/map.js';

// No I or O, so codes can't be confused with 1 / 0.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

export class RoomManager {
  constructor(io, progression = null) {
    this.io = io;
    this.progression = progression;   // pays out rewards and rank changes when a match ends
    this.rooms = new Map(); // code -> Room
  }

  generateCode() {
    for (let attempt = 0; attempt < 1000; attempt++) {
      let code = '';
      for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
        code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
      }
      if (!this.rooms.has(code)) return code;
    }
    throw new Error('No free room codes');
  }

  createRoom() {
    const room = new Room(this.io, this.generateCode(), () => this.rooms.delete(room.code), this.progression);
    this.rooms.set(room.code, room);
    return room;
  }

  get(code) {
    return this.rooms.get(String(code || '').toUpperCase().trim());
  }
}

/** The skins and preferred operators the player's account has equipped right now. */
function loadoutFrom(socket) {
  const a = socket?.data?.account;
  return { skins: a?.skins || {}, preferred: a?.operators || {}, owned: a?.owned || [] };
}

export function cleanName(name) {
  const cleaned = String(name || '').replace(/[^\p{L}\p{N} _\-.]/gu, '').trim().slice(0, MAX_NAME_LENGTH);
  return cleaned || 'Player';
}

class Room {
  constructor(io, code, onEmpty, progression = null) {
    this.io = io;
    this.progression = progression;
    this.code = code;
    this.onEmpty = onEmpty;
    this.channel = `room:${code}`;
    this.members = new Map(); // socketId -> { id, accountId, name, team }
    this.hostId = null;
    this.mapId = DEFAULT_MAP_ID;   // chosen by the host in the lobby
    this.phase = 'lobby';     // 'lobby' | 'match'
    this.game = null;
  }

  teamCount(team) {
    let n = 0;
    for (const m of this.members.values()) if (m.team === team) n++;
    return n;
  }

  isFull() {
    return this.members.size >= MAX_PER_TEAM * 2;
  }

  add(socket) {
    // Fill the smaller team first
    const team = this.teamCount(TEAMS.ATTACK) <= this.teamCount(TEAMS.DEFENSE) ? TEAMS.ATTACK : TEAMS.DEFENSE;
    const { id: accountId, username } = socket.data.account;
    const member = { id: socket.id, accountId, name: cleanName(username), team, ...loadoutFrom(socket) };
    this.members.set(socket.id, member);
    if (!this.hostId) this.hostId = socket.id;
    socket.join(this.channel);
    socket.data.room = this;

    if (this.phase === 'match') {
      // Late joiners drop straight into the running match.
      this.game.addPlayer(member);
      socket.emit('matchStart', this.game.startPayload(member.team));
    }
    this.broadcastState();
    return member;
  }

  remove(socket) {
    if (!this.members.has(socket.id)) return;
    this.members.delete(socket.id);
    socket.leave(this.channel);
    socket.data.room = null;
    if (this.game) this.game.removePlayer(socket.id);

    if (this.members.size === 0) {
      this.destroy();
      return;
    }
    if (this.hostId === socket.id) this.hostId = this.members.keys().next().value;
    if (this.game && !this.game.hasBothSides()) {
      this.endMatch('A team has no players left, so the match was ended.');
      return;
    }
    this.broadcastState();
  }

  setTeam(socketId, team) {
    if (this.phase !== 'lobby') return { error: 'Teams are locked once the match starts.' };
    if (team !== TEAMS.ATTACK && team !== TEAMS.DEFENSE) return { error: 'Unknown team.' };
    const m = this.members.get(socketId);
    if (!m || m.team === team) return {};
    if (this.teamCount(team) >= MAX_PER_TEAM) return { error: 'That team is full.' };
    m.team = team;
    this.broadcastState();
    return {};
  }

  /** The host picks the map for the next match. */
  setMap(socketId, mapId) {
    if (socketId !== this.hostId) return { error: 'Only the host can choose the map.' };
    if (this.phase !== 'lobby') return { error: 'The map is locked once the match starts.' };
    if (!MAP_IDS.includes(mapId)) return { error: 'Unknown map.' };
    this.mapId = mapId;
    this.broadcastState();
    return {};
  }

  start(socketId) {
    if (socketId !== this.hostId) return { error: 'Only the host can start the match.' };
    if (this.phase !== 'lobby') return { error: 'Match already started.' };
    if (this.teamCount(TEAMS.ATTACK) === 0 || this.teamCount(TEAMS.DEFENSE) === 0) {
      return { error: 'Both teams need at least one player.' };
    }
    this.phase = 'match';
    // Pick up any skin or operator changes made since each player joined the room
    for (const m of this.members.values()) Object.assign(m, loadoutFrom(this.io.sockets.sockets.get(m.id)));
    this.game = new GameState(this);
    for (const m of this.members.values()) this.game.addPlayer(m);
    this.game.start();
    for (const m of this.members.values()) this.io.to(m.id).emit('matchStart', this.game.startPayload(m.team));
    this.broadcastState();
    return {};
  }

  handleInputs(socketId, batch) {
    if (this.game) this.game.queueInputs(socketId, batch);
  }

  handleAction(socketId, type) {
    if (this.game) this.game.handleAction(socketId, type);
  }

  publicState() {
    return {
      code: this.code,
      hostId: this.hostId,
      phase: this.phase,
      mapId: this.mapId,
      players: [...this.members.values()].map(({ id, name, team, skins }) => ({ id, name, team, skins })),
    };
  }

  broadcastState() {
    this.io.to(this.channel).emit('roomState', this.publicState());
  }

  /** Back to the lobby, with everyone returned to the side they started on. */
  endMatch(notice = '') {
    if (this.game) this.game.stop();
    this.game = null;
    this.phase = 'lobby';
    for (const m of this.members.values()) m.team = m.startTeam || m.team;
    if (notice) this.io.to(this.channel).emit('notice', { message: notice });
    this.broadcastState();
  }

  destroy() {
    if (this.game) this.game.stop();
    this.game = null;
    this.onEmpty();
  }
}
