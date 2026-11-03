// Per-gun tuning for recoil, shooting feel and sound (Stage 2G). Everything here is meant to be edited.
//
// Every gun has an entry in GUN_CONFIG: its `type` (which fills in all the defaults from GUN_TYPES below)
// and, if you want, `recoil: {...}` and/or `sound: {...}` with just the values that differ for that gun.
// gunTuning(id) returns the merged result.
//
// RECOIL (client only; angles are radians, 0.0175 = 1 degree; the bullets follow the view, so pulling
// the mouse down while firing really does cancel the climb):
//   vertical       climb per shot                          horizontal   widest sideways kick per shot
//   ramp           extra climb reached after rampShots (0.5 = 50% more); rampShots how many shots that takes
//   sway           how much of `horizontal` follows a slow left-right drift (a pattern you can learn),
//                  swayPeriod = shots per full drift; random = how much is random (0 = none, 1 = lots)
//   ads / crouch   multipliers while aiming down sights / crouched
//   recover        how fast the view settles back to where you aimed (per second) when not firing;
//                  recoverFiring the same while the trigger is held (small = the climb builds up)
//   resetS         seconds without firing before the pattern starts again from the first shot
//   kick           how far the gun model is thrown back; kickDecay how fast it returns (per second)
//   shake          camera shake per shot (visual only, never moves the bullets)
//   casing         what is ejected: 'rifle', 'pistol', 'shell' or 'none' (a revolver keeps its cases)
//   flash          size of the muzzle flash (1 = normal)
//
// SOUND (all synthesised in client/src/audio.js; freq in Hz, decay in seconds):
//   crackFreq / crackDecay / crackGain   the sharp close "crack" of the shot
//   bodyFreq / bodyDecay / bodyGain      the noisy body of the bang (the filter sweeps down from bodyFreq)
//   thumpFreq / thumpDecay / thumpGain   the low thump (frequency falls to about 45% of thumpFreq)
//   tail                                 how much echo it makes (the reverb send; outdoors it is long and thin,
//                                        indoors short and boomy)
//   volume                               overall loudness of the gun
//   mech                                 sound after a shot: 'none', 'bolt', 'pump', 'hammer'
//   reload                               how reloading sounds: 'mag', 'pdw', 'shell', 'belt', 'revolver'

