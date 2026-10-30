// Deterministic player movement shared by client (prediction) and server (authority).
// Given the same state, input and world, both sides produce the same result.

import {
  PLAYER_RADIUS, STAND_HEIGHT, CROUCH_HEIGHT, PRONE_HEIGHT, STAND_EYE, CROUCH_EYE, PRONE_EYE, PRONE_EYE_FORWARD,
  VAULT, RAPPEL, STEP_HEIGHT, WALK_SPEED, SPRINT_SPEED, CROUCH_SPEED, PRONE_SPEED, JUMP_SPEED, JUMP_COOLDOWN, ACCEL_GROUND, GRAVITY,
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
    // vault: while vaultT > 0 the body follows a hop from (vax,vay,vaz) to (vbx,vby,vbz) over a top at vtop
    vaultT: 0, vax: 0, vay: 0, vaz: 0, vbx: 0, vby: 0, vbz: 0, vtop: 0,
    // rappel: rap = rope number (1-based, 0 = not on a rope), rapSide = metres along the wall, rapFlip 0..1 upside down
    rap: 0, rapSide: 0, rapFlip: 0, rapPrev: 0, rapCd: 0,
    swing: -1,     // set to an opening id when the player just swung in through it (the server breaks its barricade)
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

  // Rope key is a press, not a hold
  const rapDown = (keys & KEY.RAPPEL) !== 0;
  const rapPressed = rapDown && !s.rapPrev;
  s.rapPrev = rapDown ? 1 : 0;
  s.rapCd = Math.max(0, (s.rapCd || 0) - dt);
  if (s.vaultT > 0) { stepVault(s, dt); return; }
  if (s.rap) { stepRappel(s, keys, rapPressed, dt, world); return; }
  s.rapFlip = Math.max(0, (s.rapFlip || 0) - dt * RAPPEL.flipSpeed);
  if (rapPressed && s.rapCd <= 0 && tryAttach(s, world)) return;

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
    if (tryVault(s, world)) return;       // a low obstacle in front: hop over it instead
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
  const ey = s.y + eyeHeight(s.crouch, prone) - (s.rapFlip || 0) * RAPPEL.eyeDrop;   // hanging upside down, the head is low
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
  return s.fireDelay > 0 || (!s.onGround && !s.rap) || s.vaultT > 0 ? { ...input, keys: input.keys & ~KEY.FIRE } : input;   // you can shoot while hanging on a rope
}

// ---------------------------------------------------------------- vaulting

/**
 * Space with a low obstacle straight ahead (a crate, a counter, a window sill): hop over or through it.
 * Needs room above the obstacle (so an intact barricade blocks it) and a free place to land beyond.
 * Returns true and starts the vault, or false to let the normal jump happen.
 */
function tryVault(s, world) {
  const v = findVault(s, world);
  if (!v) return false;
  const { land, top } = v;
  Object.assign(s, {
    vaultT: 1e-6, vax: s.x, vay: s.y, vaz: s.z, vbx: land.x, vby: land.y, vbz: land.z, vtop: top,
    vx: 0, vy: 0, vz: 0, onGround: false, sprinting: false, crouch: 1, prone: 0, lean: 0,
  });
  return true;
}

/** Is there something to vault over right in front of this player? { land, top } or null (also used for the on-screen prompt). */
export function findVault(s, world) {
  const [fx, fz] = forwardVec(s.yaw);
  const px = s.x + fx * 0.55, pz = s.z + fz * 0.55;
  let top = -Infinity;
  for (const b of world.boxes) {
    if (!overlapsX(b, px, 0.12) || !overlapsZ(b, pz, 0.12)) continue;
    if (b.min[1] > s.y + 0.6) continue;                  // starts above the hips: a lintel or a plank, not something to hop over
    if (b.max[1] <= s.y + STEP_HEIGHT + 0.01) continue;  // a low step: just walk
    top = Math.max(top, b.max[1]);
  }
  const rise = top - s.y;
  if (!(rise > STEP_HEIGHT && rise <= VAULT.maxRise)) return null;
  // Find where we come down: the first spot beyond the obstacle with standing room and a floor
  let land = null;
  for (let d = 0.9; d <= VAULT.maxDepth; d += 0.1) {
    const lx = s.x + fx * d, lz = s.z + fz * d;
    if (!isSpaceFree(world, lx, s.y + 0.03, lz, STAND_HEIGHT - 0.1)) continue;
    const floor = sweepDown(world, lx, s.y + 0.03, lz, STAND_HEIGHT, 0.4);
    if (floor < s.y - 0.4 + EPS) continue;
    land = { x: lx, z: lz, y: Math.max(floor, s.y - 0.4) };
    break;
  }
  if (!land) return null;
  // The way over must be clear of anything but the obstacle itself
  const steps = Math.ceil(Math.hypot(land.x - s.x, land.z - s.z) / 0.1);
  for (let i = 5; i <= steps; i++) {
    const k = i / steps;
    if (!isSpaceFree(world, s.x + (land.x - s.x) * k, top + 0.02, s.z + (land.z - s.z) * k, VAULT.clear, 0.12)) return null;
  }
  return { land, top };
}

