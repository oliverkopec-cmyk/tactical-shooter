// Authoritative simulation for one room's match.
// Clients send timestamped inputs; the server replays them through the shared
// movement and weapon code, resolves shots, and broadcasts snapshots. Input
// time is rationed against real time so a modified client can't move or fire
// faster by sending extra inputs.

import { MAP } from '../shared/map.js';
import { createPlayerState, stepPlayer } from '../shared/movement.js';
import { createWeaponState, stepWeapon, WEAPON_ORDER } from '../shared/weapons.js';
import {
  SNAPSHOT_RATE, MAX_INPUT_DT, MAX_TIME_BUDGET, KEY_MASK, MAX_HEALTH, RESPAWN_MS,
} from '../shared/constants.js';
import { PoseHistory, resolveShot } from './combat.js';

const TICK_RATE = 60;
const MAX_QUEUED_INPUTS = 120;
const MAX_PITCH = Math.PI / 2;

export class GameState {
  constructor(room) {
    this.room = room;
    this.world = { boxes: MAP.boxes };
    this.players = new Map(); // id -> ServerPlayer
    this.history = new PoseHistory();
    this.timer = null;
    this.tick = 0;
    this.lastTickTime = 0;
  }

  get io() {
    return this.room.io;
  }

  emitAll(event, payload) {
    this.io.to(this.room.channel).emit(event, payload);
  }

  addPlayer(member) {
    this.players.set(member.id, {
      member,                          // shared with the room (name, team)
      state: createPlayerState(this.pickSpawn(member.team)),
      weapon: createWeaponState('rifle'),
      health: MAX_HEALTH,
      alive: true,
      respawnAt: 0,
      queue: [],
      lastSeq: -1,
      timeBudget: 0,
    });
  }

  removePlayer(id) {
    this.players.delete(id);
  }

  pickSpawn(team, random = false) {
    const spawns = MAP.spawns[team];
    if (random) return spawns[Math.floor(Math.random() * spawns.length)];
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
      if (!p.alive) { p.lastSeq = input.seq; continue; } // dead: acknowledge and drop
      if (p.queue.length >= MAX_QUEUED_INPUTS) break;
      p.queue.push(input);
    }
  }

  update() {
    const now = performance.now();
    const realDt = Math.min(0.25, (now - this.lastTickTime) / 1000);
    this.lastTickTime = now;
    this.tick++;
    const wallNow = Date.now();

    for (const [id, p] of this.players) {
      if (!p.alive) {
        if (p.respawnAt && wallNow >= p.respawnAt) this.respawn(id, p);
        continue;
      }
      p.timeBudget = Math.min(MAX_TIME_BUDGET, p.timeBudget + realDt);
      while (p.alive && p.queue.length && p.queue[0].dt <= p.timeBudget + 1e-6) {
        const input = p.queue.shift();
        p.timeBudget -= input.dt;
        stepPlayer(p.state, input, input.dt, this.world);
        if (stepWeapon(p.weapon, input, input.dt)) this.fire(id, p, input, wallNow);
        p.lastSeq = input.seq;
      }
    }

    this.history.record(wallNow, this.players);
    if (this.tick % Math.round(TICK_RATE / SNAPSHOT_RATE) === 0) this.broadcastSnapshot();
  }

  fire(shooterId, shooter, input, now) {
    const shot = resolveShot({
      shooterId, shooter, input, world: this.world, players: this.players, history: this.history, now,
    });

    // Total damage per victim across pellets
    const damageById = new Map();
    for (const pellet of shot.pellets) {
      if (!pellet.hitId) continue;
      const entry = damageById.get(pellet.hitId) || { damage: 0, head: false };
      entry.damage += pellet.damage;
      entry.head = entry.head || pellet.head;
      damageById.set(pellet.hitId, entry);
    }

    // Others see a tracer; the shooter already drew its own predicted one.
    const shooterSocket = this.io.sockets.sockets.get(shooterId);
    const shotMsg = { id: shooterId, w: shooter.weapon.id, ends: shot.pellets.map((p) => p.end.map(round2)) };
    if (shooterSocket) shooterSocket.to(this.room.channel).emit('shot', shotMsg);
    else this.emitAll('shot', shotMsg);

    for (const [victimId, { damage, head }] of damageById) {
      const victim = this.players.get(victimId);
      if (!victim || !victim.alive) continue;
      const dealt = Math.max(1, Math.round(damage));
      victim.health = Math.max(0, victim.health - dealt);
      const killed = victim.health === 0;

      this.io.to(shooterId).emit('hitConfirm', { victim: victimId, damage: dealt, head, killed });
      this.io.to(victimId).emit('damaged', {
        attacker: shooterId, damage: dealt, health: victim.health,
        from: [round2(shot.origin[0]), round2(shot.origin[2])],
      });
      if (killed) this.kill(victimId, victim, shooterId, shooter.weapon.id, head);
    }
  }

  kill(victimId, victim, killerId, weaponId, head) {
    victim.alive = false;
    victim.queue.length = 0;
    victim.respawnAt = Date.now() + RESPAWN_MS;
    this.emitAll('kill', { killer: killerId, victim: victimId, weapon: weaponId, head });
  }

  respawn(id, p) {
    p.state = createPlayerState(this.pickSpawn(p.member.team, true));
    p.weapon = createWeaponState(p.weapon.id);
    p.health = MAX_HEALTH;
    p.alive = true;
    p.respawnAt = 0;
    p.timeBudget = 0;
    this.io.to(id).emit('respawn', { state: p.state, weapon: p.weapon, health: p.health, seq: p.lastSeq });
  }

  broadcastSnapshot() {
    const players = [];
    for (const [id, p] of this.players) {
      const s = p.state, w = p.weapon;
      players.push({
        id, seq: p.lastSeq, alive: p.alive, hp: p.health,
        x: s.x, y: s.y, z: s.z, vx: s.vx, vy: s.vy, vz: s.vz,
        yaw: s.yaw, pitch: s.pitch, crouch: s.crouch, lean: s.lean, onGround: s.onGround,
        w: { id: w.id, ammo: w.ammo, reserve: w.reserve, cooldown: w.cooldown, reload: w.reload, bloom: w.bloom, trigger: w.trigger },
      });
    }
    this.io.to(this.room.channel).volatile.emit('snapshot', { t: Date.now(), players });
  }

  startPayload() {
    return {
      mapName: MAP.name,
      players: [...this.players.entries()].map(([id, p]) => ({
        id, name: p.member.name, team: p.member.team, state: p.state,
        weapon: p.weapon, health: p.health, alive: p.alive,
      })),
    };
  }
}

const round2 = (v) => Math.round(v * 100) / 100;

function sanitizeInput(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const seq = Number(raw.seq), dt = Number(raw.dt), yaw = Number(raw.yaw), pitch = Number(raw.pitch);
  if (!Number.isInteger(seq) || !Number.isFinite(dt) || !Number.isFinite(yaw) || !Number.isFinite(pitch)) return null;
  if (dt <= 0 || dt > MAX_INPUT_DT) return null;
  const wsel = Number(raw.wsel) | 0;
  const rt = Number(raw.rt);
  return {
    seq,
    dt,
    keys: (raw.keys | 0) & KEY_MASK,
    yaw: yaw % (Math.PI * 2),
    pitch: Math.max(-MAX_PITCH, Math.min(MAX_PITCH, pitch)),
    wsel: wsel >= 1 && wsel <= WEAPON_ORDER.length ? wsel : 0,
    rt: Number.isFinite(rt) ? rt : 0,
  };
}
