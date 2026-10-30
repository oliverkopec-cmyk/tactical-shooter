// Detailed gun models, built from many small shapes in code (no external assets).
// Every model is a group of NAMED PARTS (receiver, barrel, handguard, stock, grip, trigger guard,
// magazine, optic, muzzle, rails, bolt, vents...). Each part has a ROLE that decides which skin
// colour it takes, so a skin can paint the body, the furniture, the metalwork and the sights
// differently and its pattern sits on the body parts:
//
//   body    receiver, handguard, slide, frame      -> skin.body  (and the skin's pattern)
//   accent  stock, grip, magazine, trigger guard   -> skin.accent
//   steel   barrel, muzzle, rails, bolt, hammer    -> skin.steel (metal parts)
//   trim    sights, optics housing, vents          -> skin.trim  (glows on bright skins)
//   lens    glass                                  -> never changes
//
// The guns are original designs. Models point down -z. gun.userData holds the muzzle, a charm
// anchor, and the moving parts (bolt / pump / magazine / cylinder) that animateGun() drives.

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { WEAPONS } from '../../shared/weapons.js';
import { SKINS } from '../../shared/skins.js';

const STEEL = 0x2b2f35, TRIM = 0x14161a, LENS = 0x66c8ff;

const ROLE = {
  receiver: 'body', handguard: 'body', slide: 'body', frame: 'body', cover: 'body', shroud: 'body',
  stock: 'accent', grip: 'accent', magazine: 'accent', triggerGuard: 'accent', foregrip: 'accent', pump: 'accent', buttpad: 'accent', cheek: 'accent', belt: 'accent',
  barrel: 'steel', muzzle: 'steel', rail: 'steel', bolt: 'steel', hammer: 'steel', cylinder: 'steel', bipod: 'steel', tube: 'steel', trigger: 'steel', ring: 'steel',
  sight: 'trim', optic: 'trim', vent: 'trim', port: 'trim', serration: 'trim', chamber: 'trim',
  lens: 'lens',
};

const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const rbox = (w, h, d, r = 0.006) => new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2.2, h / 2.2, d / 2.2));
const cyl = (r, len, seg = 12) => new THREE.CylinderGeometry(r, r, len, seg).rotateX(Math.PI / 2);   // along z
const cone = (r0, r1, len, seg = 12) => new THREE.CylinderGeometry(r1, r0, len, seg).rotateX(Math.PI / 2);

