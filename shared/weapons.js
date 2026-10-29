// Weapon definitions and the deterministic weapon simulation (ammo, fire rate,
// reload, spread). Client and server run the same code on the same inputs, so
// the client can predict shots while the server stays authoritative.

import { KEY, WALK_SPEED } from './constants.js';

// Every operator has a unique primary and a unique secondary (see operators.js).
// Fields:
//   kind        shown in menus and the kill feed       model   which first-person model to draw
//   auto        hold to keep firing (false = one shot per click)
//   damage      per pellet, pellets per shot, headMultiplier for head hits
//   rpm         rounds per minute                      falloffStart/End/Min: damage drops with distance
//   mobility    walking speed multiplier while it is held (heavier guns are slower)
//   desc        one or two sentences shown on hover
const DEFAULTS = {
  auto: true, headMultiplier: 3, pellets: 1, falloffMin: 0.6,
  baseSpread: 0.005, moveSpread: 0.025, bloomPerShot: 0.003, bloomMax: 0.03, bloomRecover: 0.13,
  recoilPitch: 0.009, recoilYaw: 0.005, mobility: 1, scale: 1,
};

function gun(def) {
  const w = { ...DEFAULTS, ...def };
  w.reserve = def.reserve ?? w.magSize * 5;
  return w;
}

