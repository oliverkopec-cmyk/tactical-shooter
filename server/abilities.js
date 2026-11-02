// Operator abilities (the F key) and the gadgets they create.
//
// Each ability is a handler under ABILITIES, keyed by `ability.id` in
// shared/operators.js. A handler gets (gadgets, socketId, player, abilityConfig).
// Gadgets that other players can see (shields, wire, jammers, cameras) live in
// the Gadgets class below and are synced with `gadgetAdd` / `gadgetRemove` events.

import {
  PHASE, SHIELD, WIRE, JAMMER_RANGE, JAMMER_HITS, CAMERA_REACH, STUN, GADGET_REACH, HAWK_MISS_COOLDOWN_MS, BARRICADE,
} from '../shared/constants.js';
import { DASH_SPEED } from '../shared/constants.js';
import { findOpening } from '../shared/map.js';
import { OPERATORS } from '../shared/operators.js';
import { getEyePosition, forwardVec, eyeHeight, bodyHeight } from '../shared/movement.js';
import { aimDirection, WEAPONS, shieldCover } from '../shared/weapons.js';
import { raycastWorld, rayBox, rayPlayer } from '../shared/raycast.js';
import { droneEye } from '../shared/drone.js';
import { UTILITIES, UTIL_STATS, ABILITY_STATS, claymoreLines } from '../shared/utilities.js';
import { barricadePlanks, sectionSegments, sectionAt, BARRICADE_COLS, armorBox } from '../shared/barricade.js';

const r2 = (v) => Math.round(v * 100) / 100;

/** Distance from a player's body (a point 1 m up) to a box. */
function distToBox(s, box) {
  const px = s.x, py = s.y + 1, pz = s.z;
  const dx = Math.max(box.min[0] - px, 0, px - box.max[0]);
  const dy = Math.max(box.min[1] - py, 0, py - box.max[1]);
  const dz = Math.max(box.min[2] - pz, 0, pz - box.max[2]);
  return Math.hypot(dx, dy, dz);
}

export class Gadgets {
  constructor(game) {
    this.game = game;
    this.nextId = 1;
    this.reset();
  }

  reset() {
    this.shields = new Map();
    this.wires = new Map();
    this.jammers = new Map();
    this.cameras = new Map();
    this.grenades = new Map();
    this.claymores = new Map();        // id -> { id, owner, team, pos, dir, armedAt }
    this.fires = new Map();            // Cinder: id -> { id, owner, pos, until, nextTick }
    this.shocks = new Map();           // Volt: id -> { id, owner, team, pos }
    this.heals = new Map();            // Tonic: id -> { id, owner, team, pos, until }
    this.sensors = new Map();          // Picket: id -> { id, owner, team, pos, dir, seen }
    this.barricades = new Map();       // id -> { id, openingId, hits, planks: [{ i, min, max, hp, alive }] }
    this.barricading = new Map();      // playerId -> { openingId, doneAt, x, z }
    this.barricadesLeft = BARRICADE.pool;
    // Stage E
    this.batteries = new Map();        // Current: id -> { id, owner, team, pos, dir, sectionId, armorId, panelId, box, nextPulse }
    this.armors = new Map();           // Rampart: id -> { id, openingId, owner, hits, hammer, box }
    this.armoring = new Map();         // playerId -> { openingId, doneAt, x, z }
    this.interceptors = new Map();     // Interceptor: id -> { id, owner, team, pos, dir, catches }
    this.volleys = new Map();          // Flint: id -> { id, owner, pos, normal, panelId, barricadeId, armorId }
    this.placeStartBarricades();       // windows and outside doors start the round barricaded
  }

  get world() { return this.game.world; }
  error(id, msg) { this.game.io.to(id).emit('actionError', { msg }); }

  // ---------------------------------------------------------------- sync

  broadcast(event, kind, payload) {
    this.game.emitAll(event, { kind, ...payload });
  }

  list(team) {
    const out = [];
    for (const s of this.shields.values()) out.push({ kind: 'shield', ...s });
    for (const w of this.wires.values()) out.push({ kind: 'wire', ...w });
    for (const j of this.jammers.values()) out.push({ kind: 'jammer', ...j });
    for (const c of this.cameras.values()) out.push({ kind: 'camera', ...c });
    for (const c of this.claymores.values()) out.push({ kind: 'claymore', id: c.id, owner: c.owner, team: c.team, pos: c.pos, dir: c.dir });
    for (const s of this.shocks.values()) out.push({ kind: 'shock', id: s.id, owner: s.owner, team: s.team, pos: s.pos });
    for (const h of this.heals.values()) out.push({ kind: 'heal', id: h.id, owner: h.owner, team: h.team, pos: h.pos, ms: Math.max(0, h.until - Date.now()) });
    for (const s of this.sensors.values()) out.push({ kind: 'sensor', id: s.id, owner: s.owner, team: s.team, pos: s.pos, dir: s.dir });
    for (const b of this.barricades.values()) out.push(this.barricadeRecord(b));
    for (const b of this.batteries.values()) out.push(this.batteryRecord(b));
    for (const a of this.armors.values()) out.push({ kind: 'armor', id: a.id, openingId: a.openingId });
    for (const d of this.interceptors.values()) out.push({ kind: 'interceptor', id: d.id, owner: d.owner, team: d.team, pos: d.pos, dir: d.dir, catches: d.catches });
    return out;
  }

  // ---------------------------------------------------------------- queries

  isJammed(pos) {
    for (const j of this.jammers.values()) {
      if (Math.hypot(pos[0] - j.pos[0], pos[1] - j.pos[1], pos[2] - j.pos[2]) <= JAMMER_RANGE) return true;
    }
    return false;
  }

  /** The surface a player is aiming at, within reach. */
  aimedSurface(p, reach) {
    const eye = getEyePosition(p.state, this.world);
    const origin = [eye.x, eye.y, eye.z];
    const hit = raycastWorld(this.world, origin, aimDirection(p.state.yaw, p.state.pitch), reach);
    return hit ? { origin, hit } : null;
  }

  // ---------------------------------------------------------------- use

  use(id, p) {
    const op = OPERATORS[p.operator];
    const ab = op?.ability;
    if (!ab || !p.alive) return;
    const phase = this.game.rounds.phase;
    if (phase !== PHASE.PREP && phase !== PHASE.ACTION) return this.error(id, 'Abilities work once the round is under way.');
    if (p.spawned === false && ab.id !== 'shockDrone') return this.error(id, 'Your operator is not on the field yet.');   // Wasp zaps from her drone
    if (p.camView >= 0) return;
    ABILITIES[ab.id]?.(this, id, p, ab);
    this.game.sendLoadout(id, p);
  }

  // ---------------------------------------------------------------- per-tick

  update(dt, now) {
    this.stepGrenades(dt, now);
    this.checkClaymores(now);
    this.updateFires(now);
    this.updateShocks(now);
    this.updateHeals(dt, now);
    this.checkSensors(now);
    this.updateBarricading(now);
    this.updateArmoring(now);
    this.updateBatteries(now);
    for (const p of this.game.players.values()) {
      // Medic's overheal drains back to 100
      if (p.alive && p.health > 100) p.health = Math.max(100, p.health - ABILITY_STATS.stim.drain * dt);
      let slow = 1;
      if (p.stunUntil > now) slow = Math.min(slow, STUN.slow);
      if (p.shockUntil > now) slow = Math.min(slow, ABILITY_STATS.shock.slow);
      if (p.alive) {
        for (const w of this.wires.values()) {
          if (w.team === p.member.team) continue;   // teammates walk through their own wire at normal speed (it still rustles)
          if (Math.abs(p.state.x - w.x) < w.half && Math.abs(p.state.z - w.z) < w.half && Math.abs(p.state.y - w.y) < 0.6) {
            slow = Math.min(slow, WIRE.slow);
          }
        }
      }
      p.state.slow = slow;
    }
    for (const d of this.game.drones.values()) {
      d.jammed = this.isJammed([d.state.x, d.state.y + 0.15, d.state.z]);
    }
  }

  // ---------------------------------------------------------------- grenades
  // Thrown by Flash's stun ability (F) and by the utilities (flash, impact, smoke, frag).

  throwGrenade(p, id, type = 'stun') {
    const cfg = type === 'stun' ? STUN : type === 'fire' ? ABILITY_STATS.fire : type === 'emp' ? ABILITY_STATS.empGrenade : UTIL_STATS[type];
    const eye = getEyePosition(p.state, this.world);
    const dir = aimDirection(p.state.yaw, p.state.pitch);
    const g = {
      id: this.nextId++, owner: id, type, t: cfg.fuse,
      pos: [eye.x + dir[0] * 0.5, eye.y + dir[1] * 0.5, eye.z + dir[2] * 0.5],
      vel: [dir[0] * cfg.speed, dir[1] * cfg.speed + 2.5, dir[2] * cfg.speed],
    };
    this.grenades.set(g.id, g);
  }

