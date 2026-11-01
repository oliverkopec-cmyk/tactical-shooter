// Room lifecycle: codes, joining/leaving, team selection, host handover.

import { TEAMS, MAX_PER_TEAM, ROOM_CODE_LENGTH, MAX_NAME_LENGTH } from '../shared/constants.js';
import { GameState } from './gameState.js';
import { DEFAULT_MAP_ID, MAP_IDS } from '../shared/map.js';
import { MODE_IDS, DEFAULT_MODE_ID } from '../shared/modes.js';
import { isOwner } from './roles.js';
import { OPERATORS } from '../shared/operators.js';
import { BOT_DIFFICULTIES } from './bots.js';
import { navFor } from './nav.js';
import { getMap } from '../shared/map.js';

const BOT_NAMES = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot', 'Golf', 'Hotel', 'India', 'Juliet'];

// No I or O, so codes can't be confused with 1 / 0.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

export class RoomManager {
  constructor(io, progression = null, social = null) {
    this.io = io;
    this.progression = progression;   // pays out rewards and rank changes when a match ends
    this.social = social;             // told when players join, leave or start a match (friends see it)
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
    const room = new Room(this.io, this.generateCode(), () => this.rooms.delete(room.code), this.progression, this.social);
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
  return { skins: a?.skins || {}, charms: a?.charms || {}, preferred: a?.operators || {}, owned: a?.owned || [] };
}

export function cleanName(name) {
  const cleaned = String(name || '').replace(/[^\p{L}\p{N} _\-.]/gu, '').trim().slice(0, MAX_NAME_LENGTH);
  return cleaned || 'Player';
}

class Room {
  constructor(io, code, onEmpty, progression = null, social = null) {
    this.io = io;
    this.progression = progression;
    this.social = social;
    this.code = code;
    this.onEmpty = onEmpty;
    this.channel = `room:${code}`;
    this.members = new Map(); // socketId -> { id, accountId, name, team, owner }
    this.spectators = new Map(); // socketId -> socket: admins watching invisibly (not members, never listed)
    this.hostId = null;
    this.mapId = DEFAULT_MAP_ID;   // chosen by the host in the lobby
    this.mode = DEFAULT_MODE_ID;   // and the game mode
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

  /** `forceTeam` (admins joining as a player) picks the side; otherwise the smaller team is filled first. */
  add(socket, forceTeam = null) {
    const team = forceTeam || (this.teamCount(TEAMS.ATTACK) <= this.teamCount(TEAMS.DEFENSE) ? TEAMS.ATTACK : TEAMS.DEFENSE);
    const { id: accountId, username } = socket.data.account;
    const member = { id: socket.id, accountId, name: cleanName(username), owner: isOwner(username), team, ...loadoutFrom(socket) };
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
    this.social?.presenceChanged(accountId);
    return member;
  }

  get spectatorChannel() { return `${this.channel}:spectators`; }

  /** An admin watches a running match without being a member: nobody sees them in lists, scoreboards or counts. */
  addSpectator(socket) {
    if (this.phase !== 'match' || !this.game) return { error: 'That room has not started a match yet.' };
    this.spectators.set(socket.id, socket);
    socket.join(this.channel);               // match events (kills, gadgets, destruction...) reach them like anyone
    socket.join(this.spectatorChannel);      // plus the full snapshot, with nothing hidden
    socket.data.spectating = this;
    socket.emit('matchStart', { ...this.game.startPayload('spectator'), spectator: true });
    return {};
  }

  removeSpectator(socket) {
    if (!this.spectators.delete(socket.id)) return;
    socket.leave(this.channel);
    socket.leave(this.spectatorChannel);
    if (socket.data.spectating === this) socket.data.spectating = null;
  }

  /** Everyone watching is sent back to the menu (the match ended or the room closed). */
  dismissSpectators(message) {
    for (const s of [...this.spectators.values()]) {
      this.removeSpectator(s);
      s.emit('spectateEnd', { message });
    }
  }

  remove(socket) {
    if (!this.members.has(socket.id)) return;
    this.members.delete(socket.id);
    socket.leave(this.channel);
    socket.data.room = null;
    this.social?.presenceChanged(socket.data.account.id);
    if (this.game) this.game.removePlayer(socket.id);

    const humans = [...this.members.values()].filter((m) => !m.bot);
    if (humans.length === 0) {          // only bots left: close the room
      this.destroy();
      return;
    }
    if (this.hostId === socket.id) this.hostId = humans[0].id;
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
    if (this.hasBots) navFor(getMap(mapId));
    this.broadcastState();
    return {};
  }

  // ---------------------------------------------------------------- bots

  /** The host adds a bot to a side (lobby only). difficulty: 'easy' | 'normal' | 'hard'. */
  addBot(socketId, team, difficulty = 'normal') {
    if (socketId !== this.hostId) return { error: 'Only the host can add bots.' };
    if (this.phase !== 'lobby') return { error: 'Bots can only be added in the lobby.' };
    if (team !== TEAMS.ATTACK && team !== TEAMS.DEFENSE) return { error: 'Unknown team.' };
    if (!BOT_DIFFICULTIES[difficulty]) return { error: 'Unknown difficulty.' };
    if (this.teamCount(team) >= MAX_PER_TEAM) return { error: 'That team is full.' };
    const used = new Set([...this.members.values()].map((m) => m.name));
    const name = `Bot ${BOT_NAMES.find((n) => !used.has(`Bot ${n}`)) || this.members.size}`;
    this.botCount = (this.botCount || 0) + 1;
    const id = `bot-${this.code}-${this.botCount}`;
    this.members.set(id, {
      id, accountId: null, name, owner: false, team, bot: difficulty,
      skins: {}, charms: {}, preferred: {}, owned: Object.keys(OPERATORS),   // bots may play any operator
    });
    navFor(getMap(this.mapId));      // start building the map's walking grid now, so it's ready by the match
    this.broadcastState();
    return {};
  }

  /** Fill every empty slot on both sides with bots. */
  fillBots(socketId, difficulty = 'normal') {
    if (socketId !== this.hostId) return { error: 'Only the host can add bots.' };
    for (const team of [TEAMS.ATTACK, TEAMS.DEFENSE]) {
      while (this.teamCount(team) < MAX_PER_TEAM) {
        const res = this.addBot(socketId, team, difficulty);
        if (res.error) return res;
      }
    }
    return {};
  }

  removeBot(socketId, botId) {
    if (socketId !== this.hostId) return { error: 'Only the host can remove bots.' };
    if (this.phase !== 'lobby') return { error: 'Bots can only be removed in the lobby.' };
    const m = this.members.get(botId);
    if (!m?.bot) return { error: 'No such bot.' };
    this.members.delete(botId);
    this.broadcastState();
    return {};
  }

  get hasBots() { return [...this.members.values()].some((m) => m.bot); }

  /** The host picks the game mode for the next match. */
  setMode(socketId, mode) {
    if (socketId !== this.hostId) return { error: 'Only the host can choose the game mode.' };
    if (this.phase !== 'lobby') return { error: 'The mode is locked once the match starts.' };
    if (!MODE_IDS.includes(mode)) return { error: 'Unknown game mode.' };
    this.mode = mode;
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
    for (const m of this.members.values()) if (!m.bot) Object.assign(m, loadoutFrom(this.io.sockets.sockets.get(m.id)));
    this.game = new GameState(this);
    for (const m of this.members.values()) this.game.addPlayer(m);
    this.game.start();
    for (const m of this.members.values()) this.io.to(m.id).emit('matchStart', this.game.startPayload(m.team));
    for (const m of this.members.values()) if (m.accountId) this.social?.presenceChanged(m.accountId);
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
      mode: this.mode,
      players: [...this.members.values()].map(({ id, name, team, skins, charms, owner, bot }) => ({ id, name, team, skins, charms, owner, bot: bot || null })),
    };
  }

  broadcastState() {
    this.io.to(this.channel).emit('roomState', this.publicState());
  }

  /** Back to the lobby, with everyone returned to the side they started on. */
  endMatch(notice = '') {
    if (this.game) this.game.stop();
    this.game = null;
    this.dismissSpectators('The match has ended.');
    this.phase = 'lobby';
    for (const m of this.members.values()) m.team = m.startTeam || m.team;
    if (notice) this.io.to(this.channel).emit('notice', { message: notice });
    this.broadcastState();
    for (const m of this.members.values()) if (m.accountId) this.social?.presenceChanged(m.accountId);
  }

  destroy() {
    this.dismissSpectators('The room was closed.');
    if (this.game) this.game.stop();
    this.game = null;
    this.onEmpty();
  }
}
