// Deterministic player movement shared by client (prediction) and server (authority).
// Given the same state, input and world, both sides produce the same result.

import {
  PLAYER_RADIUS, STAND_HEIGHT, CROUCH_HEIGHT, PRONE_HEIGHT, STAND_EYE, CROUCH_EYE, PRONE_EYE, PRONE_EYE_FORWARD,
  STEP_HEIGHT, WALK_SPEED, SPRINT_SPEED, CROUCH_SPEED, PRONE_SPEED, JUMP_SPEED, JUMP_COOLDOWN, ACCEL_GROUND, GRAVITY,
  CROUCH_TRANSITION, PRONE_TRANSITION, LEAN_SPEED, LEAN_OFFSET, KEY, SPRINT_FIRE_DELAY,
} from './constants.js';

const EPS = 1e-4;
const R = PLAYER_RADIUS;
const MAX_PITCH = Math.PI / 2 - 0.01;

export function createPlayerState(spawn) {
  return {
    x: spawn.x, y: spawn.y, z: spawn.z,
    vx: 0, vy: 0, vz: 0,
    yaw: spawn.yaw || 0, pitch: 0,
    crouch: 0, lean: 0,
    prone: 0,      // 0 standing/crouching ... 1 lying down
    jumpCd: 0,     // seconds until the next jump is allowed
    onGround: true,
    sprinting: false,
    fireDelay: 0,  // > 0 while recovering from a sprint: no shooting yet
    speedMul: 1,   // operator speed rating
    gunMul: 1,     // mobility of the gun that is drawn (set from the weapon before each step)
    slow: 1,       // temporary slow (barbed wire, stun), set by the server
  };
}

export function copyPlayerState(s) {
  return { ...s };
}

const lerp = (a, b, k) => a + (b - a) * k;
export const bodyHeight = (crouch, prone = 0) => lerp(lerp(STAND_HEIGHT, CROUCH_HEIGHT, crouch), PRONE_HEIGHT, prone);
export const eyeHeight = (crouch, prone = 0) => lerp(lerp(STAND_EYE, CROUCH_EYE, crouch), PRONE_EYE, prone);

// yaw 0 looks down -z (Three.js camera convention)
export const forwardVec = (yaw) => [-Math.sin(yaw), -Math.cos(yaw)];
export const rightVec = (yaw) => [Math.cos(yaw), -Math.sin(yaw)];

// ---------------------------------------------------------------- collision queries
// world.boxes: [{ min: [x,y,z], max: [x,y,z] }]

function overlapsY(b, y, h) {
  return b.max[1] > y + EPS && b.min[1] < y + h - EPS;
}
function overlapsX(b, x, r) {
  return b.max[0] > x - r + EPS && b.min[0] < x + r - EPS;
}
function overlapsZ(b, z, r) {
  return b.max[2] > z - r + EPS && b.min[2] < z + r - EPS;
}

export function isSpaceFree(world, x, y, z, h, r = R) {
  for (const b of world.boxes) {
    if (overlapsX(b, x, r) && overlapsY(b, y, h) && overlapsZ(b, z, r)) return false;
  }
  return true;
}

// Swept moves along one axis. Boxes we already overlap are ignored so a player
// can never get permanently stuck inside geometry.
export function sweepX(world, x, y, z, h, dx, r = R) {
  let nx = x + dx;
  if (dx === 0) return x;
  for (const b of world.boxes) {
    if (!overlapsY(b, y, h) || !overlapsZ(b, z, r)) continue;
    if (dx > 0) {
      if (b.min[0] >= x + r - EPS && b.min[0] - r < nx) nx = b.min[0] - r;
    } else if (b.max[0] <= x - r + EPS && b.max[0] + r > nx) {
      nx = b.max[0] + r;
    }
  }
  return nx;
}

export function sweepZ(world, x, y, z, h, dz, r = R) {
  let nz = z + dz;
  if (dz === 0) return z;
  for (const b of world.boxes) {
    if (!overlapsY(b, y, h) || !overlapsX(b, x, r)) continue;
    if (dz > 0) {
      if (b.min[2] >= z + r - EPS && b.min[2] - r < nz) nz = b.min[2] - r;
    } else if (b.max[2] <= z - r + EPS && b.max[2] + r > nz) {
      nz = b.max[2] + r;
    }
  }
  return nz;
}