  stepGrenades(dt, now) {
    for (const g of this.grenades.values()) {
      if (this.interceptors.size && this.intercept(g)) continue;
      g.t -= dt;
      g.vel[1] -= 14 * dt;
      const move = [g.vel[0] * dt, g.vel[1] * dt, g.vel[2] * dt];
      const len = Math.hypot(...move);
      const hit = len > 1e-6 ? raycastWorld(this.world, g.pos, move.map((v) => v / len), len + 0.06) : null;
      if (hit) {
        const n = hit.normal;
        g.pos = [hit.point[0] + n[0] * 0.07, hit.point[1] + n[1] * 0.07, hit.point[2] + n[2] * 0.07];
        if (g.type === 'impact') { this.explodeGrenade(g, now); continue; }
        const vn = g.vel[0] * n[0] + g.vel[1] * n[1] + g.vel[2] * n[2];
        for (let i = 0; i < 3; i++) g.vel[i] -= 1.45 * vn * n[i];
        if (n[1] > 0.5) { g.vel[0] *= 0.7; g.vel[2] *= 0.7; if (Math.hypot(...g.vel) < 0.8) g.vel = [0, 0, 0]; }
      } else {
        g.pos = [g.pos[0] + move[0], g.pos[1] + move[1], g.pos[2] + move[2]];
        if (g.type === 'impact' && this.touchesEnemy(g)) { this.explodeGrenade(g, now); continue; }
      }
      if (g.t <= 0) this.explodeGrenade(g, now);
    }
  }

  /** An impact grenade also goes off when it hits an enemy's body. */
  touchesEnemy(g) {
    const ownerTeam = this.game.players.get(g.owner)?.member.team;
    for (const q of this.game.players.values()) {
      if (!q.alive || q.spawned === false || q.member.team === ownerTeam) continue;
      for (const h of [1.45, 0.95, 0.45]) {
        if (Math.hypot(g.pos[0] - q.state.x, g.pos[1] - (q.state.y + h), g.pos[2] - q.state.z) < 0.5) return true;
      }
    }
    return false;
  }

  /** Enemies of the thrower within `radius` with a clear line from the blast, nearest first. */
  enemiesNear(g, radius) {
    const ownerTeam = this.game.players.get(g.owner)?.member.team;
    const out = [];
    for (const [pid, q] of this.game.players) {
      if (!q.alive || q.spawned === false || q.member.team === ownerTeam) continue;
      const eye = [q.state.x, q.state.y + eyeHeight(q.state.crouch, q.state.prone) - 0.2, q.state.z];
      const v = [eye[0] - g.pos[0], eye[1] - g.pos[1], eye[2] - g.pos[2]];
      const dist = Math.hypot(...v);
      if (dist > radius) continue;
      const wall = dist > 0.05 ? raycastWorld(this.world, g.pos, v.map((c) => c / dist), dist) : null;
      if (wall && wall.t < dist - 0.2) continue;       // walls shield you from the blast
      out.push({ pid, q, dist, eye });
    }
    return out.sort((a, b) => a.dist - b.dist);
  }

  explodeGrenade(g, now) {
    this.grenades.delete(g.id);
    const round = (v) => Math.round(v * 100) / 100;
    const pos = g.pos.map(round);
    if (g.type === 'fire') {
      const F = ABILITY_STATS.fire;
      this.fires.set(g.id, { id: g.id, owner: g.owner, pos, until: now + F.durationMs, nextTick: now + F.tickMs });
      this.game.emitAll('fireStart', { id: g.id, pos, ms: F.durationMs, radius: F.radius });
      return;
    }
    if (g.type === 'emp') {
      // Blackout: through walls, every defender electronic in reach is destroyed
      const E = ABILITY_STATS.empGrenade;
      for (const e of this.electronics()) {
        if (Math.hypot(e.pos[0] - g.pos[0], e.pos[1] - g.pos[1], e.pos[2] - g.pos[2]) <= E.radius) this.destroyGadget(e.kind, e.id);
      }
      this.game.emitAll('empBurst', { pos, radius: E.radius });
      return;
    }
    if (g.type === 'smoke') {
      const ms = UTIL_STATS.smoke.duration * 1000;
      this.game.emitAll('smokeStart', { id: g.id, pos, ms, radius: UTIL_STATS.smoke.radius });
      return;
    }
    if (g.type === 'stun') {
      for (const { pid, q } of this.enemiesNear(g, STUN.radius)) {
        q.stunUntil = now + STUN.duration * 1000;
        q.blindUntil = now + STUN.duration * 1000;   // bots can't see either
        this.game.io.to(pid).emit('stunned', { ms: STUN.duration * 1000 });
      }
    } else if (g.type === 'flash') {
      const F = UTIL_STATS.flash;
      for (const { pid, q, eye } of this.enemiesNear(g, F.radius)) {
        // Blinds the most when you're looking at it; looking away cuts the time
        const look = aimDirection(q.state.yaw, q.state.pitch);
        const to = [g.pos[0] - eye[0], g.pos[1] - eye[1], g.pos[2] - eye[2]];
        const d = Math.hypot(...to) || 1;
        const facing = (look[0] * to[0] + look[1] * to[1] + look[2] * to[2]) / d;
        const ms = F.duration * 1000 * (facing > 0 ? 1 : F.awayScale);
        q.blindUntil = now + ms;                       // bots are blinded too (people see a white screen)
        this.game.io.to(pid).emit('stunned', { ms });
      }
    } else {
      // frag and impact: damage that fades with distance, plus barricades in reach
      const B = UTIL_STATS[g.type];
      for (const { pid, dist } of this.enemiesNear(g, B.radius)) {
        const amount = B.damage * (1 - (1 - B.minDamage) * (dist / B.radius));
        this.game.applyDamage(pid, g.owner, amount, { weapon: g.type, from: [g.pos[0], g.pos[2]] });
      }
      this.blastBarricades(g.pos, B.barricade);
      // Soft walls near the blast: a bigger hole for a frag than for an impact grenade
      const owner = this.game.players.get(g.owner);
      if (owner && this.game.canBreakWalls(owner)) {
        const ids = this.world.panelsNear(g.pos, B.panels).filter((pid) => !this.world.isReinforcedPanel(pid));
        if (ids.length) this.game.destruction.destroy(ids);
      }
    }
    this.game.emitAll('grenadeExploded', { id: g.id, pos, type: g.type });
  }

  snapshotGrenades() {
    return [...this.grenades.values()].map((g) => ({ id: g.id, x: g.pos[0], y: g.pos[1], z: g.pos[2], k: g.type }));
  }

  // ---------------------------------------------------------------- utilities (4)

  /** The utility key: throw the grenade or stick the claymore the player picked this round. */
  useUtility(id, p) {
    const u = p.utility, def = u && UTILITIES[u.id];
    if (!def || !p.alive) return;
    const phase = this.game.rounds.phase;
    if (phase !== PHASE.PREP && phase !== PHASE.ACTION) return this.error(id, 'Utilities work once the round is under way.');
    if (p.spawned === false) return this.error(id, 'Your operator is not on the field yet.');
    if (p.camView >= 0) return;
    const now = Date.now();
    if (now < (p.utilityReadyAt || 0)) return;
    if (u.charges <= 0) return this.error(id, `No ${def.name.toLowerCase()}s left.`);
    if (def.kind === 'placed') {
      if (!this.placeClaymore(id, p)) return;
    } else {
      this.throwGrenade(p, id, u.id);
    }
    u.charges--;
    p.stats.utilities++;
    p.utilityReadyAt = now + UTIL_STATS.cooldown * 1000;
    this.game.sendLoadout(id, p);
  }

  // ---------------------------------------------------------------- claymores

  placeClaymore(id, p) {
    const aim = this.aimedSurface(p, UTIL_STATS.claymore.reach);
    if (!aim) return this.error(id, 'Aim at a floor or wall within 3 m.');
    const { point, normal } = aim.hit;
    if (normal[1] < -0.5) return this.error(id, 'Claymores go on floors and walls.');
    let dir;
    if (normal[1] > 0.5) {
      const [fx, fz] = forwardVec(p.state.yaw);            // on the floor it points the way you face
      dir = [fx, 0, fz];
    } else {
      const len = Math.hypot(normal[0], normal[2]) || 1;
      dir = [normal[0] / len, 0, normal[2] / len];
    }
    const rec = {
      id: this.nextId++, owner: id, team: p.member.team,
      pos: point.map((v, i) => Math.round((v + normal[i] * 0.06) * 100) / 100), dir: dir.map((v) => Math.round(v * 100) / 100),
      armedAt: Date.now() + UTIL_STATS.claymore.arm * 1000,
    };
    this.claymores.set(rec.id, rec);
    this.broadcast('gadgetAdd', 'claymore', { id: rec.id, owner: id, team: rec.team, pos: rec.pos, dir: rec.dir });
    return true;
  }