function stepVault(s, dt) {
  const t = s.vaultT + dt / VAULT.time;
  if (t >= 1) {
    Object.assign(s, { x: s.vbx, y: s.vby, z: s.vbz, vx: 0, vy: 0, vz: 0, onGround: true, vaultT: 0, jumpCd: VAULT.cooldown });
    return;
  }
  s.vaultT = t;
  s.x = s.vax + (s.vbx - s.vax) * t;
  s.z = s.vaz + (s.vbz - s.vaz) * t;
  s.y = s.vay + (s.vby - s.vay) * t + (s.vtop - s.vay + 0.06) * Math.sin(Math.PI * t);
  s.vx = s.vy = s.vz = 0;
  s.onGround = false;
}

// ---------------------------------------------------------------- rappelling

/** Where a player on rope `r` at `side` metres along the wall hangs. */
export function ropePosition(r, side) {
  if (r.kind === 'hatch') return { x: r.x, z: r.z };
  return { x: r.x + r.tx * side + r.nx * RAPPEL.wallOffset, z: r.z + r.tz * side + r.nz * RAPPEL.wallOffset };
}

function hatchIsOpen(world, r) {
  const id = world.hatchPanel?.get(r.hatchBox);
  return id !== undefined && !world.alive[id];
}

/** Press the rope key: attach at the edge of a roof, at the foot of an outside wall you face, or at an open roof hatch. */
function tryAttach(s, world) {
  const f = findRope(s, world);
  if (!f) return false;
  const pos = ropePosition(world.map.ropes[f.index], f.side);
  Object.assign(s, { rap: f.index + 1, rapSide: f.side, rapFlip: 0, x: pos.x, z: pos.z, y: f.y, vx: 0, vy: 0, vz: 0, onGround: false, sprinting: false, crouch: 0, prone: 0, lean: 0 });
  return true;
}

/** The rope the player could attach to right now: { index, side, y } or null (also used for the on-screen prompt). */
export function findRope(s, world) {
  const ropes = world.map?.ropes;
  if (!ropes) return null;
  const [fx, fz] = forwardVec(s.yaw);
  for (let i = 0; i < ropes.length; i++) {
    const r = ropes[i];
    let y = null, side = 0;
    if (r.kind === 'hatch') {
      if (Math.hypot(s.x - r.x, s.z - r.z) > 1.3 || Math.abs(s.y - r.top) > 0.35 || !hatchIsOpen(world, r)) continue;
      y = r.top - RAPPEL.hang;
    } else {
      const dx = s.x - r.x, dz = s.z - r.z;
      const out = dx * r.nx + dz * r.nz, along = dx * r.tx + dz * r.tz;
      if (Math.abs(along) > r.range + 0.6) continue;
      const facing = fx * r.nx + fz * r.nz;          // > 0 looking away from the wall
      side = Math.max(-r.range, Math.min(r.range, along));
      if (out >= 0.1 && out <= 2.4 && facing < -0.35 && s.y >= r.bottom - 0.1 && s.y <= r.top - RAPPEL.hang) y = Math.max(r.bottom, s.y);
      else if (out <= 0.2 && out >= -1.8 && facing > 0.2 && Math.abs(s.y - r.top) < 0.35) y = r.top - RAPPEL.hang;
    }
    if (y !== null) return { index: i, side, y };
  }
  return null;
}