export function sweepDown(world, x, y, z, h, dist, r = R) {
  let ny = y - dist;
  for (const b of world.boxes) {
    if (!overlapsX(b, x, r) || !overlapsZ(b, z, r)) continue;
    if (b.max[1] <= y + EPS && b.max[1] > ny) ny = b.max[1];
  }
  return ny;
}

export function sweepUp(world, x, y, z, h, dist, r = R) {
  let ny = y + dist;
  for (const b of world.boxes) {
    if (!overlapsX(b, x, r) || !overlapsZ(b, z, r)) continue;
    if (b.min[1] >= y + h - EPS && b.min[1] - h < ny) ny = b.min[1] - h;
  }
  return Math.max(y, ny);
}

// Horizontal move with automatic step-up for stairs and small ledges.
function moveHorizontal(s, dx, dz, h, world) {
  const ax = sweepX(world, s.x, s.y, s.z, h, dx);
  const az = sweepZ(world, ax, s.y, s.z, h, dz);
  const blocked = Math.abs(ax - (s.x + dx)) > EPS || Math.abs(az - (s.z + dz)) > EPS;

  if (blocked && s.onGround) {
    const upY = sweepUp(world, s.x, s.y, s.z, h, STEP_HEIGHT);
    if (upY > s.y + EPS) {
      const bx = sweepX(world, s.x, upY, s.z, h, dx);
      const bz = sweepZ(world, bx, upY, s.z, h, dz);
      const by = sweepDown(world, bx, upY, bz, h, upY - s.y);
      const distA = Math.hypot(ax - s.x, az - s.z);
      const distB = Math.hypot(bx - s.x, bz - s.z);
      if (distB > distA + EPS) {
        s.x = bx; s.z = bz; s.y = by;
        return;
      }
    }
  }
  s.x = ax; s.z = az;
}

// ---------------------------------------------------------------- main step

/**
 * Advance one player by one input.
 * input: { keys: bitmask of KEY, yaw, pitch }
 */
