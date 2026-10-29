// Weapon definitions and the deterministic weapon simulation (ammo, fire rate,
// reload, spread). Client and server run the same code on the same inputs, so
// the client can predict shots while the server stays authoritative.

import { KEY, WALK_SPEED } from './constants.js';

export const WEAPONS = {
  rifle: {
    id: 'rifle',
    name: 'Vanguard AR',
    kind: 'Rifle',
    auto: true,
    damage: 32,
    headMultiplier: 3.2,
    pellets: 1,
    rpm: 620,
    magSize: 30,
    reserve: 150,
    reloadTime: 2.4,
    falloffStart: 25,
    falloffEnd: 55,
    falloffMin: 0.7,
    baseSpread: 0.004,
    moveSpread: 0.03,
    bloomPerShot: 0.004,
    bloomMax: 0.03,
    bloomRecover: 0.12,       // rad/s
    recoilPitch: 0.011,       // rad per shot (client view kick)
    recoilYaw: 0.005,
    color: 0x3c4148,
    accent: 0x8a6a3c,
  },
  smg: {
    id: 'smg',
    name: 'Hornet SMG',
    kind: 'SMG',
    auto: true,
    damage: 22,
    headMultiplier: 4.6,
    pellets: 1,
    rpm: 850,
    magSize: 32,
    reserve: 160,
    reloadTime: 2.0,
    falloffStart: 14,
    falloffEnd: 35,
    falloffMin: 0.55,
    baseSpread: 0.009,
    moveSpread: 0.02,
    bloomPerShot: 0.003,
    bloomMax: 0.035,
    bloomRecover: 0.15,
    recoilPitch: 0.0085,
    recoilYaw: 0.007,
    color: 0x2b2f35,
    accent: 0x4a7a8c,
  },
  shotgun: {
    id: 'shotgun',
    name: 'Breaker 12',
    kind: 'Shotgun',
    auto: false,
    damage: 15,
    headMultiplier: 1.5,
    pellets: 8,
    rpm: 75,
    magSize: 7,
    reserve: 35,
    reloadTime: 2.8,
    falloffStart: 6,
    falloffEnd: 20,
    falloffMin: 0.25,
    baseSpread: 0.065,
    moveSpread: 0.015,
    bloomPerShot: 0,
    bloomMax: 0,
    bloomRecover: 1,
    recoilPitch: 0.06,
    recoilYaw: 0.012,
    color: 0x4a3a2c,
    accent: 0x2a2a2a,
  },
};

export const WEAPON_ORDER = ['rifle', 'smg', 'shotgun'];

export function createWeaponState(id = 'rifle') {
  const w = WEAPONS[id] || WEAPONS.rifle;
  return { id: w.id, ammo: w.magSize, reserve: w.reserve, cooldown: 0, reload: 0, bloom: 0, trigger: false };
}

export function copyWeaponState(ws) {
  return { ...ws };
}

/**
 * Advance the weapon by one input. Returns true when a shot is fired this step.
 * input.wsel (1-based weapon index) switches weapon; a temporary testing aid
 * until operators pick weapons in stage 6.
 */
export function stepWeapon(ws, input, dt) {
  if (input.wsel) {
    const id = WEAPON_ORDER[input.wsel - 1];
    if (id && id !== ws.id) Object.assign(ws, createWeaponState(id));
  }
  const w = WEAPONS[ws.id];
  const keys = input.keys | 0;
  const firing = (keys & KEY.FIRE) !== 0;

  ws.bloom = Math.max(0, ws.bloom - w.bloomRecover * dt);
  ws.cooldown -= dt;

  if (ws.reload > 0) {
    ws.reload -= dt;
    if (ws.reload <= 0) {
      const take = Math.min(w.magSize - ws.ammo, ws.reserve);
      ws.ammo += take;
      ws.reserve -= take;
      ws.reload = 0;
    }
  } else if (ws.ammo < w.magSize && ws.reserve > 0 && ((keys & KEY.RELOAD) || (firing && ws.ammo === 0))) {
    ws.reload = w.reloadTime;
  }

  let fired = false;
  const canTrigger = w.auto || !ws.trigger;
  if (firing && canTrigger && ws.reload === 0 && ws.ammo > 0 && ws.cooldown <= 0) {
    fired = true;
    ws.ammo--;
    ws.cooldown += 60 / w.rpm;
    ws.bloom = Math.min(w.bloomMax, ws.bloom + w.bloomPerShot);
  }
  // Fire-rate carry-over only applies while the trigger is held.
  if (!fired && ws.cooldown < 0) ws.cooldown = 0;
  ws.trigger = firing;
  return fired;
}

/** Current cone half-angle in radians, from movement, stance and bloom. */
export function currentSpread(ws, ps) {
  const w = WEAPONS[ws.id];
  const speed = Math.hypot(ps.vx, ps.vz) / WALK_SPEED;
  let spread = w.baseSpread + ws.bloom + w.moveSpread * Math.min(1.6, speed);
  if (!ps.onGround) spread += w.moveSpread * 2;
  spread *= 1 - Math.max(0.3 * ps.crouch, 0.45 * (ps.prone || 0));   // steadier crouched, steadiest lying down
  return spread;
}

export function damageAtDistance(w, dist, head) {
  let falloff = 1;
  if (dist > w.falloffStart) {
    const t = Math.min(1, (dist - w.falloffStart) / (w.falloffEnd - w.falloffStart));
    falloff = 1 - (1 - w.falloffMin) * t;
  }
  return w.damage * falloff * (head ? w.headMultiplier : 1);
}

// Small deterministic PRNG so client and server agree on spread for each shot.
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function aimDirection(yaw, pitch) {
  const cp = Math.cos(pitch);
  return [-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp];
}

/** Direction of every pellet for a shot, randomised inside the spread cone. */
export function shotDirections(w, yaw, pitch, spread, seed) {
  const fwd = aimDirection(yaw, pitch);
  // Basis perpendicular to the aim
  const right = [Math.cos(yaw), 0, -Math.sin(yaw)];
  const up = [
    right[1] * fwd[2] - right[2] * fwd[1],
    right[2] * fwd[0] - right[0] * fwd[2],
    right[0] * fwd[1] - right[1] * fwd[0],
  ];
  const rand = mulberry32(seed * 2654435761);
  const dirs = [];
  for (let i = 0; i < w.pellets; i++) {
    const ang = rand() * Math.PI * 2;
    const r = spread * Math.sqrt(rand());
    const a = Math.cos(ang) * r, b = Math.sin(ang) * r;
    const d = [fwd[0] + right[0] * a + up[0] * b, fwd[1] + right[1] * a + up[1] * b, fwd[2] + right[2] * a + up[2] * b];
    const len = Math.hypot(d[0], d[1], d[2]);
    dirs.push([d[0] / len, d[1] / len, d[2] / len]);
  }
  return dirs;
}
