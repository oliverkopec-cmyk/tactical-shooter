// Ray tests against the map and against player hitboxes.
// Player hitboxes match the avatar drawn by the client: a torso box and a head
// sphere, rotated by yaw and tilted around the feet when leaning.

import { LEAN_OFFSET, STAND_EYE } from './constants.js';
import { bodyHeight } from './movement.js';

export const LEAN_ANGLE = Math.atan2(LEAN_OFFSET, STAND_EYE);
export const TORSO_HALF_WIDTH = 0.31;
export const TORSO_HALF_DEPTH = 0.19;
export const HEAD_RADIUS = 0.2;
export const HEAD_DROP = 0.18;   // head centre sits this far below the top of the body

/** Slab test. Returns { t, axis, sign } for the entry point, or null. */
export function rayBox(o, d, min, max, maxT) {
  let tmin = 0, tmax = maxT, axis = -1, sign = 0;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-9) {
      if (o[i] < min[i] || o[i] > max[i]) return null;
      continue;
    }
    const inv = 1 / d[i];
    let t1 = (min[i] - o[i]) * inv, t2 = (max[i] - o[i]) * inv;
    let s = -1;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; s = 1; }
    if (t1 > tmin) { tmin = t1; axis = i; sign = s; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  if (axis === -1) return null; // ray starts inside the box
  return { t: tmin, axis, sign };
}

/** Nearest map hit. Returns { t, point, normal, box } or null. */
export function raycastWorld(world, o, d, maxT) {
  let best = null;
  for (const b of world.boxes) {
    const hit = rayBox(o, d, b.min, b.max, best ? best.t : maxT);
    if (hit && (!best || hit.t < best.t)) best = { ...hit, box: b };
  }
  if (!best) return null;
  const normal = [0, 0, 0];
  normal[best.axis] = best.sign;
  return {
    t: best.t,
    point: [o[0] + d[0] * best.t, o[1] + d[1] * best.t, o[2] + d[2] * best.t],
    normal,
    box: best.box,
  };
}

/**
 * Ray against one player's pose { x, y, z, yaw, crouch, lean }.
 * Returns { t, head } for the nearest part hit, or null.
 */
export function rayPlayer(o, d, pose, maxT) {
  // Into the avatar's local frame: undo yaw (about Y), then undo the lean tilt (about Z).
  const px = o[0] - pose.x, py = o[1] - pose.y, pz = o[2] - pose.z;
  const cy = Math.cos(-pose.yaw), sy = Math.sin(-pose.yaw);
  const lx = px * cy + pz * sy, lz = -px * sy + pz * cy;
  const dx = d[0] * cy + d[2] * sy, dz = -d[0] * sy + d[2] * cy;
  const th = pose.lean * LEAN_ANGLE; // inverse of rotation.z = -lean * LEAN_ANGLE
  const cz = Math.cos(th), sz = Math.sin(th);
  const ox = lx * cz - py * sz, oy = lx * sz + py * cz;
  const ddx = dx * cz - d[1] * sz, ddy = dx * sz + d[1] * cz;
  const lo = [ox, oy, lz], ld = [ddx, ddy, dz];

  const h = bodyHeight(pose.crouch);
  let best = null;

  const torsoH = h - 0.36;
  const torso = rayBox(lo, ld, [-TORSO_HALF_WIDTH, 0, -TORSO_HALF_DEPTH], [TORSO_HALF_WIDTH, torsoH, TORSO_HALF_DEPTH], maxT);
  if (torso) best = { t: torso.t, head: false };

  // Head sphere
  const hc = [0, h - HEAD_DROP, 0];
  const ocx = lo[0] - hc[0], ocy = lo[1] - hc[1], ocz = lo[2] - hc[2];
  const bq = ocx * ld[0] + ocy * ld[1] + ocz * ld[2];
  const cq = ocx * ocx + ocy * ocy + ocz * ocz - HEAD_RADIUS * HEAD_RADIUS;
  const disc = bq * bq - cq;
  if (disc >= 0) {
    const t = -bq - Math.sqrt(disc);
    if (t > 0 && t < maxT && (!best || t < best.t)) best = { t, head: true };
  }
  return best;
}
