// Weapon attachments (Stage P): what can go on which gun, and what each one changes. This is the file to tune.
//
// A gun's attachments are { sight, muzzle, grip, mag }, with only what differs from the gun as it comes saved. Each gun
// keeps its own, on the account (server/profile.js). The server works out magazine size, reload time, damage at range
// and aiming speed from them (gunFor in shared/weapons.js); recoil, flash and sound are client side like the rest of
// the gun's feel (gunTuning in shared/gunConfig.js). Everything is free: there is nothing to unlock.

export const SLOTS = ['sight', 'muzzle', 'grip', 'mag'];
export const SLOT_NAMES = { sight: 'Sight', muzzle: 'Muzzle', grip: 'Grip', mag: 'Magazine' };

export const ATTACHMENTS = {
  sight: {
    iron: { name: 'Iron sights', desc: 'The sights on the gun. Barely zoomed, and nothing in the way.', zoom: 1.3, view: 'iron' },
    reddot: { name: 'Red dot', desc: 'A small glowing dot, quick to find.', zoom: 1.4, view: 'dot' },
    holo: { name: 'Holographic', desc: 'A wide window with a ring and a dot, easy to track movement through.', zoom: 1.35, view: 'holo' },
    x15: { name: '1.5x scope', desc: 'A light scope for mid range.', zoom: 1.5, view: 'scope', lens: 0.92 },
    x2: { name: '2x scope', desc: 'A scope for longer lanes.', zoom: 2, view: 'scope', lens: 0.84 },
    x25: { name: '2.5x scope', desc: 'The most zoom on a normal gun, and the narrowest view.', zoom: 2.5, view: 'scope', lens: 0.76 },
    x32: { name: '3.2x long scope', desc: 'The marksman rifle\'s own long scope.', zoom: 3.2, view: 'scope', lens: 0.68 },
  },
  muzzle: {
    none: { name: 'None', desc: 'A bare muzzle.' },
    suppressor: { name: 'Suppressor', desc: 'Much quieter and almost no flash, but less damage at range.' },
    flash: { name: 'Flash hider', desc: 'A much smaller muzzle flash, so you see better and are seen less.' },
    comp: { name: 'Compensator', desc: 'Less side recoil, but a bigger flash.' },
    brake: { name: 'Muzzle brake', desc: 'Less kick on the first shot, but a bigger flash.' },
  },
  grip: {
    none: { name: 'None', desc: 'Nothing under the barrel.' },
    vertical: { name: 'Vertical grip', desc: 'Less vertical recoil.' },
    angled: { name: 'Angled grip', desc: 'Faster to aim down sights.' },
  },
  mag: {
    standard: { name: 'Standard', desc: 'The magazine the gun comes with.' },
    extended: { name: 'Extended', desc: 'More ammo, but a slower reload and slower to aim.' },
  },
};

// What makes sense on which kind of gun. The first sight of a list is not the default: a gun with no sight saved keeps
// the one it comes with (stockSight in client/src/gunModels.js).
const ON_MODEL = {
  rifle: { sight: ['iron', 'reddot', 'holo', 'x15', 'x2', 'x25'], muzzle: ['none', 'suppressor', 'flash', 'comp', 'brake'], grip: ['none', 'vertical', 'angled'], mag: ['standard', 'extended'] },
  smg: { sight: ['iron', 'reddot', 'holo', 'x15'], muzzle: ['none', 'suppressor', 'flash', 'comp', 'brake'], grip: ['none', 'vertical', 'angled'], mag: ['standard', 'extended'] },
  shotgun: { sight: ['iron', 'reddot', 'holo'], muzzle: ['none', 'flash', 'brake'], grip: [], mag: ['standard', 'extended'] },
  lmg: { sight: ['iron', 'reddot', 'holo', 'x15', 'x2', 'x25'], muzzle: ['none', 'suppressor', 'flash', 'comp', 'brake'], grip: ['none', 'vertical', 'angled'], mag: ['standard', 'extended'] },
  dmr: { sight: ['reddot', 'x15', 'x2', 'x25', 'x32'], muzzle: ['none', 'suppressor', 'flash', 'comp', 'brake'], grip: ['none', 'vertical', 'angled'], mag: ['standard', 'extended'] },
  pistol: { sight: ['iron', 'reddot'], muzzle: ['none', 'suppressor', 'comp'], grip: [], mag: ['standard', 'extended'] },
  machinePistol: { sight: ['iron', 'reddot'], muzzle: ['none', 'suppressor', 'comp'], grip: [], mag: ['standard', 'extended'] },
  revolver: { sight: [], muzzle: [], grip: [], mag: [] },
};
const NOTHING = { sight: [], muzzle: [], grip: [], mag: [] };