export const WEAPONS = {
  // ---------------------------------------------------------------- primaries
  rifle: gun({
    id: 'rifle', name: 'Vanguard AR', kind: 'Assault rifle', model: 'rifle', color: 0x3c4148, accent: 0x8a6a3c,
    damage: 32, headMultiplier: 3.2, rpm: 620, magSize: 30, reserve: 150, reloadTime: 2.4,
    falloffStart: 25, falloffEnd: 55, falloffMin: 0.7, baseSpread: 0.004, moveSpread: 0.03,
    bloomPerShot: 0.004, bloomRecover: 0.12, recoilPitch: 0.011, mobility: 1,
    desc: 'The standard-issue rifle: reliable at every range, with no real weakness.',
  }),
  ember: gun({
    id: 'ember', name: 'Ember AR', kind: 'Assault rifle', model: 'rifle', color: 0x4a2f27, accent: 0xff7a2e,
    damage: 38, headMultiplier: 3, rpm: 520, magSize: 25, reserve: 125, reloadTime: 2.6,
    falloffStart: 28, falloffEnd: 60, falloffMin: 0.72, baseSpread: 0.0045, moveSpread: 0.032,
    bloomPerShot: 0.005, bloomMax: 0.034, recoilPitch: 0.014, recoilYaw: 0.006, mobility: 0.97,
    desc: 'Hits hard and a bit slower than the Vanguard. Rewards short, controlled bursts.',
  }),
  gale: gun({
    id: 'gale', name: 'Gale Carbine', kind: 'Carbine', model: 'rifle', scale: 0.86, color: 0x34404a, accent: 0xb8c8d8,
    damage: 27, headMultiplier: 3.3, rpm: 720, magSize: 30, reserve: 150, reloadTime: 2.1,
    falloffStart: 20, falloffEnd: 45, falloffMin: 0.65, baseSpread: 0.0045, moveSpread: 0.022,
    bloomPerShot: 0.0035, bloomRecover: 0.14, recoilPitch: 0.009, mobility: 1.07,
    desc: 'Light and quick. Great on the move, but it runs out of punch at long range.',
  }),
  smg: gun({
    id: 'smg', name: 'Hornet SMG', kind: 'SMG', model: 'smg', color: 0x2b2f35, accent: 0x4a7a8c,
    damage: 22, headMultiplier: 4.6, rpm: 850, magSize: 32, reserve: 160, reloadTime: 2.0,
    falloffStart: 14, falloffEnd: 35, falloffMin: 0.55, baseSpread: 0.009, moveSpread: 0.02,
    bloomPerShot: 0.003, bloomMax: 0.035, bloomRecover: 0.15, recoilPitch: 0.0085, recoilYaw: 0.007, mobility: 1.06,
    desc: 'A fast-firing close-quarters gun that is deadly to the head.',
  }),
  shotgun: gun({
    id: 'shotgun', name: 'Breaker 12', kind: 'Shotgun', model: 'shotgun', color: 0x4a3a2c, accent: 0x2a2a2a,
    auto: false, damage: 15, headMultiplier: 1.5, pellets: 8, rpm: 75, magSize: 7, reserve: 35, reloadTime: 2.8,
    falloffStart: 6, falloffEnd: 20, falloffMin: 0.25, baseSpread: 0.065, moveSpread: 0.015,
    bloomPerShot: 0, bloomMax: 0, bloomRecover: 1, recoilPitch: 0.06, recoilYaw: 0.012, mobility: 0.94,
    desc: 'Eight pellets per shot. Devastating up close and nearly useless from across a room.',
  }),
  bastion: gun({
    id: 'bastion', name: 'Bastion LMG', kind: 'Light machine gun', model: 'lmg', color: 0x2f3a33, accent: 0x9a8f5a,
    damage: 30, headMultiplier: 2.8, rpm: 560, magSize: 60, reserve: 180, reloadTime: 4.2,
    falloffStart: 26, falloffEnd: 58, falloffMin: 0.7, baseSpread: 0.006, moveSpread: 0.04,
    bloomPerShot: 0.0045, bloomMax: 0.04, bloomRecover: 0.1, recoilPitch: 0.012, recoilYaw: 0.008, mobility: 0.86,
    desc: 'A huge magazine for suppressing a doorway. Heavy, slow to reload and clumsy on the move.',
  }),
  pulse: gun({
    id: 'pulse', name: 'Pulse PDW', kind: 'Personal defence weapon', model: 'smg', scale: 0.9, color: 0x233c34, accent: 0x57d68d,
    damage: 20, headMultiplier: 3.4, rpm: 940, magSize: 40, reserve: 160, reloadTime: 1.9,
    falloffStart: 12, falloffEnd: 30, falloffMin: 0.5, baseSpread: 0.008, moveSpread: 0.018,
    bloomPerShot: 0.0028, bloomMax: 0.032, bloomRecover: 0.16, recoilPitch: 0.0075, recoilYaw: 0.006, mobility: 1.08,
    desc: 'The fastest fire rate in the game and a big magazine. Best in tight rooms.',
  }),
  longview: gun({
    id: 'longview', name: 'Longview DMR', kind: 'Marksman rifle', model: 'dmr', color: 0x30333a, accent: 0xc08be8,
    auto: false, damage: 58, headMultiplier: 2.6, rpm: 240, magSize: 10, reserve: 50, reloadTime: 2.8,
    falloffStart: 45, falloffEnd: 90, falloffMin: 0.85, baseSpread: 0.0015, moveSpread: 0.05,
    bloomPerShot: 0.006, bloomMax: 0.03, bloomRecover: 0.1, recoilPitch: 0.03, recoilYaw: 0.006, mobility: 0.95,
    desc: 'One precise shot at a time. A headshot is an instant kill and it keeps its damage at long range.',
  }),
  keystone: gun({
    id: 'keystone', name: 'Keystone BR', kind: 'Battle rifle', model: 'rifle', scale: 1.08, color: 0x3a3d41, accent: 0x8d99a6,
    auto: false, damage: 48, headMultiplier: 2.8, rpm: 330, magSize: 15, reserve: 75, reloadTime: 2.8,
    falloffStart: 30, falloffEnd: 62, falloffMin: 0.75, baseSpread: 0.003, moveSpread: 0.035,
    bloomPerShot: 0.006, bloomMax: 0.03, bloomRecover: 0.11, recoilPitch: 0.022, recoilYaw: 0.006, mobility: 0.9,
    desc: 'Two or three heavy shots drop most targets. Slow handling, strong at range.',
  }),
  garrison: gun({
    id: 'garrison', name: 'Garrison AR', kind: 'Assault rifle', model: 'rifle', color: 0x383f46, accent: 0x5a8aa8,
    damage: 30, headMultiplier: 3.2, rpm: 600, magSize: 30, reserve: 150, reloadTime: 2.3,
    falloffStart: 24, falloffEnd: 52, falloffMin: 0.7, baseSpread: 0.0035, moveSpread: 0.03,
    bloomPerShot: 0.0035, bloomRecover: 0.13, recoilPitch: 0.0095, mobility: 1,
    desc: 'The defenders\' issue rifle: a touch steadier than the Vanguard, a touch weaker per hit.',
  }),

  // ---------------------------------------------------------------- secondaries
  sidekick: gun({
    id: 'sidekick', name: 'Sidekick 9', kind: 'Pistol', model: 'pistol', color: 0x30343a, accent: 0x6a7078,
    auto: false, damage: 26, headMultiplier: 3, rpm: 360, magSize: 15, reserve: 60, reloadTime: 1.7,
    falloffStart: 12, falloffEnd: 30, falloffMin: 0.55, baseSpread: 0.005, moveSpread: 0.02,
    bloomPerShot: 0.004, bloomMax: 0.025, recoilPitch: 0.012, mobility: 1.1,
    desc: 'A dependable 9 mm sidearm for when the primary runs dry.',
  }),
  sidewinder: gun({
    id: 'sidewinder', name: 'Sidewinder', kind: 'Revolver', model: 'revolver', color: 0x4a4a50, accent: 0x8a5a2c,
    auto: false, damage: 55, headMultiplier: 2.4, rpm: 150, magSize: 6, reserve: 30, reloadTime: 3.0,
    falloffStart: 15, falloffEnd: 40, falloffMin: 0.6, baseSpread: 0.004, moveSpread: 0.025,
    bloomPerShot: 0.008, bloomMax: 0.03, bloomRecover: 0.12, recoilPitch: 0.03, recoilYaw: 0.01, mobility: 1.04,
    desc: 'Six heavy rounds. Two body shots or one head shot, with a slow reload.',
  }),
  sting: gun({
    id: 'sting', name: 'Sting', kind: 'Machine pistol', model: 'machinePistol', color: 0x2b3a44, accent: 0xf2c230,
    damage: 17, headMultiplier: 3, rpm: 900, magSize: 20, reserve: 80, reloadTime: 1.6,
    falloffStart: 8, falloffEnd: 22, falloffMin: 0.45, baseSpread: 0.012, moveSpread: 0.015,
    bloomPerShot: 0.004, bloomMax: 0.04, bloomRecover: 0.16, recoilPitch: 0.01, recoilYaw: 0.008, mobility: 1.1,
    desc: 'A fully automatic pistol that empties fast. Hard to control past a few metres.',
  }),
  anvil: gun({
    id: 'anvil', name: 'Anvil .45', kind: 'Heavy pistol', model: 'pistol', scale: 1.12, color: 0x3d3f45, accent: 0x6fb8d8,
    auto: false, damage: 45, headMultiplier: 2.2, rpm: 200, magSize: 8, reserve: 40, reloadTime: 2.2,
    falloffStart: 14, falloffEnd: 35, falloffMin: 0.6, baseSpread: 0.0045, moveSpread: 0.022,
    bloomPerShot: 0.007, bloomMax: 0.03, recoilPitch: 0.022, recoilYaw: 0.008, mobility: 1.02,
    desc: 'Big, slow and punchy. Three body shots finish a target.',
  }),
  needle: gun({
    id: 'needle', name: 'Needle', kind: 'Light pistol', model: 'pistol', scale: 0.92, color: 0x33383f, accent: 0xe8e8ff,
    auto: false, damage: 24, headMultiplier: 3.2, rpm: 420, magSize: 15, reserve: 75, reloadTime: 1.5,
    falloffStart: 12, falloffEnd: 32, falloffMin: 0.55, baseSpread: 0.0045, moveSpread: 0.016,
    bloomPerShot: 0.0035, bloomMax: 0.022, recoilPitch: 0.009, mobility: 1.1,
    desc: 'Quick to fire and quick to reload. Little recoil, little damage.',
  }),
  gavel: gun({
    id: 'gavel', name: 'Gavel', kind: 'Hand cannon', model: 'revolver', scale: 1.12, color: 0x40382f, accent: 0xb7664a,
    auto: false, damage: 70, headMultiplier: 2, rpm: 90, magSize: 5, reserve: 20, reloadTime: 3.2,
    falloffStart: 10, falloffEnd: 28, falloffMin: 0.5, baseSpread: 0.004, moveSpread: 0.028,
    bloomPerShot: 0.01, bloomMax: 0.035, bloomRecover: 0.1, recoilPitch: 0.05, recoilYaw: 0.012, mobility: 0.98,
    desc: 'Five enormous rounds. Two body shots kill, but the kick and the reload are brutal.',
  }),
  zap: gun({
    id: 'zap', name: 'Zap 18', kind: 'Pistol', model: 'pistol', color: 0x24342e, accent: 0x57d68d,
    auto: false, damage: 21, headMultiplier: 3.4, rpm: 500, magSize: 18, reserve: 90, reloadTime: 1.4,
    falloffStart: 11, falloffEnd: 28, falloffMin: 0.5, baseSpread: 0.0055, moveSpread: 0.017,
    bloomPerShot: 0.003, bloomMax: 0.022, recoilPitch: 0.008, mobility: 1.1,
    desc: 'High-capacity and fast to reload, with a very quick trigger.',
  }),
  peep: gun({
    id: 'peep', name: 'Peep 7', kind: 'Pistol', model: 'pistol', scale: 0.95, color: 0x36303c, accent: 0xc08be8,
    auto: false, damage: 30, headMultiplier: 3.5, rpm: 300, magSize: 12, reserve: 60, reloadTime: 1.8,
    falloffStart: 16, falloffEnd: 38, falloffMin: 0.65, baseSpread: 0.003, moveSpread: 0.022,
    bloomPerShot: 0.004, bloomMax: 0.02, recoilPitch: 0.011, mobility: 1.08,
    desc: 'A precise pistol that holds its accuracy and damage further than most sidearms.',
  }),
  trowel: gun({
    id: 'trowel', name: 'Trowel', kind: 'Revolver', model: 'revolver', color: 0x44484c, accent: 0x8d99a6,
    auto: false, damage: 48, headMultiplier: 2.4, rpm: 140, magSize: 6, reserve: 30, reloadTime: 2.9,
    falloffStart: 18, falloffEnd: 45, falloffMin: 0.65, baseSpread: 0.0035, moveSpread: 0.024,
    bloomPerShot: 0.007, bloomMax: 0.03, bloomRecover: 0.12, recoilPitch: 0.026, recoilYaw: 0.009, mobility: 1.02,
    desc: 'A steady revolver that trades a little damage for a little more range.',
  }),
  holdout: gun({
    id: 'holdout', name: 'Holdout', kind: 'Pistol', model: 'pistol', color: 0x30343a, accent: 0x5a8aa8,
    auto: false, damage: 25, headMultiplier: 3, rpm: 340, magSize: 14, reserve: 56, reloadTime: 1.7,
    falloffStart: 12, falloffEnd: 30, falloffMin: 0.55, baseSpread: 0.005, moveSpread: 0.02,
    bloomPerShot: 0.004, bloomMax: 0.025, recoilPitch: 0.012, mobility: 1.1,
    desc: 'The defenders\' standard sidearm.',
  }),
};

