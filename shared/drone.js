// Rolling reconnaissance drones: small, fast, and able to fit through doors and
// windows. Shared by the client (prediction) and the server (authority).

import { KEY } from './constants.js';
import { forwardVec, rightVec, sweepX, sweepZ, sweepDown, sweepUp } from './movement.js';

export const DRONE = {
  radius: 0.2,
  height: 0.28,
  eye: 0.17,            // camera height above the ground
  walkSpeed: 3.4,
  fastSpeed: 5.2,
  accel: 40,
  gravity: 22,
  jumpSpeed: 5,         // hop about 0.57 m high, about 0.45 s in the air: onto low ledges and over debris
  jumpBoost: 3.3,       // forward push on a hop: about 1.5 m further than rolling would go
  jumpCooldown: 1,      // seconds between hops, so hopping can't be chained to zoom around
  stepHeight: 0.22,     // climbs stairs, but not full ledges
  maxPitch: 0.7,
  hp: 40,
  spawnOffset: 1.8,     // metres in front of the owner
  pingRange: 30,        // how far a drone pilot can ping an enemy
  pingCone: 0.07,       // aim tolerance in radians (about 4 degrees)
  hitHalf: [0.26, 0.15, 0.3],
};

const EPS = 1e-4;
export const DRONE_KEYS = KEY.FORWARD | KEY.BACK | KEY.LEFT | KEY.RIGHT | KEY.SPRINT | KEY.JUMP;

export function createDroneState(x, y, z, yaw) {
  return { x, y, z, vx: 0, vy: 0, vz: 0, yaw, pitch: 0, onGround: true, jumpCd: 0 };
}

export function copyDroneState(s) {
  return { ...s };
}

export function stepDrone(s, input, dt, world) {
  const D = DRONE;
  const keys = input.keys & DRONE_KEYS;
  s.yaw = input.yaw;
  s.pitch = Math.max(-D.maxPitch, Math.min(D.maxPitch, input.pitch));

  const fwd = ((keys & KEY.FORWARD) ? 1 : 0) - ((keys & KEY.BACK) ? 1 : 0);
  const str = ((keys & KEY.RIGHT) ? 1 : 0) - ((keys & KEY.LEFT) ? 1 : 0);
  const [fx, fz] = forwardVec(s.yaw);
  const [rx, rz] = rightVec(s.yaw);
  let wx = fx * fwd + rx * str, wz = fz * fwd + rz * str;
  const len = Math.hypot(wx, wz);
  if (len > 0) { wx /= len; wz /= len; }
  const speed = (keys & KEY.SPRINT) ? D.fastSpeed : D.walkSpeed;

  // No steering in the air: hops and falls follow a smooth arc
  const accel = (s.onGround ? D.accel : 0) * dt;
  const tvx = wx * speed - s.vx, tvz = wz * speed - s.vz;
  const tlen = Math.hypot(tvx, tvz);
  if (tlen <= accel) { s.vx += tvx; s.vz += tvz; } else { s.vx += tvx / tlen * accel; s.vz += tvz / tlen * accel; }

  // Horizontal move with step-up for stairs
  const h = D.height, r = D.radius;
  const dx = s.vx * dt, dz = s.vz * dt;
  const ax = sweepX(world, s.x, s.y, s.z, h, dx, r);
  const az = sweepZ(world, ax, s.y, s.z, h, dz, r);
  const blocked = Math.abs(ax - (s.x + dx)) > EPS || Math.abs(az - (s.z + dz)) > EPS;
  if (blocked && s.onGround) {
    const upY = sweepUp(world, s.x, s.y, s.z, h, D.stepHeight, r);
    if (upY > s.y + EPS) {
      const bx = sweepX(world, s.x, upY, s.z, h, dx, r);
      const bz = sweepZ(world, bx, upY, s.z, h, dz, r);
      const by = sweepDown(world, bx, upY, bz, h, upY - s.y, r);
      if (Math.hypot(bx - s.x, bz - s.z) > Math.hypot(ax - s.x, az - s.z) + EPS) { s.x = bx; s.z = bz; s.y = by; }
      else { s.x = ax; s.z = az; }
    } else { s.x = ax; s.z = az; }
  } else { s.x = ax; s.z = az; }

  // Hop: up, plus a push the way the drone faces
  s.jumpCd = Math.max(0, (s.jumpCd || 0) - dt);
  if ((keys & KEY.JUMP) && s.onGround && s.jumpCd <= 0) {
    s.vy = D.jumpSpeed;
    s.vx += fx * D.jumpBoost; s.vz += fz * D.jumpBoost;
    s.onGround = false;
    s.jumpCd = D.jumpCooldown;
  }

  // Gravity, ceilings; stick to stairs when rolling down them
  const wasOnGround = s.onGround;
  s.vy -= D.gravity * dt;
  const dy = s.vy * dt;
  if (dy > 0) {
    const uy = sweepUp(world, s.x, s.y, s.z, h, dy, r);
    if (uy < s.y + dy - EPS) s.vy = 0;
    s.y = uy; s.onGround = false;
    return;
  }
  const ny = sweepDown(world, s.x, s.y, s.z, h, -dy, r);
  if (ny > s.y + dy + EPS) { s.y = ny; s.vy = 0; s.onGround = true; }
  else {
    s.y = ny; s.onGround = false;
    if (wasOnGround) {
      const sy = sweepDown(world, s.x, s.y, s.z, h, D.stepHeight, r);
      if (sy > s.y - D.stepHeight + EPS) { s.y = sy; s.vy = 0; s.onGround = true; }
    }
  }
  if (s.y < -20) { s.y = 1; s.vy = 0; }
}

export function droneEye(s) {
  return [s.x, s.y + DRONE.eye, s.z];
}
