// Utilities: the extra throwable or placeable every operator carries. Each
// operator offers two (see operators.js) and the player picks one before each
// round. Not to be confused with the operator's own F ability.
//
//   kind      'thrown' (flies, bounces, goes off) or 'placed' (stuck to a surface)
//   charges   how many the player starts the round with
// Numbers for how each one behaves live in UTIL_STATS.

import { raycastWorld } from './raycast.js';

export const UTILITIES = {
  claymore: {
    id: 'claymore', name: 'Claymore', kind: 'placed', charges: 2,
    desc: 'Stick it to a surface. After a moment it arms and shoots out three thin laser tripwires. It blasts when an enemy walks into one. Walls and props cut the lines short, and enemies can see the lines and shoot the claymore.',
  },
  flash: {
    id: 'flash', name: 'Flash grenade', kind: 'thrown', charges: 2,
    desc: 'Bursts after a short fuse and blinds enemies who can see it. Looking away shortens the effect.',
  },
  impact: {
    id: 'impact', name: 'Impact grenade', kind: 'thrown', charges: 2,
    desc: 'Explodes the instant it hits something. A small blast that hurts enemies and smashes barricades.',
  },
  smoke: {
    id: 'smoke', name: 'Smoke grenade', kind: 'thrown', charges: 2,
    desc: 'Pops into a thick cloud that blocks sight for a while. Fills doorways and covers pushes.',
  },
  frag: {
    id: 'frag', name: 'Frag grenade', kind: 'thrown', charges: 2,
    desc: 'Bounces, then explodes after a short fuse. A big blast; walls block it, so cook it round a corner.',
  },
};

export const UTIL_STATS = {
  frag: { speed: 13, fuse: 2.2, radius: 5.5, damage: 95, minDamage: 0.2, barricade: 2, panels: 1.3 },
  impact: { speed: 17, fuse: 4, radius: 3.2, damage: 60, minDamage: 0.3, barricade: 1.6, panels: 0.8 },
  flash: { speed: 14, fuse: 1.4, radius: 10, duration: 3.2, awayScale: 0.4 },
  smoke: { speed: 12, fuse: 1.1, radius: 3.6, duration: 12 },
  claymore: {
    arm: 1.2,          // seconds before it is live
    wire: 2,           // length of each tripwire (m)
    fanDeg: 16,        // the left and right lines are angled this far from the middle one
    lineHeight: 0.12,  // lines sit this far above the point it was stuck to
    touch: 0.4,        // an enemy within this distance of a line (in the floor plane) sets it off
    blastRange: 3.4,   // the blast reaches enemies in front of the claymore up to this far
    reach: 3,          // the blast kills outright, so there is no damage number
    hitHalf: [0.16, 0.1, 0.16],   // box that bullets and melee must hit to destroy it
  },
  cooldown: 0.8,          // seconds between uses
};

export const UTILITY_IDS = Object.keys(UTILITIES);

/**
 * The three tripwires of a claymore, each stopped by the first thing in its way
 * (walls, props, shields, barricades). Shared so the server's trigger and the
 * lines everyone sees are the same. Returns [{ from, to, len }].
 */
export function claymoreLines(world, pos, dir) {
  const C = UTIL_STATS.claymore;
  const from = [pos[0], pos[1] + C.lineHeight, pos[2]];
  const out = [];
  for (const deg of [-C.fanDeg, 0, C.fanDeg]) {
    const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
    const d = [dir[0] * c + dir[2] * s, 0, -dir[0] * s + dir[2] * c];
    const hit = raycastWorld(world, from, d, C.wire);
    const len = hit ? hit.t : C.wire;
    out.push({ from, to: [from[0] + d[0] * len, from[1], from[2] + d[2] * len], len });
  }
  return out;
}

// ---------------------------------------------------------------- operator abilities (Stage 16)
export const ABILITY_STATS = {
  seismic: { radius: 12, markMs: 3000, moving: 0.6 },                 // Tremor: reveal moving enemies
  fire: { speed: 12, fuse: 0.8, radius: 2.2, durationMs: 8000, tickMs: 500, tickDamage: 7 },   // Cinder: fire patch
  emp: { range: 25, radius: 10 },                                     // Surge: kill cameras and jammers
  shock: { reach: 3.5, touch: 0.8, damage: 30, slowMs: 2000, slow: 0.4, markMs: 4000 },        // Volt: floor trap
  heal: { reach: 3.5, radius: 3, hps: 5, durationMs: 10000 },         // Tonic: healing field
  sensor: { reach: 3, markMs: 3000, cooldownMs: 3000 },               // Picket: alarm lines
};