export const SWAP_TIME = 0.4;   // seconds before a newly drawn weapon can fire

/** A weapon state holds the drawn gun plus the stowed one in `other` (slot 0 = primary, 1 = secondary). */
export function createWeaponState(primaryId = 'rifle', secondaryId = 'sidekick') {
  const p = WEAPONS[primaryId] || WEAPONS.rifle, s = WEAPONS[secondaryId] || WEAPONS.sidekick;
  return {
    id: p.id, ammo: p.magSize, reserve: p.reserve, cooldown: 0, reload: 0, bloom: 0, trigger: false,
    slot: 0, other: { id: s.id, ammo: s.magSize, reserve: s.reserve },
  };
}

export function copyWeaponState(ws) {
  return { ...ws, other: ws.other ? { ...ws.other } : null };
}

/**
 * Advance the weapon by one input. Returns true when a shot is fired this step.
 * input.wsel (1 = primary, 2 = secondary) is the slot the player wants drawn;
 * changing it swaps guns, which takes SWAP_TIME before the new one can fire.
 */
export function stepWeapon(ws, input, dt) {
  if (input.wsel && ws.other && input.wsel - 1 !== ws.slot) {
    const stowed = { id: ws.id, ammo: ws.ammo, reserve: ws.reserve };
    ws.id = ws.other.id; ws.ammo = ws.other.ammo; ws.reserve = ws.other.reserve;
    ws.other = stowed;
    ws.slot = input.wsel - 1;
    ws.reload = 0;
    ws.bloom = 0;
    ws.cooldown = SWAP_TIME;
    ws.trigger = true;   // a held trigger doesn't fire a semi-automatic gun the moment it is drawn
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

/** Walking speed multiplier for the gun that is drawn. */
export const gunMobility = (ws) => WEAPONS[ws?.id]?.mobility ?? 1;

// ---------------------------------------------------------------- stat bars (menus)

// Full-bar values for each stat. Bars are drawn so a fuller bar is always better.
const STAT_SCALE = { damage: 120, rpm: 950, range: 90, mag: 60, reload: [1.2, 4.4], mobility: [0.82, 1.12] };
const clamp01 = (v) => Math.max(0, Math.min(1, v));

/** Rows for a gun's hover card: [{ label, text, frac }]. */
export function weaponStats(w) {
  const dmg = w.damage * w.pellets;
  const [rLo, rHi] = STAT_SCALE.reload, [mLo, mHi] = STAT_SCALE.mobility;
  return [
    { label: 'Damage', text: w.pellets > 1 ? `${w.damage} × ${w.pellets}` : `${w.damage}`, frac: clamp01(dmg / STAT_SCALE.damage) },
    { label: 'Fire rate', text: `${w.rpm} rpm`, frac: clamp01(w.rpm / STAT_SCALE.rpm) },
    { label: 'Range', text: `${w.falloffStart}-${w.falloffEnd} m`, frac: clamp01(w.falloffEnd / STAT_SCALE.range) },
    { label: 'Magazine', text: `${w.magSize}`, frac: clamp01(w.magSize / STAT_SCALE.mag) },
    { label: 'Reload', text: `${w.reloadTime.toFixed(1)} s`, frac: clamp01((rHi - w.reloadTime) / (rHi - rLo)) },
    { label: 'Mobility', text: `${Math.round(w.mobility * 100)}%`, frac: clamp01((w.mobility - mLo) / (mHi - mLo)) },
  ];
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