/** Small deterministic random numbers so a gun's variants and a skin's pattern look the same everywhere. */
export function seeded(text) {
  let a = 0;
  for (let i = 0; i < text.length; i++) a = (a * 31 + text.charCodeAt(i)) >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

class Builder {
  constructor(w) {
    this.w = w;
    this.g = new THREE.Group();
    this.mats = {};
    this.parts = {};
    this.rand = seeded(w.id);
  }

  material(role) {
    if (this.mats[role]) return this.mats[role];
    const w = this.w;
    const base = { body: w.color, accent: w.accent, steel: STEEL, trim: TRIM, lens: LENS }[role];
    const m = new THREE.MeshStandardMaterial({ color: base, roughness: role === 'steel' ? 0.45 : 0.6, metalness: role === 'steel' ? 0.75 : 0.3 });
    if (role === 'lens') { m.transparent = true; m.opacity = 0.75; m.emissive.setHex(0x1a5a8a); m.emissiveIntensity = 0.6; m.metalness = 0.9; m.roughness = 0.1; }
    this.mats[role] = m;
    return m;
  }

  /** Add a named part. `parent` defaults to the gun; positions are in the parent's space. */
  add(name, geo, x, y, z, { parent = this.g, rot = null, role = ROLE[name.split('.')[0]] || 'steel' } = {}) {
    const m = new THREE.Mesh(geo, this.material(role));
    m.position.set(x, y, z);
    if (rot) m.rotation.set(...rot);
    m.name = name;
    m.userData.part = name;
    m.userData.role = role;
    parent.add(m);
    (this.parts[name] ||= []).push(m);
    return m;
  }

  /** A group that moves as one (magazine, bolt, slide). */
  group(name, x, y, z) {
    const grp = new THREE.Group();
    grp.name = name;
    grp.position.set(x, y, z);
    grp.userData.base = grp.position.clone();
    this.g.add(grp);
    return grp;
  }
}

// ---------------------------------------------------------------- shared pieces

/** A picatinny-style rail: a base strip with small teeth. */
function addRail(b, len, x, y, z, parent) {
  b.add('rail.base', box(0.026, 0.008, len), x, y, z, { parent });
  const n = Math.max(3, Math.floor(len / 0.034));
  for (let i = 0; i < n; i++) b.add('rail.tooth', box(0.03, 0.007, 0.012), x, y + 0.007, z - len / 2 + (i + 0.5) * (len / n), { parent });
}

/** Vent slots down both sides of a handguard or shroud. */
function addVents(b, n, len, half, y, z, h = 0.022) {
  for (let i = 0; i < n; i++) {
    const zz = z - len / 2 + (i + 0.5) * (len / n);
    for (const s of [-1, 1]) b.add('vent.slot', box(0.003, h, 0.016), s * (half + 0.0005), y, zz);
  }
}

/** Trigger guard (a loop of thin bars) and the trigger. */
function addTrigger(b, y, z, parent = b.g) {
  b.add('triggerGuard.bottom', box(0.007, 0.006, 0.07), 0, y - 0.03, z, { parent });
  b.add('triggerGuard.front', box(0.007, 0.034, 0.006), 0, y - 0.014, z - 0.034, { parent });
  b.add('triggerGuard.back', box(0.007, 0.034, 0.006), 0, y - 0.014, z + 0.034, { parent });
  b.add('trigger', box(0.006, 0.026, 0.008), 0, y - 0.012, z - 0.006, { parent, rot: [0.25, 0, 0] });
}

function addMuzzle(b, kind, z, r, y = 0) {
  if (kind === 0) {            // flash hider: a short sleeve with prongs
    b.add('muzzle.sleeve', cyl(r * 1.35, 0.045), 0, y, z - 0.02);
    for (const a of [0, 1, 2, 3]) b.add('muzzle.prong', box(0.008, 0.008, 0.03), Math.cos(a * Math.PI / 2) * r * 1.5, y + Math.sin(a * Math.PI / 2) * r * 1.5, z - 0.05);
  } else if (kind === 1) {     // compensator: slotted block
    b.add('muzzle.comp', cyl(r * 1.6, 0.05), 0, y, z - 0.025);
    for (const dz of [-0.012, 0.004]) b.add('muzzle.slot', box(r * 3.4, 0.005, 0.006), 0, y + r * 1.6, z - 0.03 - dz, { role: 'trim' });
  } else {                     // suppressor: a long can
    b.add('muzzle.can', cyl(r * 1.9, 0.16), 0, y, z - 0.07);
    b.add('muzzle.cap', cyl(r * 1.0, 0.012), 0, y, z - 0.153, { role: 'trim' });
  }
}

function addOptic(b, kind, y, z, scale = 1, postY = y) {
  if (kind === 0) {            // red dot: base, hood and a glowing lens
    b.add('optic.base', box(0.03, 0.012, 0.07 * scale), 0, y + 0.006, z);
    b.add('optic.hood', box(0.034, 0.034, 0.012), 0, y + 0.03, z + 0.03 * scale);
    b.add('optic.hood', box(0.034, 0.008, 0.06 * scale), 0, y + 0.051, z);
    b.add('optic.side', box(0.004, 0.034, 0.06 * scale), -0.015, y + 0.03, z);
    b.add('optic.side', box(0.004, 0.034, 0.06 * scale), 0.015, y + 0.03, z);
    b.add('lens.dot', box(0.026, 0.026, 0.003), 0, y + 0.03, z - 0.03 * scale, { rot: [0.1, 0, 0] });
  } else if (kind === 1) {     // scope: tube with two rings, lenses and turrets
    b.add('optic.tube', cyl(0.02 * scale, 0.19 * scale), 0, y + 0.03, z);
    b.add('optic.bell', cone(0.02 * scale, 0.028 * scale, 0.04 * scale), 0, y + 0.03, z - 0.105 * scale);
    b.add('lens.front', new THREE.CircleGeometry(0.026 * scale, 14), 0, y + 0.03, z - 0.126 * scale);
    b.add('lens.rear', new THREE.CircleGeometry(0.017 * scale, 12).rotateY(Math.PI), 0, y + 0.03, z + 0.096 * scale);
    for (const dz of [-0.05, 0.05]) b.add('ring.mount', box(0.016, 0.026, 0.014), 0, y + 0.01, z + dz * scale);
    b.add('optic.turret', box(0.012, 0.012, 0.012), 0, y + 0.03 + 0.02 * scale + 0.005, z);
    b.add('optic.turret', box(0.012, 0.012, 0.012), 0.02 * scale + 0.005, y + 0.03, z);
  } else {                     // iron sights: a rear notch and a front post
    b.add('sight.rear', box(0.026, 0.02, 0.008), 0, y + 0.012, z + 0.06);
    b.add('sight.rearNotch', box(0.006, 0.014, 0.01), 0, y + 0.016, z + 0.06, { role: 'lens' });
    b.add('sight.post', box(0.006, 0.026, 0.008), 0, postY + 0.014, z - 0.14);
    b.add('sight.hood', box(0.018, 0.006, 0.01), 0, postY + 0.028, z - 0.14);
  }
}

/** Magazine: a main body, a baseplate and feed lips. */
function addMagazine(b, x, y, z, w, h, d, { curve = 0.12, parent } = {}) {
  const mag = b.group('magazine', x, y, z);
  b.add('magazine.body', box(w, h, d), 0, -h / 2, 0, { parent: mag, rot: [curve, 0, 0] });
  b.add('magazine.plate', box(w * 1.12, 0.01, d * 1.08), 0, -h + Math.sin(curve) * 0.0, Math.sin(curve) * h * 0.5, { parent: mag, rot: [curve, 0, 0] });
  b.add('magazine.rib', box(w * 0.5, h * 0.7, 0.003), 0, -h * 0.55, -d / 2 - 0.0015, { parent: mag, rot: [curve, 0, 0], role: 'trim' });
  return mag;
}

// ---------------------------------------------------------------- the models

function buildRifle(b, v) {
  b.add('receiver.main', rbox(0.062, 0.09, 0.30), 0, 0, 0.02);
  b.add('receiver.dustCover', rbox(0.05, 0.02, 0.2), 0, 0.05, 0.05);
  addRail(b, 0.28, 0, 0.054, 0.02);
  b.add('port.eject', box(0.003, 0.025, 0.07), 0.0325, 0.012, 0.05);
  b.add('handguard.main', rbox(0.056, 0.078, 0.27), 0, 0.004, -0.265);
  addVents(b, 4, 0.22, 0.028, 0.004, -0.27, 0.03);
  addRail(b, 0.2, 0, 0.049, -0.28);
  b.add('handguard.cap', box(0.05, 0.07, 0.012), 0, 0.004, -0.404, { role: 'steel' });
  b.add('barrel.main', cyl(0.0125, 0.12), 0, 0.004, -0.46);
  b.add('barrel.gas', box(0.02, 0.028, 0.03), 0, 0.034, -0.42);
  addMuzzle(b, v.muzzle, -0.52, 0.0125, 0.004);
  b.add('stock.tube', rbox(0.044, 0.07, 0.21, 0.012), 0, -0.012, 0.275);
  b.add('stock.pad', box(0.05, 0.1, 0.018), 0, -0.012, 0.388);
  b.add('stock.cheek', box(0.04, 0.012, 0.12), 0, 0.03, 0.275, { role: 'accent' });
  b.add('grip.main', rbox(0.034, 0.1, 0.042, 0.008), 0, -0.088, 0.115, { rot: [0.32, 0, 0] });
  addTrigger(b, -0.045, 0.045);
  const mag = addMagazine(b, 0, -0.04, -0.045, 0.034, 0.15, 0.052, { curve: 0.14 });
  const bolt = b.group('bolt', 0.038, 0.022, 0.0);
  b.add('bolt.handle', box(0.014, 0.012, 0.04), 0, 0, 0, { parent: bolt });
  b.add('bolt.knob', box(0.02, 0.012, 0.012), 0.006, 0, 0.018, { parent: bolt });
  addOptic(b, v.optic, 0.058, v.optic === 1 ? 0.0 : -0.04, 1);
  b.anim = { bolt, boltTravel: 0.04, mag };
  b.muzzleAt = [0, 0.004, -0.545 - (v.muzzle === 2 ? 0.1 : 0)];
  b.anchorAt = [-0.034, 0.0, -0.2];
}

function buildSmg(b, v) {
  b.add('receiver.main', rbox(0.06, 0.085, 0.27), 0, 0, 0.01);
  addRail(b, 0.22, 0, 0.048, 0.02);
  b.add('port.eject', box(0.003, 0.022, 0.06), 0.0305, 0.01, 0.03);
  b.add('shroud.main', rbox(0.05, 0.062, 0.14), 0, 0.008, -0.2);
  addVents(b, 5, 0.12, 0.025, 0.008, -0.2, 0.02);
  b.add('barrel.main', cyl(0.011, 0.1), 0, 0.01, -0.31);
  addMuzzle(b, v.muzzle, -0.36, 0.011, 0.01);
  b.add('stock.wire', box(0.006, 0.006, 0.14), 0.02, 0.012, 0.22);
  b.add('stock.wire', box(0.006, 0.006, 0.14), -0.02, 0.012, 0.22);
  b.add('stock.rear', box(0.05, 0.07, 0.012), 0, 0.012, 0.295);
  b.add('stock.brace', box(0.04, 0.006, 0.05), 0, 0.012, 0.15, { role: 'steel' });
  b.add('grip.main', rbox(0.032, 0.095, 0.04, 0.008), 0, -0.085, 0.1, { rot: [0.3, 0, 0] });
  b.add('foregrip.vertical', rbox(0.026, 0.07, 0.03, 0.006), 0, -0.05, -0.17);
  addTrigger(b, -0.042, 0.04);
  const mag = addMagazine(b, 0, -0.042, -0.03, 0.028, 0.16, 0.04, { curve: 0.04 });
  const bolt = b.group('bolt', 0.034, 0.02, -0.02);
  b.add('bolt.handle', box(0.012, 0.012, 0.035), 0, 0, 0, { parent: bolt });
  addOptic(b, v.optic === 1 ? 0 : v.optic, 0.052, -0.02, 0.9, 0.038);
  b.anim = { bolt, boltTravel: 0.03, mag };
  b.muzzleAt = [0, 0.01, -0.37 - (v.muzzle === 2 ? 0.1 : 0)];
  b.anchorAt = [-0.032, 0.0, -0.14];
}

function buildShotgun(b, v) {
  b.add('receiver.main', rbox(0.066, 0.088, 0.25), 0, 0, 0.02);
  b.add('port.eject', box(0.003, 0.026, 0.08), 0.034, 0.012, 0.05);
  b.add('port.loader', box(0.04, 0.003, 0.06), 0, -0.045, 0.02);
  b.add('barrel.main', cyl(0.0205, 0.5), 0, 0.018, -0.36);
  b.add('barrel.rib', box(0.01, 0.006, 0.5), 0, 0.04, -0.36);
  b.add('tube.mag', cyl(0.0155, 0.38), 0, -0.016, -0.3);
  b.add('tube.cap', cyl(0.019, 0.014), 0, -0.016, -0.495, { role: 'steel' });
  const pump = b.group('pump', 0, -0.016, -0.26);
  b.add('pump.main', rbox(0.056, 0.05, 0.16, 0.012), 0, 0, 0, { parent: pump });
  for (let i = 0; i < 5; i++) b.add('serration.groove', box(0.058, 0.004, 0.006), 0, -0.02, -0.06 + i * 0.03, { parent: pump });
  addMuzzle(b, v.muzzle === 2 ? 0 : v.muzzle, -0.62, 0.0205, 0.018);
  b.add('sight.bead', box(0.007, 0.012, 0.007), 0, 0.048, -0.6);
  b.add('stock.main', rbox(0.05, 0.1, 0.26, 0.014), 0, -0.012, 0.27, { rot: [0.1, 0, 0] });
  b.add('buttpad.main', box(0.054, 0.115, 0.016), 0, -0.02, 0.4, { rot: [0.1, 0, 0] });
  b.add('grip.main', rbox(0.036, 0.09, 0.04, 0.008), 0, -0.08, 0.11, { rot: [0.28, 0, 0] });
  addTrigger(b, -0.044, 0.05);
  for (let i = 0; i < 4; i++) b.add('belt.shell', cyl(0.009, 0.034), -0.037, 0.022, 0.1 - i * 0.026, { role: 'accent' });
  const bolt = b.group('bolt', 0.036, 0.02, 0.0);
  b.add('bolt.handle', box(0.012, 0.012, 0.03), 0, 0, 0, { parent: bolt });
  addOptic(b, v.optic === 1 ? 2 : v.optic, 0.046, -0.02, 0.9);
  b.anim = { bolt, boltTravel: 0.02, pump, pumpTravel: 0.07 };
  b.muzzleAt = [0, 0.018, -0.67];
  b.anchorAt = [-0.036, 0.0, -0.06];
}

function buildLmg(b, v) {
  b.add('receiver.main', rbox(0.09, 0.11, 0.42), 0, 0, 0.02);
  b.add('cover.feed', rbox(0.08, 0.03, 0.22), 0, 0.068, -0.02, { rot: [0.04, 0, 0] });
  addRail(b, 0.2, 0, 0.088, 0.0);
  b.add('port.eject', box(0.003, 0.03, 0.09), 0.0455, 0.012, 0.07);
  b.add('shroud.main', rbox(0.07, 0.07, 0.24), 0, 0.012, -0.32);
  addVents(b, 6, 0.2, 0.035, 0.012, -0.32, 0.034);
  b.add('barrel.main', cyl(0.016, 0.2), 0, 0.016, -0.54);
  for (let i = 0; i < 4; i++) b.add('barrel.fin', cyl(0.021, 0.008), 0, 0.016, -0.48 - i * 0.03);
  addMuzzle(b, v.muzzle, -0.64, 0.016, 0.016);
  b.add('ring.carry', box(0.01, 0.05, 0.012), 0.02, 0.075, -0.4, { role: 'steel' });
  b.add('ring.carry', box(0.01, 0.05, 0.012), -0.02, 0.075, -0.4, { role: 'steel' });
  b.add('ring.carryTop', box(0.05, 0.01, 0.012), 0, 0.1, -0.4, { role: 'steel' });
  for (const s of [-1, 1]) b.add('bipod.leg', box(0.006, 0.006, 0.12), s * 0.03, -0.045, -0.46, { rot: [-0.2, 0, 0] });
  b.add('bipod.mount', box(0.07, 0.014, 0.02), 0, -0.032, -0.42);
  b.add('stock.main', rbox(0.06, 0.12, 0.21, 0.014), 0, -0.02, 0.335);
  b.add('buttpad.main', box(0.064, 0.13, 0.016), 0, -0.02, 0.445);
  b.add('grip.main', rbox(0.04, 0.1, 0.046, 0.008), 0, -0.095, 0.16, { rot: [0.3, 0, 0] });
  b.add('foregrip.main', rbox(0.034, 0.08, 0.04, 0.008), 0, -0.06, -0.26);
  addTrigger(b, -0.055, 0.095);
  // belt-fed box magazine
  const mag = b.group('magazine', 0, -0.07, -0.03);
  b.add('magazine.box', rbox(0.09, 0.13, 0.15, 0.01), 0, -0.065, 0, { parent: mag });
  b.add('magazine.latch', box(0.092, 0.012, 0.04), 0, -0.01, 0.0, { parent: mag, role: 'steel' });
  for (let i = 0; i < 5; i++) b.add('belt.link', box(0.012, 0.016, 0.01), 0.03 - i * 0.012, 0.014 - i * 0.002, 0.0, { parent: mag });
  const bolt = b.group('bolt', 0.05, 0.03, 0.06);
  b.add('bolt.handle', box(0.016, 0.014, 0.05), 0, 0, 0, { parent: bolt });
  b.add('bolt.knob', box(0.024, 0.014, 0.014), 0.008, 0, 0.022, { parent: bolt });
  addOptic(b, v.optic === 2 ? 0 : v.optic, 0.092, 0.05, 1);
  b.anim = { bolt, boltTravel: 0.035, mag, magDrop: 0.18 };
  b.muzzleAt = [0, 0.016, -0.67 - (v.muzzle === 2 ? 0.1 : 0)];
  b.anchorAt = [-0.05, 0.0, -0.2];
}

function buildDmr(b, v) {
  b.add('receiver.main', rbox(0.058, 0.088, 0.34), 0, 0, 0.04);
  addRail(b, 0.32, 0, 0.052, 0.03);
  b.add('port.eject', box(0.003, 0.022, 0.06), 0.03, 0.014, 0.06);
  b.add('handguard.main', rbox(0.046, 0.066, 0.3), 0, 0.002, -0.28);
  addVents(b, 5, 0.24, 0.023, 0.002, -0.28, 0.026);
  addRail(b, 0.22, 0, 0.04, -0.3);
  b.add('barrel.main', cyl(0.0105, 0.16), 0, 0.002, -0.52);
  addMuzzle(b, v.muzzle === 2 ? 1 : v.muzzle, -0.6, 0.0105, 0.002);
  b.add('stock.main', rbox(0.046, 0.1, 0.24, 0.014), 0, -0.016, 0.34, { rot: [0.05, 0, 0] });
  b.add('buttpad.main', box(0.05, 0.11, 0.016), 0, -0.016, 0.465);
  b.add('cheek.rest', box(0.04, 0.02, 0.13), 0, 0.044, 0.34);
  b.add('grip.main', rbox(0.034, 0.1, 0.04, 0.008), 0, -0.088, 0.14, { rot: [0.3, 0, 0] });
  addTrigger(b, -0.044, 0.07);
  const mag = addMagazine(b, 0, -0.04, -0.03, 0.03, 0.09, 0.05, { curve: 0.05 });
  for (const s of [-1, 1]) b.add('bipod.leg', box(0.005, 0.005, 0.1), s * 0.024, -0.042, -0.4, { rot: [-0.25, 0, 0] });
  const bolt = b.group('bolt', 0.034, 0.026, 0.05);
  b.add('bolt.handle', box(0.012, 0.012, 0.04), 0, 0, 0, { parent: bolt });
  b.add('bolt.knob', box(0.022, 0.014, 0.014), 0.006, 0, 0.02, { parent: bolt });
  addOptic(b, 1, 0.054, -0.01, 1.35);          // the marksman rifle always has a long scope
  b.anim = { bolt, boltTravel: 0.05, mag };
  b.muzzleAt = [0, 0.002, -0.65];
  b.anchorAt = [-0.028, 0.0, -0.2];
}

function buildPistol(b, v) {
  // Slide moves on firing: it is the 'bolt'
  const slide = b.group('bolt', 0, 0.032, -0.02);
  b.add('slide.main', rbox(0.04, 0.046, 0.2, 0.008), 0, 0, 0, { parent: slide });
  for (let i = 0; i < 4; i++) for (const s of [-1, 1]) b.add('serration.groove', box(0.002, 0.034, 0.004), s * 0.0205, 0, 0.065 + i * 0.011, { parent: slide });
  b.add('port.eject', box(0.002, 0.016, 0.04), 0.0205, 0.012, -0.01, { parent: slide });
  b.add('sight.rear', box(0.026, 0.01, 0.01), 0, 0.027, 0.085, { parent: slide });
  b.add('sight.front', box(0.008, 0.012, 0.01), 0, 0.027, -0.09, { parent: slide });
  b.add('frame.main', rbox(0.036, 0.03, 0.17, 0.006), 0, 0.0, -0.01);
  b.add('frame.rail', box(0.03, 0.008, 0.05), 0, -0.012, -0.075, { role: 'steel' });
  b.add('barrel.tip', cyl(0.0095, 0.02), 0, 0.032, -0.118);
  b.add('grip.main', rbox(0.038, 0.1, 0.055, 0.008), 0, -0.058, 0.06, { rot: [0.16, 0, 0] });
  b.add('grip.panel', box(0.002, 0.07, 0.04), 0.0195, -0.058, 0.06, { rot: [0.16, 0, 0], role: 'trim' });
  addTrigger(b, -0.016, 0.0);
  const mag = b.group('magazine', 0, -0.1, 0.075);
  b.add('magazine.body', box(0.03, 0.09, 0.044), 0, 0.045, -0.008, { parent: mag, rot: [0.16, 0, 0] });
  b.add('magazine.plate', box(0.04, 0.012, 0.058), 0, 0.0, 0, { parent: mag, rot: [0.16, 0, 0] });
  b.add('hammer.main', box(0.008, 0.016, 0.01), 0, 0.044, 0.078);
  b.anim = { bolt: slide, boltTravel: 0.05, mag, magDrop: 0.12 };
  b.muzzleAt = [0, 0.032, -0.13];
  b.anchorAt = [-0.024, 0.03, -0.01];
}

function buildRevolver(b, v) {
  b.add('frame.main', rbox(0.04, 0.075, 0.17, 0.01), 0, 0.03, 0.0);
  b.add('frame.top', box(0.026, 0.01, 0.2), 0, 0.072, -0.01, { role: 'steel' });
  const cylinder = b.group('cylinder', 0, 0.03, -0.01);
  b.add('cylinder.main', cyl(0.033, 0.07, 14), 0, 0, 0, { parent: cylinder });
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    b.add('chamber.hole', cyl(0.0075, 0.072, 8), Math.cos(a) * 0.021, Math.sin(a) * 0.021, 0, { parent: cylinder });
  }
  b.add('barrel.main', cyl(0.0135, 0.22), 0, 0.052, -0.18);
  b.add('barrel.under', cyl(0.009, 0.16), 0, 0.022, -0.15);
  b.add('barrel.rib', box(0.01, 0.006, 0.2), 0, 0.068, -0.18);
  b.add('sight.front', box(0.007, 0.016, 0.01), 0, 0.075, -0.285);
  b.add('sight.rear', box(0.022, 0.012, 0.012), 0, 0.082, 0.06);
  const hammer = b.group('hammer', 0, 0.075, 0.095);
  b.add('hammer.main', box(0.012, 0.03, 0.012), 0, 0.0, 0.0, { parent: hammer, rot: [0.5, 0, 0] });
  b.add('grip.main', rbox(0.04, 0.115, 0.06, 0.012), 0, -0.04, 0.1, { rot: [0.3, 0, 0] });
  b.add('grip.panel', box(0.002, 0.08, 0.044), 0.0205, -0.04, 0.1, { rot: [0.3, 0, 0], role: 'trim' });
  addTrigger(b, 0.0, 0.03);
  b.anim = { cylinder, hammer };
  b.muzzleAt = [0, 0.052, -0.3];
  b.anchorAt = [-0.024, 0.03, -0.06];
}