  /** Ids of every enemy whose body touches one of the gadget's tripwires. */
  touching(c) {
    const touch = UTIL_STATS.claymore.touch;
    const out = [];
    for (const line of claymoreLines(this.world, c.pos, c.dir)) {
      const [ax, , az] = line.from, [bx, , bz] = line.to;
      const abx = bx - ax, abz = bz - az, len2 = abx * abx + abz * abz || 1;
      for (const [pid, q] of this.game.players) {
        if (out.includes(pid) || !q.alive || q.spawned === false || q.member.team === c.team) continue;
        const s = q.state;
        const y = line.from[1];
        if (y < s.y - 0.05 || y > s.y + bodyHeight(s.crouch, s.prone || 0)) continue;   // the line passes over or under them
        const t = Math.max(0, Math.min(1, ((s.x - ax) * abx + (s.z - az) * abz) / len2));
        if (Math.hypot(s.x - (ax + abx * t), s.z - (az + abz * t)) <= touch) out.push(pid);
      }
    }
    return out;
  }

  /** The first enemy touching a claymore's tripwires, or null. */
  tripped(c) {
    return this.touching(c)[0] ?? null;
  }

  /** Enemies in front of the claymore, close enough and in the clear, caught by the blast. */
  claymoreTargets(c) {
    const C = UTIL_STATS.claymore;
    const out = [];
    for (const [pid, q] of this.game.players) {
      if (!q.alive || q.spawned === false || q.member.team === c.team) continue;
      const vx = q.state.x - c.pos[0], vy = q.state.y + 0.9 - c.pos[1], vz = q.state.z - c.pos[2];
      const flat = Math.hypot(vx, vz);
      if (flat > C.blastRange || Math.abs(vy) > 1.5) continue;
      if (flat > 0.3 && vx * c.dir[0] + vz * c.dir[2] < 0) continue;           // behind it: safe
      const dist = Math.hypot(vx, vy, vz);
      const wall = raycastWorld(this.world, c.pos, [vx / dist, vy / dist, vz / dist], dist);
      if (wall && wall.t < dist - 0.3) continue;
      out.push({ pid, dist });
    }
    return out;
  }

  checkClaymores(now) {
    const C = UTIL_STATS.claymore;
    for (const c of [...this.claymores.values()]) {
      if (now < c.armedAt) continue;
      const toucher = this.tripped(c);
      if (toucher === null) continue;
      const victims = this.claymoreTargets(c);
      if (!victims.some((v) => v.pid === toucher)) victims.push({ pid: toucher, dist: C.touch });   // whoever tripped it is always caught
      this.removeClaymore(c.id);
      this.game.emitAll('claymoreBlast', { id: c.id, pos: c.pos, dir: c.dir });
      // The blast kills outright: health and armour don't matter
      for (const { pid } of victims) this.game.applyDamage(pid, c.owner, Infinity, { weapon: 'claymore', from: [c.pos[0], c.pos[2]], lethal: true });
    }
  }

  removeClaymore(id) {
    if (!this.claymores.delete(id)) return false;
    this.broadcast('gadgetRemove', 'claymore', { id });
    return true;
  }

  /** Shot or hit by an enemy: the claymore is destroyed without going off. */
  destroyClaymore(id) {
    const c = this.claymores.get(id);
    if (!c || !this.removeClaymore(id)) return;
    this.game.emitAll('claymoreDestroyed', { id, pos: c.pos });
  }

  // ---------------------------------------------------------------- Stage 16 operator gadgets

  /** Cinder: fire patches burn enemies of the thrower standing in them. */
  updateFires(now) {
    const F = ABILITY_STATS.fire;
    for (const f of [...this.fires.values()]) {
      if (now >= f.until) { this.fires.delete(f.id); continue; }
      if (now < f.nextTick) continue;
      f.nextTick = now + F.tickMs;
      const ownerTeam = this.game.players.get(f.owner)?.member.team;
      for (const [pid, q] of this.game.players) {
        if (!q.alive || q.spawned === false || q.member.team === ownerTeam) continue;
        if (Math.hypot(q.state.x - f.pos[0], q.state.z - f.pos[2]) > F.radius || Math.abs(q.state.y - f.pos[1]) > 1.6) continue;
        this.game.applyDamage(pid, f.owner, F.tickDamage, { weapon: 'fire', from: [f.pos[0], f.pos[2]] });
      }
    }
  }

  /** Volt: a floor trap goes off once under the first enemy who steps on it. */
  updateShocks(now) {
    const S = ABILITY_STATS.shock;
    for (const t of [...this.shocks.values()]) {
      for (const [pid, q] of this.game.players) {
        if (!q.alive || q.spawned === false || q.member.team === t.team) continue;
        if (Math.hypot(q.state.x - t.pos[0], q.state.z - t.pos[2]) > S.touch || Math.abs(q.state.y - t.pos[1]) > 0.6) continue;
        this.shocks.delete(t.id);
        this.broadcast('gadgetRemove', 'shock', { id: t.id });
        this.game.emitAll('shockTriggered', { pos: t.pos });
        q.shockUntil = now + S.slowMs;
        q.spottedUntil = now + S.markMs;
        this.game.applyDamage(pid, t.owner, S.damage, { weapon: 'shock', from: [t.pos[0], t.pos[2]] });
        break;
      }
    }
  }

  /** Tonic: teammates inside a healing field regain health. */
  updateHeals(dt, now) {
    const H = ABILITY_STATS.heal;
    for (const f of [...this.heals.values()]) {
      if (now >= f.until) { this.heals.delete(f.id); this.broadcast('gadgetRemove', 'heal', { id: f.id }); continue; }
      for (const q of this.game.players.values()) {
        if (!q.alive || q.spawned === false || q.member.team !== f.team || q.health >= 100) continue;
        if (Math.hypot(q.state.x - f.pos[0], q.state.z - f.pos[2]) > H.radius || Math.abs(q.state.y - f.pos[1]) > 1.6) continue;
        q.health = Math.min(100, q.health + H.hps * dt);
      }
    }
  }

  /** Picket: an enemy touching a sensor's lines is marked for the team (and can be marked again after a pause). */
  checkSensors(now) {
    const S = ABILITY_STATS.sensor;
    for (const c of this.sensors.values()) {
      for (const pid of this.touching(c)) {
        if ((c.seen[pid] || 0) > now) continue;
        c.seen[pid] = now + S.cooldownMs;
        const q = this.game.players.get(pid);
        if (q) q.spottedUntil = now + S.markMs;
        this.game.io.to(c.owner).emit('actionError', { msg: 'Alarm sensor: enemy spotted!' });
      }
    }
  }

  /** The point an ability is aimed at (a surface within reach), or null. */
  aimPoint(p, reach) {
    return this.aimedSurface(p, reach);
  }

  // ---------------------------------------------------------------- barricades (B)

  barricadeRecord(b) {
    // Only the opening and which planks still stand: the planks' shape comes from shared/barricade.js
    return { kind: 'barricade', id: b.id, openingId: b.openingId, planks: b.planks.filter((p) => p.alive).map((p) => p.i) };
  }

  barricadeAt(openingId) {
    return [...this.barricades.values()].find((b) => b.openingId === openingId);
  }

  /** Anyone standing in (or right next to) the gap would be trapped inside the planks. */
  openingBlocked(o) {
    for (const q of this.game.players.values()) {
      if (!q.alive || q.spawned === false) continue;
      const across = Math.abs((o.axis === 'x' ? q.state.z : q.state.x) - o.fixed);
      const along = o.axis === 'x' ? q.state.x : q.state.z;
      if (across < 0.75 && along > o.from - 0.35 && along < o.to + 0.35 && q.state.y + 1.8 > o.y0 && q.state.y < o.y1) return true;
    }
    return false;
  }

  /** B: a defender starts nailing planks over the doorway or window they're aiming at. */
  startBarricade(id, p) {
    if (!p.alive || p.member.team !== 'defense') return this.error(id, 'Only defenders can barricade.');
    if (this.game.rounds.phase !== PHASE.PREP) return this.error(id, 'Barricades can only be built during the prep phase.');
    if (this.barricading.has(id)) return;
    if (this.barricadesLeft <= 0) return this.error(id, 'Your team has no barricades left.');
    const eye = getEyePosition(p.state, this.world);
    const o = findOpening(this.game.map, [eye.x, eye.y, eye.z], aimDirection(p.state.yaw, p.state.pitch), BARRICADE.reach);
    if (!o) return this.error(id, 'Aim at a doorway or window within 2.5 m.');
    if (this.armorAt(o.id)) return this.error(id, 'That opening has an armour panel.');
    if (this.barricadeAt(o.id) || [...this.barricading.values()].some((b) => b.openingId === o.id)) return this.error(id, 'That opening is already barricaded.');
    if (this.openingBlocked(o)) return this.error(id, 'Someone is standing in the way.');
    this.barricading.set(id, { openingId: o.id, doneAt: Date.now() + BARRICADE.channelMs, x: p.state.x, z: p.state.z });
    this.game.io.to(id).emit('barricadeStart', { ms: BARRICADE.channelMs });
  }

