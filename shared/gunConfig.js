// Gun feel: recoil, shooting effects and sound for every gun (Stage 2G). This is the file to tune.
//
// Every gun has an entry in GUN_CONFIG at the bottom: its `type` (which supplies all the defaults from
// GUN_TYPES) and, optionally, `recoil: {...}` and/or `sound: {...}` with only the numbers that differ.
// gunTuning(id) gives the merged result. Change a number, save, and reload the page.
//
// ---------------------------------------------------------------- RECOIL (angles in DEGREES)
// What moves your aim (the bullets go where the view points, so pulling the mouse down cancels it):
//   up                climb of the first shot
//   upGrowth          the climb per shot grows by this much (0.8 = 80% more) over the first `growShots` shots
//   side              sideways kick per shot. Its direction follows the gun's own pattern (the same every
//                     time, so it can be learned); `swing` = shots before the pattern changes direction
//   jitter            random extra in any direction per shot (0 = perfectly repeatable)
//   maxClimb          once the view has climbed this far the gun stops climbing and wanders sideways instead
//   aimMul / crouchMul  multipliers while aiming down sights / crouched or prone
//   returnSpeed       how fast the view goes back down after you stop firing (per second; higher = faster)
//   returnWhileFiring the same while the trigger is held (low = the climb builds up and you must pull down)
//   resetTime         seconds without firing before the pattern starts again from the first shot
// What only moves the picture (never where the bullets go):
//   punch             a quick extra snap of the camera per shot, which springs straight back
//   shake             camera shake per shot
// The gun model in your hands (a spring: it is thrown and bounces back):
//   gunBack (metres)  thrown back towards you        gunUp     tips up (degrees)
//   gunSide           random sideways twist          gunRoll   random roll
//   gunSpring         stiffness: higher returns faster and snappier
//   gunDamping        lower = it wobbles a little before settling
// Effects:
//   casing            'rifle', 'pistol', 'shell' or 'none' (a revolver keeps its empty cases)
//   flash             muzzle flash size (1 = rifle)        flashColor  its colour
//   smoke             how much smoke drifts from the muzzle after shooting (0 = none)
//
// ---------------------------------------------------------------- SOUND
// Each gun's shot is built from layers and rendered once when the gun is first heard (client/src/gunSounds.js).
// Loudness values are relative (1 = normal), tones are in Hz, lengths in seconds.
//   crack, crackTone          the sharp supersonic crack (rifles: loud and high; pistols: small)
//   blast, blastTone, blastLength   the noisy bang itself: brighter tone = harsher, longer = bigger
//   boom, boomPitch, boomLength     the low punch you feel: lower pitch = heavier
//   mech, mechPitch           the gun's own metal action clacking, heard only up close
//   tail                      how much it echoes (indoors short and boomy, outdoors long)
//   distant                   how loud the far-away rumble is (what you hear from across the map)
//   volume                    overall loudness;  pitchVar  random pitch change per shot (so it isn't robotic)
//   after                     after each shot: 'none', 'bolt' (marksman rifle), 'pump' (shotgun), 'hammer' (revolver)
//   reload                    reload sounds: 'mag', 'smg', 'shell', 'belt', 'revolver'

