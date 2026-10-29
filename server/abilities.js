// Operator abilities (the F key) and the gadgets they create.
//
// Each ability is a handler under ABILITIES, keyed by `ability.id` in
// shared/operators.js. A handler gets (gadgets, socketId, player, abilityConfig).
// Gadgets that other players can see (shields, wire, jammers, cameras) live in
// the Gadgets class below and are synced with `gadgetAdd` / `gadgetRemove` events.

import {
  PHASE, SHIELD, WIRE, JAMMER_RANGE, CAMERA_REACH, STUN, GADGET_REACH, HAWK_MISS_COOLDOWN_MS, BARRICADE,
} from '../shared/constants.js';
import { MAP, findOpening } from '../shared/map.js';
import { OPERATORS } from '../shared/operators.js';
import { getEyePosition, forwardVec, eyeHeight } from '../shared/movement.js';
import { aimDirection } from '../shared/weapons.js';
import { raycastWorld } from '../shared/raycast.js';
import { UTILITIES, UTIL_STATS } from '../shared/utilities.js';

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
    this.barricades = new Map();       // id -> { id, openingId, panels: [{ i, min, max, hp, alive }] }
    this.barricading = new Map();      // playerId -> { openingId, doneAt, x, z }
    this.barricadesLeft = BARRICADE.pool;
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
    for (const b of this.barricades.values()) out.push(this.barricadeRecord(b));
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
    if (p.spawned === false) return this.error(id, 'Your operator is not on the field yet.');
    if (p.camView >= 0) return;
    ABILITIES[ab.id]?.(this, id, p, ab);
    this.game.sendLoadout(id, p);
  }

  // ---------------------------------------------------------------- per-tick

  update(dt, now) {
    this.stepGrenades(dt, now);
    this.checkClaymores(now);
    this.updateBarricading(now);
    for (const p of this.game.players.values()) {
      let slow = 1;
      if (p.stunUntil > now) slow = Math.min(slow, STUN.slow);
      if (p.alive) {
        for (const w of this.wires.values()) {
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
    const cfg = type === 'stun' ? STUN : UTIL_STATS[type];
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
    if (g.type === 'smoke') {
      const ms = UTIL_STATS.smoke.duration * 1000;
      this.game.emitAll('smokeStart', { id: g.id, pos, ms, radius: UTIL_STATS.smoke.radius });
      return;
    }
    if (g.type === 'stun') {
      for (const { pid, q } of this.enemiesNear(g, STUN.radius)) {
        q.stunUntil = now + STUN.duration * 1000;
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
        this.game.io.to(pid).emit('stunned', { ms: F.duration * 1000 * (facing > 0 ? 1 : F.awayScale) });
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

  /** Enemies standing in a claymore's cone with a clear line to it. */
  claymoreTargets(c, range) {
    const C = UTIL_STATS.claymore;
    const out = [];
    for (const [pid, q] of this.game.players) {
      if (!q.alive || q.spawned === false || q.member.team === c.team) continue;
      const centre = [q.state.x, q.state.y + 0.9, q.state.z];
      const vx = centre[0] - c.pos[0], vy = centre[1] - c.pos[1], vz = centre[2] - c.pos[2];
      const flat = Math.hypot(vx, vz);
      if (flat > range || Math.abs(vy) > 1.5) continue;
      if (flat > 0.3 && (vx * c.dir[0] + vz * c.dir[2]) / flat < C.halfAngleCos) continue;
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
      if (now < c.armedAt || !this.claymoreTargets(c, C.range).length) continue;
      const victims = this.claymoreTargets(c, C.range);
      this.claymores.delete(c.id);
      this.broadcast('gadgetRemove', 'claymore', { id: c.id });
      this.game.emitAll('claymoreBlast', { id: c.id, pos: c.pos, dir: c.dir });
      for (const { pid, dist } of victims) {
        const amount = C.damage * (1 - (1 - C.minDamage) * (dist / C.range));
        this.game.applyDamage(pid, c.owner, amount, { weapon: 'claymore', from: [c.pos[0], c.pos[2]] });
      }
    }
  }

  // ---------------------------------------------------------------- barricades (B)

  barricadeRecord(b) {
    return { kind: 'barricade', id: b.id, openingId: b.openingId, panels: b.panels.filter((p) => p.alive).map((p) => ({ i: p.i, min: p.min, max: p.max })) };
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
    const o = findOpening([eye.x, eye.y, eye.z], aimDirection(p.state.yaw, p.state.pitch), BARRICADE.reach);
    if (!o) return this.error(id, 'Aim at a doorway or window within 2.5 m.');
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
      const o = MAP.openings[b.openingId];
      if (this.openingBlocked(o)) { this.game.io.to(id).emit('reinforceCancel', { reason: 'Someone is standing in the way.' }); continue; }
      this.placeBarricade(o);
    }
  }

  placeBarricade(o) {
    const t = BARRICADE.thickness / 2;
    const cols = Math.max(1, Math.round((o.to - o.from) / BARRICADE.panel)), rows = Math.max(1, Math.round((o.y1 - o.y0) / BARRICADE.panel));
    const pw = (o.to - o.from) / cols, ph = (o.y1 - o.y0) / rows;
    const bid = this.nextId++;
    const panels = [];
    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < rows; r++) {
        const a0 = o.from + c * pw, y0 = o.y0 + r * ph;
        const min = o.axis === 'x' ? [a0, y0, o.fixed - t] : [o.fixed - t, y0, a0];
        const max = o.axis === 'x' ? [a0 + pw, y0 + ph, o.fixed + t] : [o.fixed + t, y0 + ph, a0 + pw];
        const panel = { i: panels.length, min, max, hp: BARRICADE.hp, alive: true };
        panels.push(panel);
        this.world.addBox({ id: `bar-${bid}-${panel.i}`, kind: 'barricade', barricadeId: bid, panelIndex: panel.i, min, max });
      }
    }
    const b = { id: bid, openingId: o.id, panels };
    this.barricades.set(bid, b);
    this.barricadesLeft--;
    this.game.emitAll('gadgetAdd', this.barricadeRecord(b));
    this.game.emitAll('barricadesLeft', { left: this.barricadesLeft });
  }

  /** Remove panels (bullets, melee or a blast) and tell everyone. */
  breakPanels(bid, indices) {
    const b = this.barricades.get(bid);
    if (!b) return;
    const gone = [];
    for (const i of indices) {
      const panel = b.panels[i];
      if (!panel || !panel.alive) continue;
      panel.alive = false;
      this.world.removeBox(`bar-${bid}-${i}`);
      gone.push(i);
    }
    if (!gone.length) return;
    this.game.emitAll('barricadeBroken', { id: bid, ids: gone });
    if (!b.panels.some((p) => p.alive)) {
      this.barricades.delete(bid);
      this.game.emitAll('gadgetRemove', { kind: 'barricade', id: bid });
    }
  }

  damageBarricadePanel(bid, index, amount) {
    const panel = this.barricades.get(bid)?.panels[index];
    if (!panel || !panel.alive) return;
    panel.hp -= amount;
    if (panel.hp <= 0) this.breakPanels(bid, [index]);
  }

  /** A breach charge flattens every barricade it reaches, all at once. */
  blastBarricades(pos, radius) {
    for (const b of [...this.barricades.values()]) {
      const near = b.panels.some((p) => p.alive && Math.hypot(
        (p.min[0] + p.max[0]) / 2 - pos[0], (p.min[1] + p.max[1]) / 2 - pos[1], (p.min[2] + p.max[2]) / 2 - pos[2]) <= radius);
      if (near) this.breakPanels(b.id, b.panels.map((p) => p.i));
    }
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
    const rec = { id: g.nextId++, owner: id, x, y, z, half: WIRE.size / 2 };
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

  /** Mason: reinforce a wall from his own stock of two. */
  masonReinforce(g, id, p) {
    g.game.destruction.startReinforce(id, p, true);
  },
};
