// Admin tools: who is online, what matches are running, and joining a match to watch or play.
// Every call checks the caller's role again from the username the server stored at login.

import { MAX_PER_TEAM, TEAMS } from '../shared/constants.js';
import { rankInfo } from '../shared/progression.js';
import { getMap } from '../shared/map.js';
import { isAdmin, isOwner } from './roles.js';

export class Admin {
  constructor({ db, accounts, rooms, social }) {
    this.db = db;
    this.accounts = accounts;
    this.rooms = rooms;
    this.social = social;
  }

  allowed(socket) {
    return isAdmin(socket.data.account?.username);
  }

  /** Every online account with its rank, level and what it is doing. */
  async online(socket) {
    if (!this.allowed(socket)) return { error: 'Not allowed.' };
    const ids = [...this.accounts.online.keys()];
    const { rows } = ids.length
      ? await this.db.query('SELECT id, username, level, rank_points FROM accounts WHERE id = ANY($1::bigint[]) ORDER BY username_lower', [ids])
      : { rows: [] };
    return {
      players: rows.map((r) => ({
        id: r.id, username: r.username, owner: isOwner(r.username), level: r.level,
        rank: rankInfo(r.rank_points).label, rankPoints: r.rank_points,
        status: this.social.statusOf(r.id),
        room: this.accounts.online.get(r.id)?.data.room?.code || this.accounts.online.get(r.id)?.data.spectating?.code || null,
      })),
    };
  }

  /** Every room with its map, players, score and round. */
  matches(socket) {
    if (!this.allowed(socket)) return { error: 'Not allowed.' };
    const out = [];
    for (const room of this.rooms.rooms.values()) {
      const info = room.game?.rounds.info();
      const team = (t) => [...room.members.values()].filter((m) => m.team === t).map((m) => ({ name: m.name, owner: !!m.owner }));
      out.push({
        code: room.code, phase: room.phase, map: getMap(room.mapId).name,
        attack: team(TEAMS.ATTACK), defense: team(TEAMS.DEFENSE),
        scores: info ? info.scores : null, round: info ? info.round : null,
        spectators: room.spectators.size,
      });
    }
    return { matches: out };
  }

  /** mode: 'spectate' (invisible, can see everything) | 'attack' | 'defense' (join as a player if there is space). */
  join(socket, { code, mode } = {}) {
    if (!this.allowed(socket)) return { error: 'Not allowed.' };
    const room = this.rooms.get(code);
    if (!room) return { error: 'No room with that code.' };
    if (mode !== 'spectate' && mode !== TEAMS.ATTACK && mode !== TEAMS.DEFENSE) return { error: 'Unknown way to join.' };
    // Leave whatever they were in first
    if (socket.data.room && socket.data.room !== room) socket.data.room.remove(socket);
    socket.data.spectating?.removeSpectator(socket);
    if (mode === 'spectate') {
      if (socket.data.room === room) return { error: 'You are already a player in that room.' };
      const res = room.addSpectator(socket);
      return res.error ? res : { ok: true, code: room.code, spectator: true, id: socket.id };
    }
    if (room.members.has(socket.id)) return { error: 'You are already in that room.' };
    if (room.isFull() || room.teamCount(mode) >= MAX_PER_TEAM) return { error: 'That side is full.' };
    room.add(socket, mode);
    return { ok: true, code: room.code, id: socket.id };
  }
}