function buildMachinePistol(b, v) {
  const slide = b.group('bolt', 0, 0.034, -0.03);
  b.add('slide.main', rbox(0.044, 0.05, 0.22, 0.008), 0, 0, 0, { parent: slide });
  for (let i = 0; i < 5; i++) b.add('vent.slot', box(0.046, 0.003, 0.012), 0, 0.026, -0.07 + i * 0.03, { parent: slide });
  b.add('sight.rear', box(0.026, 0.01, 0.01), 0, 0.03, 0.09, { parent: slide });
  b.add('sight.front', box(0.008, 0.012, 0.01), 0, 0.03, -0.1, { parent: slide });
  b.add('frame.main', rbox(0.038, 0.032, 0.19, 0.006), 0, 0.0, -0.02);
  b.add('barrel.tip', cyl(0.0105, 0.03), 0, 0.034, -0.145);
  addMuzzle(b, v.muzzle === 2 ? 1 : v.muzzle, -0.158, 0.0105, 0.034);
  b.add('grip.main', rbox(0.038, 0.1, 0.055, 0.008), 0, -0.058, 0.06, { rot: [0.16, 0, 0] });
  b.add('foregrip.stub', rbox(0.03, 0.04, 0.03, 0.006), 0, -0.036, -0.08);
  b.add('stock.stub', box(0.03, 0.018, 0.06), 0, 0.03, 0.15, { role: 'steel' });
  addTrigger(b, -0.016, 0.0);
  const mag = addMagazine(b, 0, -0.012, 0.0, 0.03, 0.19, 0.04, { curve: 0.02 });
  b.anim = { bolt: slide, boltTravel: 0.035, mag, magDrop: 0.14 };
  b.muzzleAt = [0, 0.034, -0.19];
  b.anchorAt = [-0.026, 0.03, -0.04];
}