export const GUN_TYPES = {
  rifle: {
    recoil: {
      up: 0.75, upGrowth: 0.8, growShots: 7, side: 0.5, swing: 9, jitter: 0.12, maxClimb: 12, aimMul: 0.75, crouchMul: 0.85,
      returnSpeed: 8, returnWhileFiring: 0.35, resetTime: 0.32, punch: 0.7, shake: 0.5,
      gunBack: 0.045, gunUp: 5, gunSide: 1.2, gunRoll: 3, gunSpring: 160, gunDamping: 15, casing: 'rifle', flash: 1, flashColor: 0xffc46b, smoke: 0.6,
    },
    sound: { crack: 0.9, crackTone: 4200, blast: 1, blastTone: 1700, blastLength: 0.11, boom: 0.8, boomPitch: 95, boomLength: 0.16, mech: 0.35, mechPitch: 1900, tail: 1, distant: 1, volume: 0.9, pitchVar: 0.05, after: 'none', reload: 'mag' },
  },
  smg: {
    recoil: {
      up: 0.45, upGrowth: 0.3, growShots: 5, side: 0.45, swing: 3, jitter: 0.3, maxClimb: 8, aimMul: 0.75, crouchMul: 0.85,
      returnSpeed: 11, returnWhileFiring: 0.6, resetTime: 0.22, punch: 0.45, shake: 0.4,
      gunBack: 0.03, gunUp: 3, gunSide: 2.5, gunRoll: 4, gunSpring: 220, gunDamping: 18, casing: 'pistol', flash: 0.75, flashColor: 0xffd27a, smoke: 0.4,
    },
    sound: { crack: 0.5, crackTone: 5200, blast: 0.8, blastTone: 2600, blastLength: 0.07, boom: 0.45, boomPitch: 140, boomLength: 0.09, mech: 0.5, mechPitch: 2600, tail: 0.7, distant: 0.7, volume: 0.8, pitchVar: 0.05, after: 'none', reload: 'smg' },
  },
  machinePistol: {
    recoil: {
      up: 0.6, upGrowth: 0.5, growShots: 5, side: 0.6, swing: 2, jitter: 0.45, maxClimb: 10, aimMul: 0.8, crouchMul: 0.9,
      returnSpeed: 12, returnWhileFiring: 0.8, resetTime: 0.2, punch: 0.5, shake: 0.45,
      gunBack: 0.03, gunUp: 5, gunSide: 3, gunRoll: 5, gunSpring: 240, gunDamping: 18, casing: 'pistol', flash: 0.65, flashColor: 0xffd27a, smoke: 0.3,
    },
    sound: { crack: 0.4, crackTone: 6000, blast: 0.75, blastTone: 3000, blastLength: 0.055, boom: 0.35, boomPitch: 170, boomLength: 0.07, mech: 0.55, mechPitch: 3000, tail: 0.6, distant: 0.6, volume: 0.75, pitchVar: 0.06, after: 'none', reload: 'smg' },
  },
  lmg: {
    recoil: {
      up: 0.4, upGrowth: 1.6, growShots: 25, side: 0.25, swing: 14, jitter: 0.1, maxClimb: 18, aimMul: 0.8, crouchMul: 0.75,
      returnSpeed: 5, returnWhileFiring: 0.25, resetTime: 0.45, punch: 0.9, shake: 0.8,
      gunBack: 0.05, gunUp: 3, gunSide: 0.8, gunRoll: 2, gunSpring: 120, gunDamping: 13, casing: 'rifle', flash: 1.3, flashColor: 0xffb85a, smoke: 1,
    },
    sound: { crack: 1, crackTone: 3600, blast: 1.1, blastTone: 1300, blastLength: 0.14, boom: 1, boomPitch: 75, boomLength: 0.2, mech: 0.5, mechPitch: 1300, tail: 1.2, distant: 1.2, volume: 1, pitchVar: 0.04, after: 'none', reload: 'belt' },
  },
  shotgun: {
    recoil: {
      up: 5.5, upGrowth: 0, growShots: 1, side: 1.2, swing: 1, jitter: 0.8, maxClimb: 30, aimMul: 0.85, crouchMul: 0.85,
      returnSpeed: 6, returnWhileFiring: 6, resetTime: 0.6, punch: 3, shake: 2.2,
      gunBack: 0.12, gunUp: 14, gunSide: 2, gunRoll: 6, gunSpring: 90, gunDamping: 10, casing: 'shell', flash: 1.6, flashColor: 0xffb04a, smoke: 1.2,
    },
    sound: { crack: 0.3, crackTone: 3000, blast: 1.3, blastTone: 1100, blastLength: 0.2, boom: 1.2, boomPitch: 60, boomLength: 0.28, mech: 0.2, mechPitch: 1200, tail: 1.4, distant: 1.3, volume: 1.05, pitchVar: 0.04, after: 'pump', reload: 'shell' },
  },
  dmr: {
    recoil: {
      up: 3.2, upGrowth: 0, growShots: 1, side: 0.5, swing: 1, jitter: 0.4, maxClimb: 25, aimMul: 0.75, crouchMul: 0.85,
      returnSpeed: 6, returnWhileFiring: 6, resetTime: 0.5, punch: 2, shake: 1.3,
      gunBack: 0.08, gunUp: 9, gunSide: 1.5, gunRoll: 3, gunSpring: 110, gunDamping: 11, casing: 'rifle', flash: 1.3, flashColor: 0xffc46b, smoke: 0.9,
    },
    sound: { crack: 1.2, crackTone: 3800, blast: 1.1, blastTone: 1400, blastLength: 0.16, boom: 1, boomPitch: 70, boomLength: 0.25, mech: 0.3, mechPitch: 1500, tail: 1.5, distant: 1.4, volume: 1.05, pitchVar: 0.03, after: 'bolt', reload: 'mag' },
  },
  pistol: {
    recoil: {
      up: 2.4, upGrowth: 0, growShots: 1, side: 0.35, swing: 1, jitter: 0.35, maxClimb: 20, aimMul: 0.8, crouchMul: 0.9,
      returnSpeed: 14, returnWhileFiring: 12, resetTime: 0.2, punch: 1.2, shake: 0.6,
      gunBack: 0.04, gunUp: 16, gunSide: 2, gunRoll: 4, gunSpring: 260, gunDamping: 20, casing: 'pistol', flash: 0.7, flashColor: 0xffd27a, smoke: 0.3,
    },
    sound: { crack: 0.35, crackTone: 5600, blast: 0.8, blastTone: 2800, blastLength: 0.06, boom: 0.45, boomPitch: 160, boomLength: 0.08, mech: 0.45, mechPitch: 3200, tail: 0.6, distant: 0.55, volume: 0.7, pitchVar: 0.05, after: 'none', reload: 'mag' },
  },
  revolver: {
    recoil: {
      up: 4.8, upGrowth: 0, growShots: 1, side: 0.6, swing: 1, jitter: 0.5, maxClimb: 25, aimMul: 0.8, crouchMul: 0.9,
      returnSpeed: 8, returnWhileFiring: 8, resetTime: 0.4, punch: 2.4, shake: 1.4,
      gunBack: 0.07, gunUp: 24, gunSide: 3, gunRoll: 6, gunSpring: 140, gunDamping: 12, casing: 'none', flash: 1.4, flashColor: 0xffb85a, smoke: 0.8,
    },
    sound: { crack: 0.6, crackTone: 4000, blast: 1.2, blastTone: 1500, blastLength: 0.15, boom: 1, boomPitch: 85, boomLength: 0.22, mech: 0.15, mechPitch: 2200, tail: 1.2, distant: 1.1, volume: 0.95, pitchVar: 0.04, after: 'hammer', reload: 'revolver' },
  },
};