export function stepPlayer(s, input, dt, world) {
  const keys = input.keys | 0;
  s.yaw = input.yaw;
  s.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, input.pitch));

  // Crouch and prone: going down is always allowed (prone only on the ground),
  // getting up needs head room. Getting up from prone where standing doesn't
  // fit ends in a crouch.
  s.prone = s.prone || 0;
  if (keys & KEY.CROUCH) {
    s.crouch = Math.min(1, s.crouch + CROUCH_TRANSITION * dt);
  } else if (s.crouch > 0 && s.prone === 0) {
    const next = Math.max(0, s.crouch - CROUCH_TRANSITION * dt);
    if (isSpaceFree(world, s.x, s.y, s.z, bodyHeight(next, s.prone))) s.crouch = next;
  }
  if ((keys & KEY.PRONE) && (s.onGround || s.prone > 0)) {
    s.prone = Math.min(1, s.prone + PRONE_TRANSITION * dt);
  } else if (!(keys & KEY.PRONE) && s.prone > 0) {
    const next = Math.max(0, s.prone - PRONE_TRANSITION * dt);
    if (isSpaceFree(world, s.x, s.y, s.z, bodyHeight(s.crouch, next))) s.prone = next;
    else if (isSpaceFree(world, s.x, s.y, s.z, bodyHeight(1, next))) { s.crouch = 1; s.prone = next; }
  }
  const lying = s.prone > 0.05;
  const h = bodyHeight(s.crouch, s.prone);

  // Movement intent
  const fwd = ((keys & KEY.FORWARD) ? 1 : 0) - ((keys & KEY.BACK) ? 1 : 0);
  const str = ((keys & KEY.RIGHT) ? 1 : 0) - ((keys & KEY.LEFT) ? 1 : 0);
  const [fx, fz] = forwardVec(s.yaw);
  const [rx, rz] = rightVec(s.yaw);
  let wx = fx * fwd + rx * str;
  let wz = fz * fwd + rz * str;
  const len = Math.hypot(wx, wz);
  if (len > 0) { wx /= len; wz /= len; }

  const leaning = (keys & (KEY.LEAN_LEFT | KEY.LEAN_RIGHT)) !== 0;
  // Holding fire cancels a sprint, and you can't shoot until you've recovered from it
  const firing = (keys & KEY.FIRE) !== 0;
  if (firing && s.sprinting) s.fireDelay = SPRINT_FIRE_DELAY;
  s.fireDelay = Math.max(0, (s.fireDelay || 0) - dt);
  const sprinting = !!(keys & KEY.SPRINT) && fwd > 0 && s.crouch < 0.5 && !lying && !leaning && !firing && s.fireDelay <= 0;
  s.sprinting = sprinting;
  const baseSpeed = sprinting ? SPRINT_SPEED : WALK_SPEED;
  const speed = lerp(lerp(baseSpeed, CROUCH_SPEED, s.crouch), PRONE_SPEED, s.prone) * (s.speedMul ?? 1) * (s.gunMul ?? 1) * (s.slow ?? 1);

  // Lean (not while sprinting or lying down)
  let leanTarget = 0;
  if (!sprinting && !lying) leanTarget = ((keys & KEY.LEAN_RIGHT) ? 1 : 0) - ((keys & KEY.LEAN_LEFT) ? 1 : 0);
  const dl = leanTarget - s.lean;
  const maxDl = LEAN_SPEED * dt;
  s.lean += Math.max(-maxDl, Math.min(maxDl, dl));

  // Accelerate toward the wished velocity (reduced control in the air)
  const accel = (s.onGround ? ACCEL_GROUND : ACCEL_GROUND * 0.15) * dt;
  const tvx = wx * speed - s.vx, tvz = wz * speed - s.vz;
  const tlen = Math.hypot(tvx, tvz);
  if (tlen <= accel) { s.vx += tvx; s.vz += tvz; } else { s.vx += tvx / tlen * accel; s.vz += tvz / tlen * accel; }

  moveHorizontal(s, s.vx * dt, s.vz * dt, h, world);

  // Jump: only from the ground, not while lying down, with a short cooldown
  s.jumpCd = Math.max(0, (s.jumpCd || 0) - dt);
  if ((keys & KEY.JUMP) && s.onGround && !lying && s.jumpCd <= 0) {
    s.vy = JUMP_SPEED;
    s.onGround = false;
    s.jumpCd = JUMP_COOLDOWN;
  }

  // Gravity, ceilings, landing, and sticking to stairs when walking down them
  const wasOnGround = s.onGround;
  s.vy -= GRAVITY * dt;
  const dy = s.vy * dt;
  if (dy > 0) {
    const uy = sweepUp(world, s.x, s.y, s.z, h, dy);
    if (uy < s.y + dy - EPS) s.vy = 0;   // bumped the ceiling
    s.y = uy; s.onGround = false;
    return;
  }
  const ny = sweepDown(world, s.x, s.y, s.z, h, -dy);
  if (ny > s.y + dy + EPS) {
    s.y = ny; s.vy = 0; s.onGround = true;
  } else {
    s.y = ny; s.onGround = false;
    if (wasOnGround) {
      const sy = sweepDown(world, s.x, s.y, s.z, h, STEP_HEIGHT);
      if (sy > s.y - STEP_HEIGHT + EPS) { s.y = sy; s.vy = 0; s.onGround = true; }
    }
  }

  // Safety net: never fall out of the world
  if (s.y < -20) { s.y = 1; s.vy = 0; }
}

/**
 * Eye position including lean, pulled back if leaning would push the head into a wall.
 * Used by the camera now and by server hit detection later.
 */
export function getEyePosition(s, world) {
  const prone = s.prone || 0;
  const ey = s.y + eyeHeight(s.crouch, prone);
  const [rx, rz] = rightVec(s.yaw);
  const [fx, fz] = forwardVec(s.yaw);
  const ahead = PRONE_EYE_FORWARD * prone;   // lying down, the head is in front of the body's centre
  let lean = s.lean;
  if (lean !== 0) {
    const head = 0.14;
    for (let f = 1; f > 0; f -= 0.25) {
      const ox = rx * lean * f * LEAN_OFFSET, oz = rz * lean * f * LEAN_OFFSET;
      if (isSpaceFree(world, s.x + ox, ey - head, s.z + oz, head * 2, head)) { lean *= f; break; }
      if (f <= 0.25) lean = 0;
    }
  }
  return {
    x: s.x + rx * lean * LEAN_OFFSET + fx * ahead,
    y: ey,
    z: s.z + rz * lean * LEAN_OFFSET + fz * ahead,
    lean,
  };
}

/** The input the weapon should see: no trigger while recovering from a sprint or in the air. */
export function weaponInput(s, input) {
  return s.fireDelay > 0 || !s.onGround ? { ...input, keys: input.keys & ~KEY.FIRE } : input;
}