const BUILDERS = { rifle: buildRifle, smg: buildSmg, shotgun: buildShotgun, lmg: buildLmg, dmr: buildDmr, pistol: buildPistol, revolver: buildRevolver, machinePistol: buildMachinePistol };

// ---------------------------------------------------------------- skins

/** Every part of a role shares one material, so a skin recolours a role in one go. */
function applySkin(b, skin, skinId) {
  const w = b.w;
  const set = (role, hex, metal, rough, glowHex = null, glow = 0) => {
    const m = b.mats[role];
    if (!m) return;
    m.color.setHex(hex);
    m.metalness = metal; m.roughness = rough;
    if (glowHex !== null && glow > 0) { m.emissive.setHex(glowHex); m.emissiveIntensity = glow; }
  };
  set('body', skin.body, 0.2 + skin.metal * 0.75, 0.65 - skin.metal * 0.4, skin.body, skin.glow * 0.5);
  set('accent', skin.accent, 0.2 + skin.metal * 0.75, 0.65 - skin.metal * 0.4, skin.accent, skin.glow * 0.5);
  set('steel', skin.steel ?? STEEL, Math.min(1, 0.6 + skin.metal * 0.35), 0.5 - skin.metal * 0.25, skin.steel ?? null, skin.steel !== undefined ? skin.glow * 0.3 : 0);
  set('trim', skin.trim ?? TRIM, 0.4, 0.5, skin.trim ?? skin.mark, skin.trim !== undefined || skin.glow > 0.3 ? 0.35 + skin.glow * 0.9 : 0);
  if (skin.pattern === 'solid') return;
  const rand = seeded(skinId + w.id);
  const bodies = [];
  b.g.traverse((o) => { if (o.isMesh && o.userData.role === 'body' && o.geometry?.parameters) bodies.push(o); });
  for (const part of bodies) decorate(part.parent, part, skin, rand);
}

