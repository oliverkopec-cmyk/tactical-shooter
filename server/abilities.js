// Operator abilities (the F key) and the gadgets they create.
//
// Each ability is a handler under ABILITIES, keyed by `ability.id` in
// shared/operators.js. A handler gets (gadgets, socketId, player, abilityConfig).
// Gadgets that other players can see (shields, wire, jammers, cameras) live in
// the Gadgets class below and are synced with `gadgetAdd` / `gadgetRemove` events.

import {
  PHASE, SHIELD, WIRE, JAMMER_RANGE, CAMERA_REACH, STUN, GADGET_REACH, HAWK_MISS_COOLDOWN_MS,
} from '../shared/constants.js';
import { OPERATORS } from '../shared/operators.js';
import { getEyePosition, forwardVec } from '../shared/movement.js';
import { aimDirection } from '../shared/weapons.js';
import { raycastWorld } from '../shared/raycast.js';

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
  }

  get world() { return this.game.world; }
  error(id, msg) { this.game.io.to(id).emit('actionError', { msg }); }

  // ---------------------------------------------------------------- sync

  /** Cameras are hidden from attackers: only defenders hear about them. */
  broadcast(event, kind, payload) {
    const msg = { kind, ...payload };
    if (kind !== 'camera') return this.game.emitAll(event, msg);
    for (const [pid, q] of this.game.players) if (q.member.team === 'defense') this.game.io.to(pid).emit(event, msg);
  }

  list(team) {
    const out = [];
    for (const s of this.shields.values()) out.push({ kind: 'shield', ...s });
    for (const w of this.wires.values()) out.push({ kind: 'wire', ...w });
    for (const j of this.jammers.values()) out.push({ kind: 'jammer', ...j });
    if (team === 'defense') for (const c of this.cameras.values()) out.push({ kind: 'camera', ...c });
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

  // ---------------------------------------------------------------- stun grenades

  throwGrenade(p, id) {
    const eye = getEyePosition(p.state, this.world);
    const dir = aimDirection(p.state.yaw, p.state.pitch);
    const g = {
      id: this.nextId++, owner: id, t: STUN.fuse,
      pos: [eye.x + dir[0] * 0.5, eye.y + dir[1] * 0.5, eye.z + dir[2] * 0.5],
      vel: [dir[0] * STUN.speed, dir[1] * STUN.speed + 2.5, dir[2] * STUN.speed],
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
        const vn = g.vel[0] * n[0] + g.vel[1] * n[1] + g.vel[2] * n[2];
        for (let i = 0; i < 3; i++) g.vel[i] -= 1.45 * vn * n[i];
        if (n[1] > 0.5) { g.vel[0] *= 0.7; g.vel[2] *= 0.7; if (Math.hypot(...g.vel) < 0.8) g.vel = [0, 0, 0]; }
        g.pos = [hit.point[0] + n[0] * 0.07, hit.point[1] + n[1] * 0.07, hit.point[2] + n[2] * 0.07];
      } else {
        g.pos = [g.pos[0] + move[0], g.pos[1] + move[1], g.pos[2] + move[2]];
      }
      if (g.t <= 0) this.explodeGrenade(g, now);
    }
  }

  explodeGrenade(g, now) {
    this.grenades.delete(g.id);
    const owner = this.game.players.get(g.owner);
    const ownerTeam = owner?.member.team;
    for (const [pid, q] of this.game.players) {
      if (!q.alive || q.spawned === false || q.member.team === ownerTeam) continue;
      const eye = [q.state.x, q.state.y + 1.4, q.state.z];
      const v = [eye[0] - g.pos[0], eye[1] - g.pos[1], eye[2] - g.pos[2]];
      const dist = Math.hypot(...v);
      if (dist > STUN.radius) continue;
      const wall = dist > 0.05 ? raycastWorld(this.world, g.pos, v.map((c) => c / dist), dist) : null;
      if (wall && wall.t < dist - 0.2) continue;       // walls shield you from the flash
      q.stunUntil = now + STUN.duration * 1000;
      this.game.io.to(pid).emit('stunned', { ms: STUN.duration * 1000 });
    }
    this.game.emitAll('grenadeExploded', { id: g.id, pos: g.pos.map((v) => Math.round(v * 100) / 100) });
  }

  snapshotGrenades() {
    return [...this.grenades.values()].map((g) => ({ id: g.id, x: g.pos[0], y: g.pos[1], z: g.pos[2] }));
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
    this.game.io.to(id).emit('camView', { index: next, cam: next >= 0 ? cams[next] : null, count: cams.length });
  }

  exitCamera(id, p) {
    if (p.camView < 0) return;
    p.camView = -1;
    this.game.io.to(id).emit('camView', { index: -1, cam: null, count: this.cameras.size });
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
