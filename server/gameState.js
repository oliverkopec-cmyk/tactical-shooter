// Authoritative simulation for one room's match.
// Clients send timestamped inputs; the server replays them through the shared
// movement and weapon code, resolves shots, and broadcasts snapshots. Input
// time is rationed against real time so a modified client can't move or fire
// faster by sending extra inputs.

import { MAP } from '../shared/map.js';
import { createPlayerState, stepPlayer } from '../shared/movement.js';
import { createWeaponState, stepWeapon, WEAPON_ORDER } from '../shared/weapons.js';
import { World } from '../shared/world.js';
import { maskKeys } from '../shared/rules.js';
import {
  SNAPSHOT_RATE, MAX_INPUT_DT, MAX_TIME_BUDGET, KEY_MASK, MAX_HEALTH, BASIC_CHARGES, PHASE, CAPTURE_TIME,
} from '../shared/constants.js';
import { PoseHistory, resolveShot } from './combat.js';
import { Destruction } from './destruction.js';
import { RoundManager } from './rounds.js';

const TICK_RATE = 60;
const MAX_QUEUED_INPUTS = 120;
const MAX_PITCH = Math.PI / 2;

export class GameState {
  constructor(room) {
    this.room = room;
    this.world = new World();
    this.destruction = new Destruction(this);
    this.rounds = new RoundManager(this);
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
    // Score follows the squad, which is fixed for the whole match.
    member.squad = this.rounds.squadOf(member.team);
    member.startTeam = this.rounds.swapped ? opposite(member.team) : member.team;
    // Joining mid-round: sit out until the next round starts.
    const joinsAlive = this.rounds.round === 0 || this.rounds.phase === PHASE.INTRO;
    this.players.set(member.id, {
      member,                          // shared with the room (name, team, squad)
      state: createPlayerState(this.pickSpawn(member.team)),
      weapon: createWeaponState('rifle'),
      health: MAX_HEALTH,
      alive: joinsAlive,
      charges: member.team === 'attack' ? BASIC_CHARGES : 0,
      placedCharge: null,
      queue: [],
      lastSeq: -1,
      timeBudget: 0,
    });
  }

  removePlayer(id) {
    this.players.delete(id);
    this.destruction.removeChargesOf(id);
    this.destruction.reinforcing.delete(id);
  }

  /** Discrete actions that aren't part of the movement input stream. */
  handleAction(id, type) {
    const p = this.players.get(id);
    if (!p) return;
    if (type === 'breach') this.destruction.useBreach(id, p);
    else if (type === 'reinforce') this.destruction.startReinforce(id, p);
  }

  sendLoadout(id, p) {
    this.io.to(id).emit('loadout', { charges: p.charges, placed: !!p.placedCharge });
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
    this.rounds.start();
  }

  /** Put everyone back at their spawn with full health and a fresh map. */
  resetRound() {
    this.world.reset();
    this.destruction.reset();
    this.history.frames.length = 0;
    const used = { attack: 0, defense: 0 };
    for (const p of this.players.values()) {
      const team = p.member.team;
      const spawns = MAP.spawns[team];
      p.state = createPlayerState(spawns[used[team]++ % spawns.length]);
      p.weapon = createWeaponState(p.weapon.id);
      p.health = MAX_HEALTH;
      p.alive = true;
      p.queue.length = 0;
      p.timeBudget = 0;
      p.charges = team === 'attack' ? BASIC_CHARGES : 0;
      p.placedCharge = null;
    }
  }

  /** Halftime: everyone changes sides. */
  swapSides() {
    for (const p of this.players.values()) p.member.team = opposite(p.member.team);
  }

  hasBothSides() {
    const sides = new Set([...this.players.values()].map((p) => p.member.team));
    return sides.has('attack') && sides.has('defense');
  }

  finishMatch() {
    this.room.endMatch();
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

    const phase = this.rounds.phase;
    for (const [id, p] of this.players) {
      if (!p.alive) continue;
      p.timeBudget = Math.min(MAX_TIME_BUDGET, p.timeBudget + realDt);
      while (p.alive && p.queue.length && p.queue[0].dt <= p.timeBudget + 1e-6) {
        const input = p.queue.shift();
        p.timeBudget -= input.dt;
        input.keys = maskKeys(input.keys, p.member.team, phase);
        stepPlayer(p.state, input, input.dt, this.world);
        if (stepWeapon(p.weapon, input, input.dt)) this.fire(id, p, input, wallNow);
        p.lastSeq = input.seq;
      }
    }

    this.rounds.update(wallNow, realDt);
    this.destruction.update(wallNow);
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

    const w = shooter.weapon.id;
    for (const pellet of shot.pellets) {
      if (pellet.panelId !== null && this.rounds.phase === PHASE.ACTION) this.destruction.damagePanel(pellet.panelId, pellet.panelDamage);
    }
    for (const [victimId, { damage, head }] of damageById) {
      this.applyDamage(victimId, shooterId, damage, { head, weapon: w, from: [shot.origin[0], shot.origin[2]] });
    }
  }

  applyDamage(victimId, attackerId, amount, { head = false, weapon, from }) {
    const victim = this.players.get(victimId);
    if (!victim || !victim.alive) return;
    const dealt = Math.max(1, Math.round(amount));
    victim.health = Math.max(0, victim.health - dealt);
    const killed = victim.health === 0;

    if (attackerId !== victimId) this.io.to(attackerId).emit('hitConfirm', { victim: victimId, damage: dealt, head, killed });
    this.io.to(victimId).emit('damaged', {
      attacker: attackerId, damage: dealt, health: victim.health,
      from: [round2(from[0]), round2(from[1])],
    });
    if (killed) this.kill(victimId, victim, attackerId, weapon, head);
  }

  kill(victimId, victim, killerId, weaponId, head) {
    victim.alive = false;
    victim.queue.length = 0;
    this.destruction.cancelReinforce(victimId, 'You were eliminated.');
    this.emitAll('kill', { killer: killerId, victim: victimId, weapon: weaponId, head });
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
    const cap = { p: Math.min(1, this.rounds.capture / CAPTURE_TIME), c: this.rounds.contested };
    this.io.to(this.room.channel).volatile.emit('snapshot', { t: Date.now(), players, cap });
  }

  startPayload() {
    return {
      mapName: MAP.name,
      players: [...this.players.entries()].map(([id, p]) => ({
        id, name: p.member.name, team: p.member.team, state: p.state,
        weapon: p.weapon, health: p.health, alive: p.alive,
        charges: p.charges, placed: !!p.placedCharge,
      })),
      destruction: this.destruction.snapshot(),
      round: this.rounds.info(),
    };
  }
}

const round2 = (v) => Math.round(v * 100) / 100;
const opposite = (team) => (team === 'attack' ? 'defense' : 'attack');

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