  cancelBarricade(id, reason) {
    if (this.barricading.delete(id)) this.game.io.to(id).emit('reinforceCancel', { reason });
  }

  updateBarricading(now) {
    for (const [id, b] of this.barricading) {
      const p = this.game.players.get(id);
      if (!p || !p.alive || this.game.rounds.phase !== PHASE.PREP) { this.barricading.delete(id); continue; }
      if (Math.hypot(p.state.x - b.x, p.state.z - b.z) > 0.8) { this.cancelBarricade(id, 'You moved away.'); continue; }
      if (now < b.doneAt) continue;
      this.barricading.delete(id);
      const o = this.game.map.openings[b.openingId];
      if (this.openingBlocked(o)) { this.game.io.to(id).emit('reinforceCancel', { reason: 'Someone is standing in the way.' }); continue; }
      this.placeBarricade(o, id);
    }
  }

  /** Nail a barricade over an opening. `free` ones (the windows at round start) cost no one anything and aren't announced one by one. */
  placeBarricade(o, ownerId, { free = false } = {}) {
    const bid = this.nextId++;
    const planks = barricadePlanks(o).map((pl) => ({ ...pl, hp: BARRICADE.hp, alive: true }));
    this.world.addBoxes(planks.map((pl) => ({ id: `bar-${bid}-${pl.i}`, kind: 'barricade', barricadeId: bid, panelIndex: pl.i, min: pl.min, max: pl.max })));
    const b = { id: bid, openingId: o.id, planks, hits: 0 };
    this.barricades.set(bid, b);
    if (free) return b;
    this.barricadesLeft--;
    const builder = this.game.players.get(ownerId);
    if (builder) builder.stats.barricades++;
    this.game.emitAll('gadgetAdd', this.barricadeRecord(b));
    this.game.emitAll('barricadesLeft', { left: this.barricadesLeft });
    return b;
  }

  /** Every window and every door to the outside starts the round barricaded (inside doors don't). Called when the gadgets are reset for a new round. */
  placeStartBarricades() {
    for (const o of this.game.map.openings) if (o.window || o.exterior) this.placeBarricade(o, null, { free: true });
  }

  /** Remove planks (bullets, melee or a blast) and tell everyone. */
  breakPanels(bid, indices) {
    const b = this.barricades.get(bid);
    if (!b) return;
    const gone = [];
    for (const i of indices) {
      const plank = b.planks[i];
      if (!plank || !plank.alive) continue;
      plank.alive = false;
      gone.push(i);
    }
    if (!gone.length) return;
    this.world.removeBoxes(gone.map((i) => `bar-${bid}-${i}`));
    this.game.emitAll('barricadeBroken', { id: bid, ids: gone });
    if (!b.planks.some((p) => p.alive)) {
      this.barricades.delete(bid);
      this.game.emitAll('gadgetRemove', { kind: 'barricade', id: bid });
    }
  }

  /** A player swung through this opening on a rope: its barricade, if any, breaks completely. */
  breakOpeningBarricade(openingId) {
    const b = this.barricadeAt(openingId);
    if (b) this.breakPanels(b.id, b.planks.map((p) => p.i));
  }

  /**
   * A melee hit on a barricade, at `point` (where the swing met its plane). The first two hits
   * knock out the grid section at the aimed height (a third of the width, 2 planks tall), or, if it
   * is already gone, the nearest section that still has anything standing, so a hit is never wasted.
   * The third hit breaks all of it.
   */
  meleeBarricade(bid, point) {
    const b = this.barricades.get(bid);
    if (!b) return;
    b.hits++;
    if (b.hits >= BARRICADE.meleeHits) return this.breakPanels(bid, b.planks.map((p) => p.i));
    const o = this.game.map.openings[b.openingId];
    const aim = sectionAt(o, point);
    let best = null;
    for (let col = 0; col < BARRICADE_COLS; col++) {
      for (let plank = 0; plank <= BARRICADE.planks - 2; plank++) {
        const idx = sectionSegments(col, plank).filter((i) => b.planks[i].alive);
        if (!idx.length) continue;
        // Distance in sections: the aimed one is 0; sideways steps cost more than a plank up or down
        // and a pair that is already half gone is worse than a whole one, so holes stay 2 planks tall
        const d = Math.hypot((col - aim.col) * 2, (plank - aim.plank) * 0.5) + (2 - idx.length) * 1.5;
        if (!best || d < best.d) best = { d, idx };
      }
    }
    if (best) this.breakPanels(bid, best.idx);
  }

  damageBarricadePanel(bid, index, amount) {
    const plank = this.barricades.get(bid)?.planks[index];
    if (!plank || !plank.alive) return;
    plank.hp -= amount;
    if (plank.hp <= 0) this.breakPanels(bid, [index]);
  }

  /** A breach charge flattens every barricade it reaches, all at once. */
  blastBarricades(pos, radius) {
    for (const b of [...this.barricades.values()]) {
      const near = b.planks.some((p) => p.alive && Math.hypot(
        (p.min[0] + p.max[0]) / 2 - pos[0], (p.min[1] + p.max[1]) / 2 - pos[1], (p.min[2] + p.max[2]) / 2 - pos[2]) <= radius);
      if (near) this.breakPanels(b.id, b.planks.map((p) => p.i));
    }
  }

  // ---------------------------------------------------------------- Stage E gadgets

  /** Every defender electronic that EMPs, shock drones and bullets can destroy: [{ kind, id, pos }]. */
  electronics() {
    const out = [];
    for (const c of this.cameras.values()) out.push({ kind: 'camera', id: c.id, pos: c.pos });
    for (const j of this.jammers.values()) out.push({ kind: 'jammer', id: j.id, pos: j.pos });
    for (const t of this.shocks.values()) out.push({ kind: 'shock', id: t.id, pos: t.pos });
    for (const t of this.sensors.values()) out.push({ kind: 'sensor', id: t.id, pos: t.pos });
    for (const b of this.batteries.values()) out.push({ kind: 'battery', id: b.id, pos: b.pos });
    for (const d of this.interceptors.values()) out.push({ kind: 'interceptor', id: d.id, pos: d.pos });
    return out;
  }

  /** Small gadgets an attacker's bullet can hit and destroy (cameras and jammers have their own rules): [{ kind, id, pos }]. */
  shootable() {
    const out = [];
    for (const b of this.batteries.values()) out.push({ kind: 'battery', id: b.id, pos: b.pos });
    for (const d of this.interceptors.values()) out.push({ kind: 'interceptor', id: d.id, pos: d.pos });
    return out;
  }

  /** Destroy one gadget (an EMP, a shock drone's zap or a bullet): it goes with a burst of sparks. */
  destroyGadget(kind, id) {
    if (kind === 'camera') return this.destroyCamera(id);
    const map = { jammer: this.jammers, shock: this.shocks, sensor: this.sensors, battery: this.batteries, interceptor: this.interceptors }[kind];
    const rec = map?.get(id);
    if (!rec) return;
    map.delete(id);
    this.broadcast('gadgetRemove', kind, { id });
    this.game.emitAll('cameraDestroyed', { id, pos: rec.pos });   // the same sparks and pop as a camera
  }

  // ---- Interceptor: devices that shoot down thrown grenades

  /** An enemy grenade within reach of a device with catches left (and in its sight) is shot down. */
  intercept(g) {
    const I = ABILITY_STATS.intercept;
    const team = this.game.players.get(g.owner)?.member.team;
    for (const d of this.interceptors.values()) {
      if (d.team === team) continue;
      const v = [g.pos[0] - d.pos[0], g.pos[1] - d.pos[1], g.pos[2] - d.pos[2]];
      const dist = Math.hypot(...v);
      if (dist > I.radius) continue;
      if (dist > 0.15) {
        const wall = raycastWorld(this.world, d.pos, v.map((c) => c / dist), dist);
        if (wall && wall.t < dist - 0.1) continue;
      }
      this.grenades.delete(g.id);
      d.catches--;
      this.game.emitAll('intercepted', { id: g.id, device: d.id, from: d.pos, pos: g.pos.map(r2) });
      if (d.catches <= 0) {
        this.interceptors.delete(d.id);
        this.broadcast('gadgetRemove', 'interceptor', { id: d.id });
      }
      return true;
    }
    return false;
  }

  // ---- Current: shock wires

  batteryRecord(b) {
    return { kind: 'battery', id: b.id, owner: b.owner, team: b.team, pos: b.pos, dir: b.dir };
  }

  /** The battery electrifying this wall panel or armour panel, or null. */
  electrified({ panelId = null, armorId = null }) {
    for (const b of this.batteries.values()) {
      if (armorId !== null && b.armorId === armorId) return b;
      if (panelId !== null && b.sectionId !== null && this.world.panels[panelId]?.sectionId === b.sectionId) return b;
    }
    return null;
  }