function stepRappel(s, keys, rapPressed, dt, world) {
  const r = world.map?.ropes?.[s.rap - 1];
  if (!r) { s.rap = 0; return; }
  s.vx = s.vy = s.vz = 0;
  s.sprinting = false;
  s.crouch = 0; s.prone = 0; s.lean = 0;
  const flipping = (keys & KEY.FLIP) !== 0;
  s.rapFlip = Math.max(0, Math.min(1, (s.rapFlip || 0) + (flipping ? 1 : -1) * dt * RAPPEL.flipSpeed));
  if (rapPressed) { letGo(s, r, false); return; }

  const up = ((keys & KEY.FORWARD) ? 1 : 0) - ((keys & KEY.BACK) ? 1 : 0);
  const sideIn = ((keys & KEY.RIGHT) ? 1 : 0) - ((keys & KEY.LEFT) ? 1 : 0);
  const maxY = r.top - RAPPEL.hang;

  // Space at a window: swing in through it
  if ((keys & KEY.JUMP) && r.kind === 'wall' && swingIn(s, r, world)) return;

  if (r.kind === 'wall' && sideIn) {
    const [rx, rz] = rightVec(s.yaw);
    const sign = rx * r.tx + rz * r.tz >= 0 ? 1 : -1;            // "right" on screen, along the wall
    s.rapSide = Math.max(-r.range, Math.min(r.range, s.rapSide + sign * sideIn * RAPPEL.side * dt));
  }
  if (up > 0 && s.y >= maxY - 1e-6) { climbOn(s, r); return; }    // at the top: up onto the roof
  if (up < 0 && s.y <= r.bottom + 1e-6) { letGo(s, r, true); return; }   // at the bottom: step off
  s.y = Math.max(r.bottom, Math.min(maxY, s.y + (up > 0 ? RAPPEL.up : up < 0 ? -RAPPEL.down : 0) * dt));
  const pos = ropePosition(r, s.rapSide);
  s.x = pos.x; s.z = pos.z;
}

/** Let go: from the foot of the wall you land; anywhere else you drop. */
function letGo(s, r, atBottom) {
  const out = r.kind === 'wall' ? 1.0 : 0;
  Object.assign(s, { rap: 0, rapCd: 0.5, rapFlip: 0, vx: 0, vz: 0, vy: 0 });
  if (atBottom) { s.x += (r.nx || 0) * (out - RAPPEL.wallOffset); s.z += (r.nz || 0) * (out - RAPPEL.wallOffset); s.y = r.bottom; s.onGround = true; }
  else s.onGround = false;
}

function climbOn(s, r) {
  const pos = ropePosition(r, s.rapSide);
  const [ex, ez] = r.exit;
  Object.assign(s, { rap: 0, rapCd: 0.5, rapFlip: 0, x: pos.x + ex, z: pos.z + ez, y: r.top, vx: 0, vy: 0, vz: 0, onGround: true });
}

/** Swing in through the window or door you are hanging beside; sets `swing` so the server can break its barricade. */
function swingIn(s, r, world) {
  const ops = world.map.openings;
  const along = r.wallAxis === 'x' ? s.x : s.z;
  for (const o of ops) {
    if (!o.exterior || o.axis !== r.wallAxis || Math.abs(o.fixed - r.wallFixed) > 0.01) continue;
    const hips = s.y + RAPPEL.hang;
    if (along < o.from - 0.2 || along > o.to + 0.2 || hips < o.y0 - 0.2 || hips > o.y1 + 0.2) continue;
    const into = 0.9;                                            // inside, past the wall
    const floorY = o.window ? o.y0 - 1.0 : o.y0;
    // Where you are along the window first, then the middle and the two ends (furniture may be in the way)
    const near = Math.max(o.from + 0.4, Math.min(o.to - 0.4, along));
    for (const a of [near, (o.from + o.to) / 2, o.from + 0.4, o.to - 0.4]) {
      const x = o.axis === 'x' ? a : o.fixed - r.nx * into, z = o.axis === 'x' ? o.fixed - r.nz * into : a;
      if (!isSpaceFree(world, x, floorY + 0.05, z, STAND_HEIGHT - 0.1)) continue;
      Object.assign(s, { rap: 0, rapCd: 0.5, rapFlip: 0, x, z, y: floorY, vx: 0, vy: 0, vz: 0, onGround: false, swing: o.id });
      return true;
    }
  }
  return false;
}
