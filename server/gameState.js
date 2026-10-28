// Authoritative simulation for one room's match.
// Clients send timestamped inputs; the server replays them through the shared
// movement code and broadcasts snapshots. Input time is rationed against real
// time so a modified client can't move faster by sending extra inputs.

import { MAP } from '../shared/map.js';
import { createPlayerState, stepPlayer } from '../shared/movement.js';
import { SNAPSHOT_RATE, MAX_INPUT_DT, MAX_TIME_BUDGET } from '../shared/constants.js';

const TICK_RATE = 60;
const MAX_QUEUED_INPUTS = 120;
const MAX_PITCH = Math.PI / 2;

export class GameState {
  constructor(room) {
    this.room = room;
    this.world = { boxes: MAP.boxes };
    this.players = new Map(); // id -> ServerPlayer
    this.timer = null;
    this.tick = 0;
    this.lastTickTime = 0;
  }

  addPlayer(member) {
    const spawn = this.pickSpawn(member.team);
    this.players.set(member.id, {
      member,                          // shared with the room (name, team)
      state: createPlayerState(spawn),
      queue: [],
      lastSeq: -1,
      timeBudget: 0,
    });
  }

  removePlayer(id) {
    this.players.delete(id);
  }

  pickSpawn(team) {
    const spawns = MAP.spawns[team];
    const used = [...this.players.values()].filter((p) => p.member.team === team).length;
    return spawns[used % spawns.length];
  }

  start() {
    this.lastTickTime = performance.now();
    this.timer = setInterval(() => this.update(), 1000 / TICK_RATE);
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
  }

  queueInputs(id, batch) {
    const p = this.players.get(id);
    if (!p || !Array.isArray(batch)) return;
    for (const raw of batch.slice(0, 30)) {
      const input = sanitizeInput(raw);
      if (!input || input.seq <= p.lastSeq) continue;
      if (p.queue.length >= MAX_QUEUED_INPUTS) break;
      p.queue.push(input);
    }
  }

  update() {
    const now = performance.now();
    const realDt = Math.min(0.25, (now - this.lastTickTime) / 1000);
    this.lastTickTime = now;
    this.tick++;

    for (const p of this.players.values()) {
      p.timeBudget = Math.min(MAX_TIME_BUDGET, p.timeBudget + realDt);
      while (p.queue.length && p.queue[0].dt <= p.timeBudget + 1e-6) {
        const input = p.queue.shift();
        p.timeBudget -= input.dt;
        stepPlayer(p.state, input, input.dt, this.world);
        p.lastSeq = input.seq;
      }
    }

    if (this.tick % Math.round(TICK_RATE / SNAPSHOT_RATE) === 0) this.broadcastSnapshot();
  }

  broadcastSnapshot() {
    const players = [];
    for (const [id, p] of this.players) {
      const s = p.state;
      players.push({
        id, seq: p.lastSeq,
        x: s.x, y: s.y, z: s.z, vx: s.vx, vy: s.vy, vz: s.vz,
        yaw: s.yaw, pitch: s.pitch, crouch: s.crouch, lean: s.lean, onGround: s.onGround,
      });
    }
    this.room.io.to(this.room.channel).volatile.emit('snapshot', { t: Date.now(), players });
  }

  startPayload() {
    return {
      mapName: MAP.name,
      players: [...this.players.entries()].map(([id, p]) => ({
        id, name: p.member.name, team: p.member.team, state: p.state,
      })),
    };
  }
}

function sanitizeInput(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const seq = Number(raw.seq), dt = Number(raw.dt), yaw = Number(raw.yaw), pitch = Number(raw.pitch);
  if (!Number.isInteger(seq) || !Number.isFinite(dt) || !Number.isFinite(yaw) || !Number.isFinite(pitch)) return null;
  if (dt <= 0 || dt > MAX_INPUT_DT) return null;
  return {
    seq,
    dt,
    keys: (raw.keys | 0) & 0xff,
    yaw: yaw % (Math.PI * 2),
    pitch: Math.max(-MAX_PITCH, Math.min(MAX_PITCH, pitch)),
  };
}