  removeBattery(id) {
    if (this.batteries.delete(id)) this.broadcast('gadgetRemove', 'battery', { id });
  }

  /** Electrified walls destroy breach charges and pellets stuck to them and shock attackers touching them. */
  updateBatteries(now) {
    if (!this.batteries.size) return;
    const W = ABILITY_STATS.wire, D = this.game.destruction;
    for (const b of [...this.batteries.values()]) {
      if (b.panelId !== null && !this.world.alive[b.panelId]) this.removeBattery(b.id);   // its piece of wall was blown away
    }
    for (const c of [...D.charges.values()]) {
      const b = this.electrified(c);
      if (b) { D.removeCharge(c.id); this.game.emitAll('wireZap', { from: b.pos, pos: c.pos }); }
    }
    for (const v of [...this.volleys.values()]) {
      const b = this.electrified(v);
      if (b) { this.removeVolley(v.id); this.game.emitAll('wireZap', { from: b.pos, pos: v.pos }); }
    }
    for (const b of this.batteries.values()) {
      if (now < b.nextPulse) continue;
      b.nextPulse = now + W.pulseMs;
      for (const [pid, q] of this.game.players) {
        if (!q.alive || q.spawned === false || q.member.team === b.team) continue;
        if (distToBox(q.state, b.box) > W.touch) continue;
        this.game.applyDamage(pid, b.owner, W.damage, { weapon: 'shockWire', from: [b.pos[0], b.pos[2]] });
        this.game.emitAll('wireZap', { from: b.pos, pos: [r2(q.state.x), r2(q.state.y + 1), r2(q.state.z)] });
      }
    }
  }

  // ---- Rampart: armour panels

  armorAt(openingId) {
    return [...this.armors.values()].find((a) => a.openingId === openingId);
  }

  updateArmoring(now) {
    const phase = this.game.rounds.phase;
    for (const [id, a] of this.armoring) {
      const p = this.game.players.get(id);
      if (!p || !p.alive || (phase !== PHASE.PREP && phase !== PHASE.ACTION)) { this.armoring.delete(id); continue; }
      if (Math.hypot(p.state.x - a.x, p.state.z - a.z) > 0.8) { this.armoring.delete(id); this.game.io.to(id).emit('reinforceCancel', { reason: 'You moved away.' }); continue; }
      if (now < a.doneAt) continue;
      this.armoring.delete(id);
      const o = this.game.map.openings[a.openingId];
      if (this.openingBlocked(o)) { this.game.io.to(id).emit('reinforceCancel', { reason: 'Someone is standing in the way.' }); continue; }
      if (this.armorAt(o.id) || !(p.ability?.charges > 0)) { this.game.io.to(id).emit('reinforceCancel', { reason: '' }); continue; }
      this.placeArmor(o, id);
      p.ability.charges--;
      p.stats.barricades++;
      this.game.sendLoadout(id, p);
    }
  }

  /** A bulletproof slab over the whole opening; a wooden barricade there is taken down first. */
  placeArmor(o, ownerId) {
    const old = this.barricadeAt(o.id);
    if (old) {
      this.barricades.delete(old.id);
      this.world.removeBoxes(old.planks.map((pl) => `bar-${old.id}-${pl.i}`));
      this.game.emitAll('gadgetRemove', { kind: 'barricade', id: old.id });
    }
    const aid = this.nextId++;
    const box = armorBox(o);
    this.world.addBox({ id: `armor-${aid}`, kind: 'armor', armorId: aid, openingId: o.id, min: box.min, max: box.max });
    const rec = { id: aid, openingId: o.id, owner: ownerId, hits: 0, hammer: 0, box };
    this.armors.set(aid, rec);
    this.broadcast('gadgetAdd', 'armor', { id: aid, openingId: o.id });
    return rec;
  }

  /** A melee hit or a hammer swing. An electrified panel shocks the attacker who hits it. */
  hitArmor(aid, how, attackerId) {
    const a = this.armors.get(aid);
    if (!a) return;
    const A = ABILITY_STATS.armor, H = ABILITY_STATS.hammer;
    if (how === 'hammer') a.hammer++; else a.hits++;
    const left = Math.max(0, 1 - Math.max(a.hits / A.meleeHits, a.hammer / H.panelHits));
    const centre = a.box.min.map((v, i) => r2((v + a.box.max[i]) / 2));
    const attacker = this.game.players.get(attackerId);
    const shock = this.electrified({ armorId: aid });
    if (shock && attacker && attacker.member.team !== shock.team) {
      this.game.applyDamage(attackerId, shock.owner, ABILITY_STATS.wire.damage, { weapon: 'shockWire', from: [shock.pos[0], shock.pos[2]] });
      this.game.emitAll('wireZap', { from: shock.pos, pos: [r2(attacker.state.x), r2(attacker.state.y + 1), r2(attacker.state.z)] });
    }
    if (left <= 0) return this.breakArmor(aid);
    this.game.emitAll('armorHit', { id: aid, pos: centre, left: r2(left) });
  }

  breakArmor(aid) {
    const a = this.armors.get(aid);
    if (!a) return;
    this.armors.delete(aid);
    this.world.removeBox(`armor-${aid}`);
    for (const b of [...this.batteries.values()]) if (b.armorId === aid) this.removeBattery(b.id);
    this.broadcast('gadgetRemove', 'armor', { id: aid });
    this.game.emitAll('armorBroken', { id: aid, pos: a.box.min.map((v, i) => r2((v + a.box.max[i]) / 2)) });
  }

  /** A breach charge breaks any armour panel it reaches. */
  blastArmors(pos, radius) {
    for (const a of [...this.armors.values()]) {
      const c = a.box.min.map((v, i) => (v + a.box.max[i]) / 2);
      if (Math.hypot(c[0] - pos[0], c[1] - pos[1], c[2] - pos[2]) <= radius + 0.9) this.breakArmor(a.id);
    }
  }

  // ---- Flint: pellet volleys

  removeVolley(vid) {
    const v = this.volleys.get(vid);
    if (!v) return null;
    this.volleys.delete(vid);
    const owner = this.game.players.get(v.owner);
    if (owner?.ability?.volley === vid) { owner.ability.volley = null; this.game.sendLoadout(v.owner, owner); }
    this.game.emitAll('pelletsRemoved', { id: vid });
    return v;
  }

  /** Set a volley off: whatever it stuck to gets a hole (one panel even through a reinforced wall). */
  detonateVolley(vid) {
    const v = this.volleys.get(vid);
    if (!v) return;
    if (this.isJammed(v.pos)) return this.error(v.owner, 'A signal jammer has disabled your pellets.');
    this.removeVolley(vid);
    const P = ABILITY_STATS.pellets, W = this.world;
    if (v.armorId !== null) this.breakArmor(v.armorId);
    else if (v.barricadeId !== null) { const b = this.barricades.get(v.barricadeId); if (b) this.breakPanels(b.id, b.planks.map((pl) => pl.i)); }
    else if (v.panelId !== null) {
      const wallId = W.panels[v.panelId].wallId;
      const ids = W.panelsNear(v.pos, P.panels).filter((pid) => W.panels[pid].wallId === wallId && !W.isReinforcedPanel(pid));
      if (W.alive[v.panelId]) ids.push(v.panelId);
      this.game.destruction.destroy([...new Set(ids)]);
    }
    const ownerTeam = this.game.players.get(v.owner)?.member.team;
    for (const [pid, q] of this.game.players) {
      if (!q.alive || q.spawned === false || (pid !== v.owner && q.member.team === ownerTeam)) continue;
      const d = Math.hypot(q.state.x - v.pos[0], q.state.y + 1 - v.pos[1], q.state.z - v.pos[2]);
      if (d < P.radius) this.game.applyDamage(pid, v.owner, P.damage * (1 - d / P.radius), { weapon: 'pellets', from: [v.pos[0], v.pos[2]] });
    }
    this.game.emitAll('pelletsBlast', { id: vid, pos: v.pos, normal: v.normal });
  }

  // ---------------------------------------------------------------- camera view (C)

  cycleCamera(id, p) {
    if (p.member.team !== 'defense' || !p.alive) return;
    const phase = this.game.rounds.phase;
    if (phase !== PHASE.PREP && phase !== PHASE.ACTION) return;
    const cams = [...this.cameras.values()];
    if (!cams.length) return this.error(id, 'No cameras placed.');
    const next = p.camView + 1 >= cams.length ? -1 : p.camView + 1;
    p.camView = next;
    p.camId = next >= 0 ? cams[next].id : null;
    this.game.io.to(id).emit('camView', { index: next, cam: next >= 0 ? cams[next] : null, count: cams.length });
  }

  exitCamera(id, p) {
    if (p.camView < 0) return;
    p.camView = -1;
    p.camId = null;
    this.game.io.to(id).emit('camView', { index: -1, cam: null, count: this.cameras.size });
  }

