// Utilities: the extra throwable or placeable every operator carries. Each
// operator offers two (see operators.js) and the player picks one before each
// round. Not to be confused with the operator's own F ability.
//
//   kind      'thrown' (flies, bounces, goes off) or 'placed' (stuck to a surface)
//   charges   how many the player starts the round with
// Numbers for how each one behaves live in UTIL_STATS.

export const UTILITIES = {
  claymore: {
    id: 'claymore', name: 'Claymore', kind: 'placed', charges: 2,
    desc: 'Stick it to a surface. After a moment it arms and blasts any enemy who walks into the cone in front of it.',
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
  claymore: { arm: 1.2, range: 3.4, halfAngleCos: 0.8, damage: 85, minDamage: 0.5, reach: 3 },
  cooldown: 0.8,          // seconds between uses
};

export const UTILITY_IDS = Object.keys(UTILITIES);