export const GUN_TYPES = {
  rifle: {
    recoil: { vertical: 0.012, ramp: 0.45, rampShots: 8, horizontal: 0.006, sway: 0.9, swayPeriod: 14, random: 0.3, ads: 0.8, crouch: 0.88, recover: 6, recoverFiring: 1.0, resetS: 0.3, kick: 1.0, kickDecay: 9, shake: 0.6, casing: 'rifle', flash: 1 },
    sound: { crackFreq: 3300, crackDecay: 0.05, crackGain: 0.55, bodyFreq: 1500, bodyDecay: 0.14, bodyGain: 0.6, thumpFreq: 130, thumpDecay: 0.1, thumpGain: 0.5, tail: 1, volume: 1, mech: 'none', reload: 'mag' },
  },
  smg: {
    recoil: { vertical: 0.0095, ramp: 0.2, rampShots: 6, horizontal: 0.011, sway: 0.5, swayPeriod: 5, random: 0.8, ads: 0.75, crouch: 0.88, recover: 9, recoverFiring: 1.4, resetS: 0.22, kick: 0.7, kickDecay: 12, shake: 0.5, casing: 'pistol', flash: 0.8 },
    sound: { crackFreq: 4300, crackDecay: 0.035, crackGain: 0.5, bodyFreq: 2300, bodyDecay: 0.08, bodyGain: 0.45, thumpFreq: 170, thumpDecay: 0.06, thumpGain: 0.3, tail: 0.6, volume: 0.9, mech: 'none', reload: 'pdw' },
  },
  machinePistol: {
    recoil: { vertical: 0.014, ramp: 0.35, rampShots: 6, horizontal: 0.013, sway: 0.4, swayPeriod: 4, random: 0.9, ads: 0.8, crouch: 0.9, recover: 10, recoverFiring: 2, resetS: 0.2, kick: 0.8, kickDecay: 13, shake: 0.5, casing: 'pistol', flash: 0.75 },
    sound: { crackFreq: 4800, crackDecay: 0.03, crackGain: 0.5, bodyFreq: 2600, bodyDecay: 0.06, bodyGain: 0.4, thumpFreq: 200, thumpDecay: 0.05, thumpGain: 0.28, tail: 0.5, volume: 0.85, mech: 'none', reload: 'pdw' },
  },
  lmg: {
    recoil: { vertical: 0.010, ramp: 0.9, rampShots: 22, horizontal: 0.005, sway: 0.5, swayPeriod: 24, random: 0.15, ads: 0.85, crouch: 0.9, recover: 4, recoverFiring: 0.7, resetS: 0.4, kick: 1.2, kickDecay: 8, shake: 0.8, casing: 'rifle', flash: 1.2 },
    sound: { crackFreq: 2700, crackDecay: 0.06, crackGain: 0.6, bodyFreq: 1100, bodyDecay: 0.2, bodyGain: 0.7, thumpFreq: 100, thumpDecay: 0.14, thumpGain: 0.65, tail: 1.2, volume: 1.15, mech: 'none', reload: 'belt' },
  },
  shotgun: {
    recoil: { vertical: 0.10, ramp: 0, rampShots: 1, horizontal: 0.015, sway: 0, swayPeriod: 1, random: 0.4, ads: 0.85, crouch: 0.9, recover: 5, recoverFiring: 3, resetS: 0.6, kick: 2.4, kickDecay: 6, shake: 2, casing: 'shell', flash: 1.5 },
    sound: { crackFreq: 2300, crackDecay: 0.07, crackGain: 0.7, bodyFreq: 800, bodyDecay: 0.26, bodyGain: 0.9, thumpFreq: 80, thumpDecay: 0.2, thumpGain: 0.85, tail: 1.4, volume: 1.2, mech: 'pump', reload: 'shell' },
  },
  dmr: {
    recoil: { vertical: 0.05, ramp: 0, rampShots: 1, horizontal: 0.01, sway: 0, swayPeriod: 1, random: 0.3, ads: 0.8, crouch: 0.88, recover: 5, recoverFiring: 3, resetS: 0.5, kick: 1.7, kickDecay: 7, shake: 1.4, casing: 'rifle', flash: 1.3 },
    sound: { crackFreq: 2800, crackDecay: 0.07, crackGain: 0.65, bodyFreq: 1000, bodyDecay: 0.22, bodyGain: 0.75, thumpFreq: 95, thumpDecay: 0.16, thumpGain: 0.7, tail: 1.4, volume: 1.15, mech: 'bolt', reload: 'mag' },
  },
  pistol: {
    recoil: { vertical: 0.034, ramp: 0, rampShots: 1, horizontal: 0.006, sway: 0, swayPeriod: 1, random: 0.35, ads: 0.8, crouch: 0.9, recover: 14, recoverFiring: 9, resetS: 0.2, kick: 1.1, kickDecay: 14, shake: 0.6, casing: 'pistol', flash: 0.7 },
    sound: { crackFreq: 4800, crackDecay: 0.03, crackGain: 0.5, bodyFreq: 2600, bodyDecay: 0.07, bodyGain: 0.4, thumpFreq: 220, thumpDecay: 0.05, thumpGain: 0.3, tail: 0.5, volume: 0.8, mech: 'none', reload: 'mag' },
  },
  revolver: {
    recoil: { vertical: 0.065, ramp: 0, rampShots: 1, horizontal: 0.01, sway: 0, swayPeriod: 1, random: 0.4, ads: 0.8, crouch: 0.9, recover: 7, recoverFiring: 5, resetS: 0.4, kick: 1.9, kickDecay: 8, shake: 1.3, casing: 'none', flash: 1.1 },
    sound: { crackFreq: 3000, crackDecay: 0.05, crackGain: 0.65, bodyFreq: 1200, bodyDecay: 0.2, bodyGain: 0.7, thumpFreq: 110, thumpDecay: 0.14, thumpGain: 0.6, tail: 1, volume: 1, mech: 'hammer', reload: 'revolver' },
  },
};