// One entry per gun (stats such as damage and fire rate are in shared/weapons.js).
export const GUN_CONFIG = {
  // ---- primaries
  rifle: { type: 'rifle' },                                                                     // Vanguard AR: the reference
  ember: { type: 'rifle', recoil: { up: 0.9, upGrowth: 0.9, punch: 0.9, gunBack: 0.055 }, sound: { blastTone: 1450, boom: 0.95, boomPitch: 85 } },
  gale: { type: 'rifle', recoil: { up: 0.6, side: 0.45, swing: 6 }, sound: { crackTone: 4800, blastTone: 2000, boom: 0.65, volume: 0.85 } },
  smg: { type: 'smg' },                                                                         // Hornet SMG
  shotgun: { type: 'shotgun' },                                                                 // Breaker 12
  bastion: { type: 'lmg' },
  pulse: { type: 'smg', recoil: { up: 0.38, side: 0.55, jitter: 0.4 }, sound: { blastTone: 3000, mechPitch: 3000, volume: 0.75 } },
  longview: { type: 'dmr' },
  keystone: { type: 'rifle', recoil: { up: 1.1, upGrowth: 0.5, gunBack: 0.06, punch: 1 }, sound: { blastTone: 1400, boom: 1, boomPitch: 80, blastLength: 0.13 } },
  garrison: { type: 'rifle', recoil: { side: 0.3, swing: 12 } },
  rift: { type: 'rifle', recoil: { side: 0.4, swing: 5 }, sound: { crackTone: 4600, mechPitch: 2300 } },
  kiln: { type: 'shotgun', recoil: { up: 4, punch: 2.2, gunBack: 0.09 }, sound: { after: 'none', blastTone: 1300, volume: 1 } },
  arc: { type: 'smg', sound: { blastTone: 2800, mechPitch: 2800 } },
  livewire: { type: 'rifle', recoil: { up: 0.62, side: 0.4 }, sound: { blastTone: 2000, boom: 0.65 } },
  syringe: { type: 'smg', recoil: { up: 0.4 }, sound: { blastTone: 2700 } },
  watchman: { type: 'rifle', recoil: { up: 1, upGrowth: 0.5, gunBack: 0.055 }, sound: { blastTone: 1450, boom: 0.95, boomPitch: 82 } },
  // ---- secondaries
  sidekick: { type: 'pistol' },
  sidewinder: { type: 'revolver' },
  sting: { type: 'machinePistol' },
  anvil: { type: 'pistol', recoil: { up: 3.2, gunUp: 20, punch: 1.6 }, sound: { blastTone: 2200, boom: 0.65, boomPitch: 120, volume: 0.8 } },
  needle: { type: 'pistol', recoil: { up: 1.8, gunUp: 12 }, sound: { blastTone: 3300, boom: 0.3, volume: 0.6 } },
  gavel: { type: 'revolver', recoil: { up: 6.5, gunUp: 30, punch: 3.2, shake: 1.8 }, sound: { blast: 1.35, boom: 1.2, boomPitch: 70, volume: 1.05 } },
  zap: { type: 'pistol', sound: { blastTone: 3000 } },
  peep: { type: 'pistol', recoil: { up: 2.1 } },
  trowel: { type: 'revolver', recoil: { up: 4.2 } },
  holdout: { type: 'pistol' },
  tick: { type: 'machinePistol', sound: { blastTone: 3200 } },
  pyre: { type: 'revolver', sound: { blastTone: 1350 } },
  jolt: { type: 'pistol', sound: { blastTone: 2600 } },
  static: { type: 'pistol', sound: { mechPitch: 3500 } },
  dose: { type: 'pistol', recoil: { up: 2.2 } },
  chirp: { type: 'pistol', recoil: { up: 2 }, sound: { blastTone: 3200, volume: 0.65 } },
};

const cache = new Map();

/** { type, recoil, sound } for a gun with its type's defaults filled in (an unknown gun counts as a rifle). */
export function gunTuning(id) {
  let t = cache.get(id);
  if (!t) {
    const c = GUN_CONFIG[id] || { type: 'rifle' };
    const base = GUN_TYPES[c.type] || GUN_TYPES.rifle;
    t = { id, type: c.type, recoil: { ...base.recoil, ...c.recoil }, sound: { ...base.sound, ...c.sound } };
    cache.set(id, t);
  }
  return t;
}

// What a bullet hit is made of, from the kind of box it struck: 'wood', 'metal', 'concrete' or 'glass'.
// Destructible wall panels are wood and plaster, so they count as wood.
const SURFACES = {
  panel: 'wood', barricade: 'wood', furniture: 'wood', crate: 'wood', pallet: 'wood', hatch: 'wood', stairs: 'wood',
  armor: 'metal', car: 'metal', barrel: 'metal', rail: 'metal', barrier: 'metal', shield: 'metal',
  glass: 'glass', window: 'glass',
};
export const surfaceOf = (kind) => SURFACES[kind] || 'concrete';