/** What can go on this gun: { sight: [ids], muzzle: [ids], grip: [ids], mag: [ids] }. An empty list: the slot isn't there. */
export const optionsFor = (weapon) => (weapon && !weapon.shield && ON_MODEL[weapon.model]) || NOTHING;

/** The first option of a slot is what "nothing fitted" means (except sights: see above). */
const isDefault = (slot, id) => slot !== 'sight' && ATTACHMENTS[slot][id] && id === Object.keys(ATTACHMENTS[slot])[0];

/** Only what is allowed on this gun, with defaults left out, or null if that leaves nothing. */
export function cleanAttachments(weapon, raw) {
  const allowed = optionsFor(weapon);
  const out = {};
  if (raw && typeof raw === 'object') {
    for (const slot of SLOTS) {
      const id = raw[slot];
      if (typeof id === 'string' && allowed[slot].includes(id) && !isDefault(slot, id)) out[slot] = id;
    }
  }
  return Object.keys(out).length ? out : null;
}

/** A short key for a gun's attachments, for caching models and stats. */
export const attachmentKey = (att) => (att ? SLOTS.map((s) => att[s] || '').join('.') : '');

// ---------------------------------------------------------------- what they change

/** The numbers the server and the client's prediction both use. */
export function applyAttachments(w, att) {
  if (!att) return w;
  const out = { ...w, aimTime: w.aimTime ?? 1 };
  if (att.muzzle === 'suppressor') {
    out.falloffStart = w.falloffStart * 0.75;
    out.falloffEnd = w.falloffEnd * 0.8;
    out.falloffMin = w.falloffMin * 0.85;
  }
  if (att.grip === 'angled') out.aimTime *= 0.75;
  if (att.mag === 'extended') {
    out.magSize = w.model === 'shotgun' ? w.magSize + 2 : Math.ceil(w.magSize * 1.34);
    out.reloadTime = w.reloadTime * 1.18;
    out.aimTime *= 1.14;
  }
  return out;
}

/** The feel: multiplies a gun's recoil settings from shared/gunConfig.js, and adds firstMul, the first shot's climb. */
export function applyToRecoil(rc, att) {
  const out = { ...rc, firstMul: 1 };
  if (!att) return out;
  if (att.grip === 'vertical') out.up = rc.up * 0.78;
  if (att.muzzle === 'comp') { out.side = rc.side * 0.55; out.flash = rc.flash * 1.3; }
  if (att.muzzle === 'brake') { out.firstMul = 0.6; out.punch = rc.punch * 0.75; out.flash = rc.flash * 1.3; }
  if (att.muzzle === 'flash') { out.flash = rc.flash * 0.35; }
  if (att.muzzle === 'suppressor') { out.flash = rc.flash * 0.08; out.smoke = rc.smoke * 0.5; }
  return out;
}

/** How loud the gun is, 1 being normal. Quieter for everyone who hears it, and bots hear it from less far. */
export const loudnessOf = (att) => (att?.muzzle === 'suppressor' ? 0.34 : 1);