/** Draw a skin's pattern as thin marks on a body part (receiver, handguard, slide...). */
function decorate(g, body, skin, rand) {
  const { width: bw, height: bh, depth: bd } = body.geometry.parameters;
  if (bd < 0.06) return;
  const markMat = new THREE.MeshStandardMaterial({
    color: skin.mark, emissive: skin.mark, emissiveIntensity: 0.25 + skin.glow * 1.3, roughness: 0.5, metalness: 0.3,
  });
  const mark = (sx, sy, sz, x, y, z) => {
    const m = new THREE.Mesh(box(sx, sy, sz), markMat);
    m.position.set(body.position.x + x, body.position.y + y, body.position.z + z);
    m.name = 'skin.mark';
    g.add(m);
  };
  const e = 0.0015, sides = [-1, 1];
  if (skin.pattern === 'stripes') {
    for (const f of [-0.3, 0, 0.3]) mark(bw + e * 2, bh + e * 2, bd * 0.05, 0, 0, f * bd);
  } else if (skin.pattern === 'camo') {
    for (let i = 0; i < 9; i++) {
      const sz = bd * (0.1 + rand() * 0.16), sy = bh * (0.2 + rand() * 0.35);
      mark(e * 2, sy, sz, sides[i % 2] * (bw / 2 + e), (rand() - 0.5) * bh * 0.5, (rand() - 0.5) * bd * 0.85);
    }
    for (let i = 0; i < 3; i++) mark(bw * (0.3 + rand() * 0.4), e * 2, bd * (0.1 + rand() * 0.15), (rand() - 0.5) * bw * 0.4, bh / 2 + e, (rand() - 0.5) * bd * 0.8);
  } else if (skin.pattern === 'circuit') {
    for (const side of sides) {
      mark(e * 2, bh * 0.06, bd * 0.86, side * (bw / 2 + e), bh * 0.22, 0);
      mark(e * 2, bh * 0.06, bd * 0.55, side * (bw / 2 + e), -bh * 0.22, bd * 0.12);
      for (let i = 0; i < 5; i++) mark(e * 2, bh * 0.4, bd * 0.03, side * (bw / 2 + e), 0, (-0.4 + i * 0.2) * bd);
    }
    mark(bw * 0.1, e * 2, bd * 0.9, 0, bh / 2 + e, 0);
  } else if (skin.pattern === 'flames') {
    for (const side of sides) {
      for (let i = 0; i < 9; i++) {
        const hgt = bh * (0.25 + rand() * 0.6);
        mark(e * 2, hgt, bd * 0.07, side * (bw / 2 + e), -bh / 2 + hgt / 2, (-0.46 + i * 0.115) * bd);
      }
    }
  } else if (skin.pattern === 'void') {
    for (let i = 0; i < 14; i++) mark(e * 2, bh * 0.07, bh * 0.07, sides[i % 2] * (bw / 2 + e), (rand() - 0.5) * bh * 0.7, (rand() - 0.5) * bd * 0.9);
    mark(bw * 0.08, e * 2, bd * 0.95, 0, bh / 2 + e, 0);
    mark(e * 2, bh * 0.05, bd * 0.95, bw / 2 + e, 0, 0);
    mark(e * 2, bh * 0.05, bd * 0.95, -(bw / 2 + e), 0, 0);
  }
}