  /** An attacker's bullet hit a jammer: sparks, and the second hit destroys it. */
  hitJammer(id) {
    const j = this.jammers.get(id);
    if (!j) return;
    j.hits = (j.hits || 0) + 1;
    const destroyed = j.hits >= JAMMER_HITS;
    if (destroyed) {
      this.jammers.delete(id);
      this.broadcast('gadgetRemove', 'jammer', { id });
    }
    this.game.emitAll('jammerHit', { id, pos: j.pos, destroyed });
  }

  /** One shot from an attacker destroys a camera; anyone watching it is thrown back to their body. */
  destroyCamera(id) {
    const cam = this.cameras.get(id);
    if (!cam) return;
    this.cameras.delete(id);
    this.broadcast('gadgetRemove', 'camera', { id });
    this.game.emitAll('cameraDestroyed', { id, pos: cam.pos });
    const cams = [...this.cameras.values()];
    for (const [pid, q] of this.game.players) {
      if (q.camView < 0) continue;
      if (q.camId === id) { this.exitCamera(pid, q); continue; }
      // Another feed: its position in the list may have shifted
      q.camView = cams.findIndex((c) => c.id === q.camId);
      this.game.io.to(pid).emit('camView', { index: q.camView, cam: cams[q.camView] || null, count: cams.length });
    }
  }
}

// ------------------------------------------------------------------ ability handlers

const cooldownLeft = (p, now) => Math.max(0, (p.ability?.cdUntil || 0) - now);

