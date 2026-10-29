// Server-side hit detection with lag compensation.
// Each tick we record every player's pose. When a shot arrives, targets are
// rewound to the moment the shooter saw them (their interpolated render time)
// and the ray is tested against those historical hitboxes and the map.

import { LAG_COMP_MAX_MS, MAX_SHOT_RANGE } from '../shared/constants.js';
import { raycastWorld, rayPlayer, rayBox } from '../shared/raycast.js';
import { DRONE } from '../shared/drone.js';
import { WEAPONS, damageAtDistance, shotDirections, currentSpread } from '../shared/weapons.js';
import { getEyePosition } from '../shared/movement.js';

const HISTORY_MS = 1000;

export class PoseHistory {
  constructor() {
    this.frames = []; // [{ t, poses: Map(id -> pose) }]
  }

  record(t, players) {
    const poses = new Map();
    for (const [id, p] of players) {
      if (!p.alive || p.spawned === false) continue;
      const s = p.state;
      poses.set(id, { x: s.x, y: s.y, z: s.z, yaw: s.yaw, crouch: s.crouch, prone: s.prone || 0, lean: s.lean });
    }
    this.frames.push({ t, poses });
    while (this.frames.length > 2 && this.frames[0].t < t - HISTORY_MS) this.frames.shift();
  }

  /** Pose of a player at time t, interpolated between recorded frames. */
  poseAt(id, t) {
    const f = this.frames;
    if (!f.length) return null;
    if (t >= f[f.length - 1].t) return f[f.length - 1].poses.get(id) || null;
    if (t <= f[0].t) return f[0].poses.get(id) || null;
    for (let i = f.length - 1; i > 0; i--) {
      if (f[i - 1].t <= t) {
        const a = f[i - 1].poses.get(id), b = f[i].poses.get(id);
        if (!a || !b) return b || a || null;
        const k = (t - f[i - 1].t) / Math.max(1, f[i].t - f[i - 1].t);
        let dyaw = (b.yaw - a.yaw) % (Math.PI * 2);
        if (dyaw > Math.PI) dyaw -= Math.PI * 2;
        if (dyaw < -Math.PI) dyaw += Math.PI * 2;
        return {
          x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, z: a.z + (b.z - a.z) * k,
          yaw: a.yaw + dyaw * k,
          crouch: a.crouch + (b.crouch - a.crouch) * k,
          prone: a.prone + (b.prone - a.prone) * k,
          lean: a.lean + (b.lean - a.lean) * k,
        };
      }
    }
    return null;
  }
}

/**
 * Resolve one fired shot (all pellets).
 * Returns { origin, pellets: [{ end, hitId, head, damage }] }.
 */
export const CAMERA_HIT_HALF = 0.22;

export function resolveShot({ shooterId, shooter, input, world, players, history, now, drones = [], cameras = [] }) {
  const w = WEAPONS[shooter.weapon.id];
  const eye = getEyePosition(shooter.state, world);
  const origin = [eye.x, eye.y, eye.z];
  const spread = currentSpread(shooter.weapon, shooter.state);
  const dirs = shotDirections(w, input.yaw, input.pitch, spread, input.seq);

  // Clamp the rewind so a client can't claim an arbitrarily old view of the world.
  const rewindTo = Math.max(now - LAG_COMP_MAX_MS, Math.min(now, input.rt || now));

  const targets = [];
  for (const [id, p] of players) {
    if (id === shooterId || !p.alive || p.spawned === false || p.member.team === shooter.member.team) continue;
    const pose = history.poseAt(id, rewindTo) || p.state;
    targets.push({ id, pose });
  }

  const pellets = [];
  for (const d of dirs) {
    const wallHit = raycastWorld(world, origin, d, MAX_SHOT_RANGE);
    let maxT = wallHit ? wallHit.t : MAX_SHOT_RANGE;
    let hit = null;
    for (const t of targets) {
      const h = rayPlayer(origin, d, t.pose, maxT);
      if (h) { hit = { id: t.id, ...h }; maxT = h.t; }
    }
    // Defenders can shoot enemy drones (nothing else is in their line of fire up to maxT)
    let drone = null;
    if (!hit && shooter.member.team === 'defense') {
      for (const dr of drones) {
        if (!dr.alive) continue;
        const c = [dr.state.x, dr.state.y + DRONE.hitHalf[1], dr.state.z];
        const h = rayBox(origin, d, [c[0] - DRONE.hitHalf[0], c[1] - DRONE.hitHalf[1], c[2] - DRONE.hitHalf[2]],
          [c[0] + DRONE.hitHalf[0], c[1] + DRONE.hitHalf[1], c[2] + DRONE.hitHalf[2]], maxT);
        if (h) { drone = { id: dr.id, t: h.t }; maxT = h.t; }
      }
    }
    // Attackers can shoot Lookout's cameras (one shot is enough)
    let camera = null;
    if (!hit && !drone && shooter.member.team === 'attack') {
      for (const c of cameras) {
        const q = CAMERA_HIT_HALF;
        const h = rayBox(origin, d, [c.pos[0] - q, c.pos[1] - q, c.pos[2] - q], [c.pos[0] + q, c.pos[1] + q, c.pos[2] + q], maxT);
        if (h) { camera = { id: c.id, t: h.t }; maxT = h.t; }
      }
    }
    const end = [origin[0] + d[0] * maxT, origin[1] + d[1] * maxT, origin[2] + d[2] * maxT];
    pellets.push({
      end,
      hitId: hit ? hit.id : null,
      head: hit ? hit.head : false,
      damage: hit ? damageAtDistance(w, hit.t, hit.head) : 0,
      wall: !hit && !drone && !camera && !!wallHit,
      cameraId: camera ? camera.id : null,
      barricade: !hit && !drone && !camera && wallHit?.box.kind === 'barricade' ? { id: wallHit.box.barricadeId, index: wallHit.box.panelIndex } : null,
      droneId: drone ? drone.id : null,
      droneDamage: drone ? damageAtDistance(w, drone.t, false) : 0,
      panelId: !hit && !drone && !camera && wallHit?.box.kind === 'panel' ? wallHit.box.id : null,
      panelDamage: w.damage,
    });
  }
  return { origin, pellets };
}