// ---------------------------------------------------------------- the public builder

/** Variants chosen per gun so guns of one type don't all look the same: optic, muzzle device. */
function variantOf(id, model) {
  const r = seeded(`variant:${id}`);
  const optic = Math.floor(r() * 3), muzzle = Math.floor(r() * 3);
  return { optic, muzzle };
}

/** Build a gun model pointing down -z. skinId: optional, from shared/skins.js. */
export function makeGunModel(id, skinId = null) {
  const w = WEAPONS[id] || WEAPONS.rifle;
  const b = new Builder(w);
  (BUILDERS[w.model] || buildRifle)(b, variantOf(w.id, w.model));
  const muzzle = new THREE.Object3D();
  muzzle.position.set(...b.muzzleAt);
  b.g.add(muzzle);
  const anchor = new THREE.Object3D();
  anchor.position.set(...b.anchorAt);
  b.g.add(anchor);
  b.g.userData.muzzle = muzzle;
  b.g.userData.charmAnchor = anchor;
  b.g.userData.anim = b.anim || {};
  b.g.userData.parts = b.parts;
  if (skinId && SKINS[skinId]) applySkin(b, SKINS[skinId], skinId);
  if (w.scale !== 1) b.g.scale.setScalar(w.scale);
  // Pistols are short: the view model moves them forward and up so they sit in view
  b.g.userData.hold = ['pistol', 'revolver', 'machinePistol'].includes(w.model) ? [0, 0.03, -0.1] : [0, 0, 0];
  return b.g;
}