// One entry per gun (see shared/weapons.js for the stats). Add `recoil` / `sound` overrides to tune one gun.
export const GUN_CONFIG = {
  // primaries
  rifle: { type: 'rifle' },
  ember: { type: 'rifle', recoil: { vertical: 0.0145, shake: 0.8 }, sound: { bodyFreq: 1300, thumpGain: 0.6 } },
  gale: { type: 'rifle', recoil: { vertical: 0.0105, horizontal: 0.008 }, sound: { crackFreq: 3700, volume: 0.9 } },
  smg: { type: 'smg' },
  shotgun: { type: 'shotgun' },
  bastion: { type: 'lmg' },
  pulse: { type: 'smg', recoil: { vertical: 0.0085, horizontal: 0.01, random: 0.9 }, sound: { crackFreq: 4800, volume: 0.8 } },
  longview: { type: 'dmr' },
  keystone: { type: 'rifle', recoil: { vertical: 0.016, ramp: 0.3 }, sound: { bodyFreq: 1250, bodyGain: 0.7 } },
  garrison: { type: 'rifle' },
  rift: { type: 'rifle' },
  kiln: { type: 'shotgun', recoil: { vertical: 0.075, shake: 1.5 }, sound: { mech: 'none', volume: 1.1 } },
  arc: { type: 'smg' },
  livewire: { type: 'rifle', recoil: { vertical: 0.0105 } },
  syringe: { type: 'smg', recoil: { vertical: 0.0085 } },
  watchman: { type: 'rifle', recoil: { vertical: 0.014 }, sound: { bodyFreq: 1250 } },
  // secondaries
  sidekick: { type: 'pistol' },
  sidewinder: { type: 'revolver' },
  sting: { type: 'machinePistol' },
  anvil: { type: 'pistol', recoil: { vertical: 0.045, kick: 1.5 }, sound: { bodyFreq: 2000, thumpGain: 0.4, volume: 0.95 } },
  needle: { type: 'pistol', recoil: { vertical: 0.026 }, sound: { crackFreq: 5200, volume: 0.7 } },
  gavel: { type: 'revolver', recoil: { vertical: 0.085, kick: 2.3, shake: 1.6 }, sound: { thumpGain: 0.75, volume: 1.15 } },
  zap: { type: 'pistol' },
  peep: { type: 'pistol' },
  trowel: { type: 'revolver', recoil: { vertical: 0.055 } },
  holdout: { type: 'pistol' },
  tick: { type: 'machinePistol' },
  pyre: { type: 'revolver' },
  jolt: { type: 'pistol' },
  static: { type: 'pistol' },
  dose: { type: 'pistol' },
  chirp: { type: 'pistol', recoil: { vertical: 0.028 } },
};

const cache = new Map();

/** { type, recoil, sound } for a gun, with the type's defaults filled in. Unknown guns count as rifles. */
export function gunTuning(id) {
  let t = cache.get(id);
  if (!t) {
    const c = GUN_CONFIG[id] || { type: 'rifle' };
    const base = GUN_TYPES[c.type] || GUN_TYPES.rifle;
    t = { type: c.type, recoil: { ...base.recoil, ...c.recoil }, sound: { ...base.sound, ...c.sound } };
    cache.set(id, t);
  }
  return t;
}

/**
 * What a bullet hit is made of, from the kind of box it struck: 'wood', 'metal', 'concrete' or 'glass'.
 * Destructible wall panels are wood and plaster, so they count as wood.
 */
const SURFACES = {
  panel: 'wood', barricade: 'wood', furniture: 'wood', crate: 'wood', pallet: 'wood', hatch: 'wood', stairs: 'wood',
  armor: 'metal', car: 'metal', barrel: 'metal', rail: 'metal', barrier: 'metal', shield: 'metal',
  glass: 'glass', window: 'glass',
};
export const surfaceOf = (kind) => SURFACES[kind] || 'concrete';