const ABILITIES = {
  /** Spark: plant, then detonate, a charge that also breaks reinforced walls. */
  heavyBreach(g, id, p) {
    g.game.destruction.useBreach(id, p, 'heavy');
  },

  /** Hawk: ping what's under the crosshair, exactly like a drone pilot's click. */
  sonarPing(g, id, p, ab) {
    const now = Date.now();
    if (cooldownLeft(p, now) > 0) return g.error(id, 'Sonar is recharging.');
    const eye = getEyePosition(p.state, g.world);
    const hit = g.game.pingFrom(p, [eye.x, eye.y, eye.z], aimDirection(p.state.yaw, p.state.pitch), now);
    p.ability.cdUntil = now + (hit ? ab.cooldown * 1000 : HAWK_MISS_COOLDOWN_MS);
    g.game.io.to(id).emit('pingResult', { hit });
  },

  /** Bulwark: deploy a bulletproof shield, or pick it up again. */
  shield(g, id, p) {
    const existing = p.ability.shieldId ? g.shields.get(p.ability.shieldId) : null;
    if (existing) {
      const cx = (existing.min[0] + existing.max[0]) / 2, cz = (existing.min[2] + existing.max[2]) / 2;
      if (Math.hypot(p.state.x - cx, p.state.z - cz) > 3.3) return g.error(id, 'Get closer to pick up your shield.');
      g.shields.delete(existing.id);
      g.world.removeBox(`shield-${existing.id}`);
      g.broadcast('gadgetRemove', 'shield', { id: existing.id });
      p.ability.shieldId = null;
      p.ability.charges++;
      return;
    }
    if (p.ability.charges <= 0) return g.error(id, 'No shield to deploy.');

    const [fx, fz] = forwardVec(p.state.yaw);
    const cx = p.state.x + fx * SHIELD.distance, cz = p.state.z + fz * SHIELD.distance;
    const alongX = Math.abs(fx) < Math.abs(fz);          // facing mostly along z: shield is wide in x
    const hx = alongX ? SHIELD.width / 2 : SHIELD.thickness / 2, hz = alongX ? SHIELD.thickness / 2 : SHIELD.width / 2;
    const min = [cx - hx, p.state.y, cz - hz], max = [cx + hx, p.state.y + SHIELD.height, cz + hz];
    const overlaps = (a, b) => a.min[0] < b.max[0] - 1e-3 && a.max[0] > b.min[0] + 1e-3
      && a.min[1] < b.max[1] - 1e-3 && a.max[1] > b.min[1] + 1e-3 && a.min[2] < b.max[2] - 1e-3 && a.max[2] > b.min[2] + 1e-3;
    const box = { min: [min[0], min[1] + 0.05, min[2]], max };
    if (g.world.boxes.some((b) => b.kind !== 'ground' && b.kind !== 'floor' && overlaps(box, b))) {
      return g.error(id, 'Not enough room for the shield here.');
    }
    for (const q of g.game.players.values()) {
      if (!q.alive || q.spawned === false) continue;
      const nx = Math.max(min[0], Math.min(q.state.x, max[0])), nz = Math.max(min[2], Math.min(q.state.z, max[2]));
      if (Math.hypot(q.state.x - nx, q.state.z - nz) < 0.45 && Math.abs(q.state.y - p.state.y) < 1.5) {
        return g.error(id, 'Someone is in the way.');
      }
    }
    const sid = g.nextId++;
    const rec = { id: sid, owner: id, min, max };
    g.shields.set(sid, rec);
    g.world.addBox({ id: `shield-${sid}`, kind: 'shield', min, max });
    g.broadcast('gadgetAdd', 'shield', rec);
    p.ability.charges--;
    p.ability.shieldId = sid;
  },

  /** Flash: throw a stun grenade. */
  stun(g, id, p) {
    const now = Date.now();
    if (p.ability.charges <= 0) return g.error(id, 'No stun grenades left.');
    if (cooldownLeft(p, now) > 0) return;
    p.ability.charges--;
    p.ability.cdUntil = now + STUN.cooldown * 1000;
    g.throwGrenade(p, id);
  },

  /** Warden: lay barbed wire where you're aiming on the floor. */
  barbedWire(g, id, p) {
    if (p.ability.charges <= 0) return g.error(id, 'No barbed wire left.');
    const aim = g.aimedSurface(p, WIRE.reach);
    if (!aim || aim.hit.normal[1] < 0.7) return g.error(id, 'Aim at the floor within 3.5 m.');
    const [x, y, z] = aim.hit.point;
    const rec = { id: g.nextId++, owner: id, team: p.member.team, x, y, z, half: WIRE.size / 2 };
    g.wires.set(rec.id, rec);
    g.broadcast('gadgetAdd', 'wire', rec);
    p.ability.charges--;
  },

  /** Jammer: a device that disables drones and breach charges within 5 m. */
  jammerDevice(g, id, p) {
    if (p.ability.charges <= 0) return g.error(id, 'Your jammer is already deployed.');
    const aim = g.aimedSurface(p, GADGET_REACH);
    if (!aim) return g.error(id, 'Aim at a surface within 3.5 m.');
    const { point, normal } = aim.hit;
    const rec = { id: g.nextId++, owner: id, pos: [point[0] + normal[0] * 0.12, point[1] + normal[1] * 0.12, point[2] + normal[2] * 0.12] };
    g.jammers.set(rec.id, rec);
    g.broadcast('gadgetAdd', 'jammer', rec);
    p.ability.charges--;
  },

  /** Lookout: a hidden camera, visible only to defenders. */
  camera(g, id, p) {
    if (p.ability.charges <= 0) return g.error(id, 'No cameras left.');
    const aim = g.aimedSurface(p, CAMERA_REACH);
    if (!aim) return g.error(id, 'Aim at a wall or ceiling within 4.5 m.');
    const { point, normal } = aim.hit;
    const rec = { id: g.nextId++, owner: id, pos: point.map((v, i) => v + normal[i] * 0.07), dir: normal };
    g.cameras.set(rec.id, rec);
    g.broadcast('gadgetAdd', 'camera', rec);
    p.ability.charges--;
  },

  /** Tremor: mark every moving enemy nearby, through walls. */
  seismicPulse(g, id, p, ab) {
    const S = ABILITY_STATS.seismic, now = Date.now();
    if (p.ability.charges <= 0) return g.error(id, 'No seismic pulses left.');
    const eye = getEyePosition(p.state, g.world);
    const found = [];
    for (const q of g.game.players.values()) {
      if (!q.alive || q.spawned === false || q.member.team === p.member.team) continue;
      if (Math.hypot(q.state.x - eye.x, q.state.y - eye.y, q.state.z - eye.z) > S.radius) continue;
      if (Math.hypot(q.state.vx, q.state.vz) < S.moving) continue;
      found.push(q);
    }
    if (!found.length) return g.error(id, 'No movement within 12 m.');
    for (const q of found) q.spottedUntil = now + S.markMs;
    p.ability.charges--;
    g.game.emitAll('seismicPulse', { pos: [eye.x, p.state.y + 0.1, eye.z], radius: S.radius });
  },

  /** Cinder: throw a fire canister. */
  fireCanister(g, id, p) {
    const now = Date.now();
    if (p.ability.charges <= 0) return g.error(id, 'No fire canisters left.');
    if (cooldownLeft(p, now) > 0) return;
    p.ability.charges--;
    p.ability.cdUntil = now + 800;
    g.throwGrenade(p, id, 'fire');
  },

  /** Surge: destroy defender cameras and jammers around the aimed point. */
  emp(g, id, p) {
    const E = ABILITY_STATS.emp;
    if (p.ability.charges <= 0) return g.error(id, 'No EMP bursts left.');
    const eye = getEyePosition(p.state, g.world);
    const dir = aimDirection(p.state.yaw, p.state.pitch);
    const hit = raycastWorld(g.world, [eye.x, eye.y, eye.z], dir, E.range);
    const t = hit ? hit.t : 10;
    const centre = [eye.x + dir[0] * t, eye.y + dir[1] * t, eye.z + dir[2] * t];
    const near = (pos) => Math.hypot(pos[0] - centre[0], pos[1] - centre[1], pos[2] - centre[2]) <= E.radius;
    const cams = [...g.cameras.values()].filter((c) => near(c.pos));
    const jams = [...g.jammers.values()].filter((j) => near(j.pos));
    if (!cams.length && !jams.length) return g.error(id, 'No cameras or jammers near where you aim.');
    for (const c of cams) g.destroyCamera(c.id);
    for (const j of jams) {
      g.jammers.delete(j.id);
      g.broadcast('gadgetRemove', 'jammer', { id: j.id });
      g.game.emitAll('cameraDestroyed', { id: j.id, pos: j.pos });
    }
    p.ability.charges--;
    g.game.emitAll('empBurst', { pos: centre.map((v) => Math.round(v * 100) / 100) });
  },

  /** Volt: a shock trap on the floor. */
  shockTrap(g, id, p) {
    if (p.ability.charges <= 0) return g.error(id, 'No shock traps left.');
    const aim = g.aimedSurface(p, ABILITY_STATS.shock.reach);
    if (!aim || aim.hit.normal[1] < 0.7) return g.error(id, 'Aim at the floor within 3.5 m.');
    const rec = { id: g.nextId++, owner: id, team: p.member.team, pos: aim.hit.point.map((v) => Math.round(v * 100) / 100) };
    g.shocks.set(rec.id, rec);
    g.broadcast('gadgetAdd', 'shock', { id: rec.id, owner: id, team: rec.team, pos: rec.pos });
    p.ability.charges--;
  },

  /** Tonic: a healing field on the floor. */
  healField(g, id, p) {
    if (p.ability.charges <= 0) return g.error(id, 'No healing fields left.');
    const aim = g.aimedSurface(p, ABILITY_STATS.heal.reach);
    if (!aim || aim.hit.normal[1] < 0.7) return g.error(id, 'Aim at the floor within 3.5 m.');
    const H = ABILITY_STATS.heal;
    const rec = { id: g.nextId++, owner: id, team: p.member.team, pos: aim.hit.point.map((v) => Math.round(v * 100) / 100), until: Date.now() + H.durationMs };
    g.heals.set(rec.id, rec);
    g.broadcast('gadgetAdd', 'heal', { id: rec.id, owner: id, team: rec.team, pos: rec.pos, ms: H.durationMs });
    p.ability.charges--;
  },

  /** Picket: an alarm sensor on a floor or wall. */
  alarmSensor(g, id, p) {
    if (p.ability.charges <= 0) return g.error(id, 'No alarm sensors left.');
    const aim = g.aimedSurface(p, ABILITY_STATS.sensor.reach);
    if (!aim || aim.hit.normal[1] < -0.5) return g.error(id, 'Aim at a floor or wall within 3 m.');
    const { point, normal } = aim.hit;
    let dir;
    if (normal[1] > 0.5) { const [fx, fz] = forwardVec(p.state.yaw); dir = [fx, 0, fz]; }
    else { const len = Math.hypot(normal[0], normal[2]) || 1; dir = [normal[0] / len, 0, normal[2] / len]; }
    const rec = {
      id: g.nextId++, owner: id, team: p.member.team, seen: {},
      pos: point.map((v, i) => Math.round((v + normal[i] * 0.06) * 100) / 100), dir: dir.map((v) => Math.round(v * 100) / 100),
    };
    g.sensors.set(rec.id, rec);
    g.broadcast('gadgetAdd', 'sensor', { id: rec.id, owner: id, team: rec.team, pos: rec.pos, dir: rec.dir });
    p.ability.charges--;
  },

  /** Mason: reinforce a wall from his own stock of two. */
  masonReinforce(g, id, p) {
    g.game.destruction.startReinforce(id, p, true);
  },

  // ---------------------------------------------------------------- Stage E

  /** Blackout (Thatcher): an EMP grenade that reaches through walls. */
  empGrenade(g, id, p) {
    const now = Date.now();
    if (p.ability.charges <= 0) return g.error(id, 'No EMP grenades left.');
    if (cooldownLeft(p, now) > 0) return;
    p.ability.charges--;
    p.ability.cdUntil = now + 800;
    g.throwGrenade(p, id, 'emp');
  },

  /** Wasp (Twitch): the taser on the drone she is driving. */
  shockDrone(g, id, p) {
    const Z = ABILITY_STATS.zap, now = Date.now();
    if (g.game.rounds.phase !== PHASE.PREP) return g.error(id, 'Your shock drones work while you drive them in prep.');
    const drone = g.game.activeDroneOf(p);
    if (!drone) return g.error(id, 'Drive one of your drones to zap.');
    if (drone.jammed) return g.error(id, 'Jammed: the taser won\'t fire.');
    if (!(drone.zaps > 0)) return g.error(id, 'This drone\'s taser is empty.');
    if (now < (drone.zapReady || 0)) return;
    drone.zapReady = now + Z.cooldownMs;
    drone.zaps--;
    p.ability.charges = Math.max(0, p.ability.charges - 1);
    const e = droneEye(drone.state), eye = [e[0], e[1], e[2]];
    const dir = aimDirection(drone.state.yaw, drone.state.pitch);
    const wall = raycastWorld(g.world, eye, dir, Z.range);
    let maxT = wall ? wall.t : Z.range, gadget = null, victim = null;
    const q = 0.25;   // a little forgiving: the taser arcs to what is near the crosshair
    for (const el of g.electronics()) {
      const h = rayBox(eye, dir, el.pos.map((v) => v - q), el.pos.map((v) => v + q), maxT);
      if (h) { gadget = el; maxT = h.t; }
    }
    for (const c of g.claymores.values()) {
      if (c.team === p.member.team) continue;
      const h = rayBox(eye, dir, c.pos.map((v) => v - q), c.pos.map((v) => v + q), maxT);
      if (h) { gadget = { kind: 'claymore', id: c.id }; maxT = h.t; }
    }
    for (const [qid, d] of g.game.players) {
      if (!d.alive || d.spawned === false || d.member.team === p.member.team) continue;
      const h = rayPlayer(eye, dir, d.state, maxT);
      if (h) { victim = qid; gadget = null; maxT = h.t; }
    }
    if (victim) g.game.applyDamage(victim, id, Z.damage, { weapon: 'zap', from: [eye[0], eye[2]] });
    else if (gadget?.kind === 'claymore') g.destroyClaymore(gadget.id);
    else if (gadget) g.destroyGadget(gadget.kind, gadget.id);
    g.game.emitAll('zap', { from: eye.map(r2), to: eye.map((v, i) => r2(v + dir[i] * maxT)), hit: !!(victim || gadget) });
  },

  /** Flint (Hibana): fire a volley of sticky pellets, or set off the one that has stuck. */
  pellets(g, id, p) {
    const P = ABILITY_STATS.pellets;
    if (p.ability.volley && g.volleys.has(p.ability.volley)) return g.detonateVolley(p.ability.volley);
    if (g.game.rounds.phase !== PHASE.ACTION) return g.error(id, 'The pellet launcher works once the action phase starts.');
    if (p.ability.charges <= 0) return g.error(id, 'No pellet volleys left.');
    const aim = g.aimedSurface(p, P.range);
    const box = aim?.hit.box;
    const target = box?.kind === 'panel' ? { panelId: box.id } : box?.kind === 'barricade' ? { barricadeId: box.barricadeId } : box?.kind === 'armor' ? { armorId: box.armorId } : null;
    if (!target) return g.error(id, 'Aim at a wall, hatch, barricade or armour panel within 20 m.');
    const { point, normal } = aim.hit;
    if (g.isJammed(point)) return g.error(id, 'A signal jammer blocks the pellets here.');
    const v = { id: g.nextId++, owner: id, pos: point.map((c, i) => r2(c + normal[i] * 0.03)), normal, panelId: null, barricadeId: null, armorId: null, ...target };
    if (g.electrified(v)) {
      p.ability.charges--;
      g.game.emitAll('wireZap', { from: g.electrified(v).pos, pos: v.pos });
      return g.error(id, 'The wall is electrified: your pellets were fried.');
    }
    g.volleys.set(v.id, v);
    p.ability.charges--;
    p.ability.volley = v.id;
    g.game.emitAll('pelletsStuck', { id: v.id, owner: id, from: aim.origin.map(r2), pos: v.pos, normal: normal.map(r2) });
  },

  /** Ram (Sledge): one swing of the breaching hammer. */
  hammer(g, id, p, ab) {
    const now = Date.now(), H = ABILITY_STATS.hammer, W = g.world;
    if (cooldownLeft(p, now) > 0) return;
    if (p.ability.charges <= 0) return g.error(id, 'The hammer is worn out.');
    if (!g.game.canBreakWalls(p)) return g.error(id, 'The hammer works once the action phase starts.');
    p.ability.cdUntil = now + ab.cooldown * 1000;
    const aim = g.aimedSurface(p, H.reach);
    const hit = aim?.hit;
    g.game.emitAll('hammer', { id, pos: hit ? hit.point.map(r2) : null });
    if (!hit) return;
    const box = hit.box;
    if (box.kind === 'barricade') {
      const b = g.barricades.get(box.barricadeId);
      if (b) g.breakPanels(b.id, b.planks.map((pl) => pl.i));
    } else if (box.kind === 'armor') {
      g.hitArmor(box.armorId, 'hammer', id);
    } else if (box.kind === 'panel') {
      if (W.isReinforcedPanel(box.id)) return g.error(id, 'Reinforced: the hammer bounces off.');
      const panel = W.panels[box.id];
      const ids = panel.hatch ? [box.id] : W.panelsNear(hit.point, H.panels).filter((pid) => W.panels[pid].wallId === panel.wallId && !W.isReinforcedPanel(pid));
      if (!ids.includes(box.id)) ids.push(box.id);
      g.game.destruction.destroy(ids);
    } else return;
    p.ability.charges--;
  },

  /** Aegis (Blackbeard): a shield charge that smashes through soft walls and barricades in the way. */
  shieldDash(g, id, p, ab) {
    const now = Date.now(), D = ABILITY_STATS.dash, s = p.state, W = g.world;
    if (p.ability.charges <= 0) return g.error(id, 'No shield charges left.');
    if (cooldownLeft(p, now) > 0) return g.error(id, 'Your shield charge is recharging.');
    if (!WEAPONS[p.weapon.id]?.shield) return g.error(id, 'Raise your shield first.');
    if (!s.onGround || s.rap || s.vaultT > 0 || (s.prone || 0) > 0.3) return g.error(id, 'Get your feet on the ground first.');
    const [fx, fz] = forwardVec(s.yaw);
    const len = D.time * DASH_SPEED + D.reach * 0.5;
    let breached = false;
    if (g.game.canBreakWalls(p)) {
      for (const hgt of [0.5, 1.1, 1.6]) {
        const hit = raycastWorld(W, [s.x, s.y + hgt, s.z], [fx, 0, fz], len);
        if (!hit) continue;
        if (hit.box.kind === 'barricade') {
          const b = g.barricades.get(hit.box.barricadeId);
          if (b) { g.breakPanels(b.id, b.planks.map((pl) => pl.i)); breached = true; }
        } else if (hit.box.kind === 'panel' && !W.panels[hit.box.id].hatch && !W.isReinforcedPanel(hit.box.id)) {
          const wallId = W.panels[hit.box.id].wallId;
          const ids = W.panelsNear(hit.point, D.panels).filter((pid) => W.panels[pid].wallId === wallId && !W.isReinforcedPanel(pid));
          if (ids.length) { g.game.destruction.destroy(ids); breached = true; }
        }
      }
    }
    p.ability.charges--;
    p.ability.cdUntil = now + ab.cooldown * 1000;
    s.dash = D.time; s.dashX = fx; s.dashZ = fz;
    g.game.emitAll('shieldDash', { id, pos: [r2(s.x), r2(s.y + 1), r2(s.z)], breached });
    if (breached) {
      // Smashing through leaves you dazed: slowed, with a blurred view
      p.stunUntil = Math.max(p.stunUntil || 0, now + D.dazeMs);
      g.game.io.to(id).emit('dazed', { ms: D.dazeMs });
    }
  },

  /** Current (Bandit): a battery that electrifies a reinforced wall, a hatch or an armour panel. */
  shockWire(g, id, p) {
    const Wd = ABILITY_STATS.wire, W = g.world;
    if (p.ability.charges <= 0) return g.error(id, 'No shock wires left.');
    const aim = g.aimedSurface(p, Wd.reach);
    if (!aim) return g.error(id, 'Aim at a reinforced wall, a hatch or an armour panel within 2.5 m.');
    const { point, normal, box } = aim.hit;
    let target = null;
    if (box.kind === 'armor' && g.armors.has(box.armorId)) target = { armorId: box.armorId, sectionId: null, panelId: null, box: g.armors.get(box.armorId).box };
    else if (box.kind === 'panel' && (W.panels[box.id].hatch || W.isReinforcedPanel(box.id))) {
      const sec = W.sections[W.panels[box.id].sectionId];
      target = { armorId: null, sectionId: sec.id, panelId: box.id, box: { min: sec.min, max: sec.max } };
    }
    if (!target) return g.error(id, 'Shock wires go on reinforced walls, hatches and armour panels.');
    for (const b of g.batteries.values()) {
      if ((target.armorId !== null && b.armorId === target.armorId) || (target.sectionId !== null && b.sectionId === target.sectionId)) return g.error(id, 'That wall is already electrified.');
    }
    const rec = { id: g.nextId++, owner: id, team: p.member.team, pos: point.map((v, i) => r2(v + normal[i] * 0.07)), dir: normal.map(r2), nextPulse: 0, ...target };
    g.batteries.set(rec.id, rec);
    g.broadcast('gadgetAdd', 'battery', g.batteryRecord(rec));
    p.ability.charges--;
  },

  /** Rampart (Castle): start fitting an armour panel over the opening in front. */
  armorPanel(g, id, p) {
    const A = ABILITY_STATS.armor;
    if (p.ability.charges <= 0) return g.error(id, 'No armour panels left.');
    if (g.armoring.has(id)) return;
    const eye = getEyePosition(p.state, g.world);
    const o = findOpening(g.game.map, [eye.x, eye.y, eye.z], aimDirection(p.state.yaw, p.state.pitch), A.reach);
    if (!o) return g.error(id, 'Aim at a doorway or window within 2.5 m.');
    if (g.armorAt(o.id) || [...g.armoring.values()].some((a) => a.openingId === o.id)) return g.error(id, 'That opening already has an armour panel.');
    if (g.openingBlocked(o)) return g.error(id, 'Someone is standing in the way.');
    g.armoring.set(id, { openingId: o.id, doneAt: Date.now() + A.channelMs, x: p.state.x, z: p.state.z });
    g.game.io.to(id).emit('barricadeStart', { ms: A.channelMs, label: 'Fitting armour panel…' });
  },

  /** Medic (Doc): a stim dart for the teammate under the crosshair, or for yourself. */
  stimPistol(g, id, p) {
    const S = ABILITY_STATS.stim;
    if (p.ability.charges <= 0) return g.error(id, 'No stim darts left.');
    const e = getEyePosition(p.state, g.world), eye = [e.x, e.y, e.z];
    const dir = aimDirection(p.state.yaw, p.state.pitch);
    const wall = raycastWorld(g.world, eye, dir, S.range);
    let maxT = wall ? wall.t : S.range, target = null;
    for (const [qid, q] of g.game.players) {
      if (qid === id || !q.alive || q.spawned === false || q.member.team !== p.member.team) continue;
      const h = rayPlayer(eye, dir, q.state, maxT);
      if (h) { target = qid; maxT = h.t; }
    }
    const whoId = target ?? id, who = g.game.players.get(whoId);
    if (who.health >= S.max) return g.error(id, target ? 'They are already fully stimmed.' : 'You are already fully stimmed.');
    who.health = Math.min(S.max, who.health + S.heal);
    p.ability.charges--;
    g.game.emitAll('stim', { by: id, id: whoId, from: eye.map(r2), to: target ? eye.map((v, i) => r2(v + dir[i] * maxT)) : null });
    g.game.io.to(whoId).emit('healed', { health: Math.round(who.health) });
  },

  /** Interceptor (Jäger): a device that shoots down thrown grenades. */
  interceptor(g, id, p) {
    const I = ABILITY_STATS.intercept;
    if (p.ability.charges <= 0) return g.error(id, 'No interceptors left.');
    const aim = g.aimedSurface(p, I.reach);
    if (!aim || aim.hit.normal[1] < -0.5) return g.error(id, 'Aim at a wall or floor within 2.5 m.');
    const { point, normal } = aim.hit;
    const rec = { id: g.nextId++, owner: id, team: p.member.team, pos: point.map((v, i) => r2(v + normal[i] * 0.08)), dir: normal.map(r2), catches: I.catches };
    g.interceptors.set(rec.id, rec);
    g.broadcast('gadgetAdd', 'interceptor', { id: rec.id, owner: id, team: rec.team, pos: rec.pos, dir: rec.dir, catches: rec.catches });
    p.ability.charges--;
  },
};