const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/**
 * Drive the moving parts: the bolt / slide / pump kick back when firing (kick 0..1+), the
 * magazine drops out and goes back in during a reload (reloadFrac 0..1, or -1 when not reloading).
 */
export function animateGun(gun, { kick = 0, reloadFrac = -1 } = {}) {
  const a = gun.userData.anim;
  if (!a) return;
  const k = Math.min(1, kick);
  if (a.bolt) a.bolt.position.z = a.bolt.userData.base.z + k * a.boltTravel;
  if (a.pump) a.pump.position.z = a.pump.userData.base.z + k * a.pumpTravel * 0.6;
  if (a.cylinder) a.cylinder.rotation.z = (1 - k) * 0.0 + k * 0.5;
  if (a.hammer) a.hammer.rotation.x = -k * 0.7;
  if (a.mag) {
    // out between 10% and 35%, held, back in between 65% and 90%
    const out = reloadFrac < 0 ? 0 : smooth(0.1, 0.35, reloadFrac) * (1 - smooth(0.65, 0.9, reloadFrac));
    const drop = a.magDrop ?? 0.16;
    a.mag.position.set(a.mag.userData.base.x, a.mag.userData.base.y - out * drop, a.mag.userData.base.z + out * 0.03);
    a.mag.rotation.x = out * 0.35;
  }
}
