// Gun charm models (30, built from simple shapes in code) and the pendulum that makes them swing.
// Each model hangs from its top: the origin is where the string ties on, and the charm
// is about 4 cm tall below it. Original designs only.

import * as THREE from 'three';
import { RARITIES } from '../../shared/skins.js';
import { CHARMS } from '../../shared/charms.js';

const mats = new Map();
function mat(color, { metal = 0.3, rough = 0.55, glow = 0, opacity = 1 } = {}) {
  const key = `${color}|${metal}|${rough}|${glow}|${opacity}`;
  if (!mats.has(key)) {
    const m = new THREE.MeshStandardMaterial({ color, metalness: Math.min(metal, 0.45), roughness: rough });   // little shine: there is no environment map to reflect
    if (glow) { m.emissive.setHex(color); m.emissiveIntensity = glow; }
    if (opacity < 1) { m.transparent = true; m.opacity = opacity; }
    mats.set(key, m);
  }
  return mats.get(key);
}
const GOLD = mat(0xe6b422, { metal: 0.9, rough: 0.3 }), SILVER = mat(0xc4cad2, { metal: 0.9, rough: 0.3 }), DARK = mat(0x15171a), WHITE = mat(0xf2f2f2), RED = mat(0xd22b2b);

const m = (geo, material, x = 0, y = 0, z = 0, rot = null, scale = null) => {
  const o = new THREE.Mesh(geo, material);
  o.position.set(x, y, z);
  if (rot) o.rotation.set(...rot);
  if (scale) o.scale.set(...scale);
  return o;
};
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const cyl = (r0, r1, h, seg = 12) => new THREE.CylinderGeometry(r1, r0, h, seg);
const sph = (r, seg = 12) => new THREE.SphereGeometry(r, seg, seg);
const ring = (r, t, arc = Math.PI * 2) => new THREE.TorusGeometry(r, t, 8, 16, arc);

/** A flat shape pulled out into a thin slab: points are [x, y] pairs. */
function slab(points, depth = 0.008) {
  const s = new THREE.Shape();
  points.forEach(([x, y], i) => (i ? s.lineTo(x, y) : s.moveTo(x, y)));
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false });
  g.translate(0, 0, -depth / 2);
  return g;
}
const starPoints = (n, r0, r1) => Array.from({ length: n * 2 }, (_, i) => { const a = (i / (n * 2)) * Math.PI * 2 + Math.PI / 2, r = i % 2 ? r0 : r1; return [Math.cos(a) * r, Math.sin(a) * r]; });

/** The tie-on loop at the top of every charm. */
const eyelet = (y = 0) => m(ring(0.005, 0.0013), SILVER, 0, y, 0);

const BUILD = {
  // ---------------------------------------------------------------- common
  dog_tag(g) { g.add(m(slab([[-0.014, -0.036], [0.014, -0.036], [0.016, -0.004], [-0.016, -0.004]], 0.003), SILVER, 0, 0, 0), m(box(0.018, 0.0015, 0.004), DARK, 0, -0.02, 0.0018), m(box(0.012, 0.0015, 0.004), DARK, 0, -0.026, 0.0018), eyelet(-0.002)); },
  brass_bullet(g) { g.add(m(cyl(0.008, 0.008, 0.03), mat(0xc9a14a, { metal: 0.9, rough: 0.3 }), 0, -0.02), m(cyl(0.008, 0.002, 0.016), mat(0xb87333, { metal: 0.8, rough: 0.35 }), 0, -0.045), m(ring(0.008, 0.0008), GOLD, 0, -0.012, 0, [Math.PI / 2, 0, 0]), eyelet(0.0)); },
  dice(g) {
    g.add(m(box(0.026, 0.026, 0.026), WHITE, 0, -0.02));
    for (const [x, y, z] of [[0, 0, 1], [-0.007, 0.007, 1], [0.007, -0.007, 1]]) g.add(m(sph(0.0028, 6), DARK, x, -0.02 + y, 0.0135 * z));
    for (const [y, z] of [[0.0065, 0.0065], [-0.0065, -0.0065], [0, 0]]) g.add(m(sph(0.0028, 6), DARK, 0.0135, -0.02 + y, z));
    g.add(eyelet(-0.005));
  },
  padlock(g) { g.add(m(ring(0.009, 0.0025, Math.PI), SILVER, 0, -0.014), m(box(0.026, 0.022, 0.012), GOLD, 0, -0.03), m(box(0.004, 0.009, 0.0125), DARK, 0, -0.03)); },
  key(g) { g.add(m(ring(0.008, 0.0022), GOLD, 0, -0.008), m(box(0.004, 0.034, 0.004), GOLD, 0, -0.033), m(box(0.011, 0.004, 0.004), GOLD, 0.0055, -0.045), m(box(0.008, 0.004, 0.004), GOLD, 0.004, -0.038)); },
  gear(g) {
    g.add(m(cyl(0.013, 0.013, 0.006, 16), mat(0x7a828c, { metal: 0.9, rough: 0.4 }), 0, -0.024, 0, [Math.PI / 2, 0, 0]));
    for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; g.add(m(box(0.008, 0.008, 0.006), mat(0x7a828c, { metal: 0.9, rough: 0.4 }), Math.cos(a) * 0.0155, -0.024 + Math.sin(a) * 0.0155, 0, [0, 0, a])); }
    g.add(m(cyl(0.005, 0.005, 0.0065, 10), DARK, 0, -0.024, 0, [Math.PI / 2, 0, 0]), eyelet(0.0));
  },
  clover(g) {
    const leaf = mat(0x2fa84f, { rough: 0.7 });
    for (let i = 0; i < 4; i++) { const a = (i / 4) * Math.PI * 2 + Math.PI / 4; g.add(m(sph(0.0095, 10), leaf, Math.cos(a) * 0.0095, -0.024 + Math.sin(a) * 0.0095, 0, null, [1, 1, 0.35])); }
    g.add(m(box(0.003, 0.016, 0.003), mat(0x1f7a38), 0, -0.04, 0, [0, 0, -0.35]), eyelet(0.0), m(box(0.002, 0.008, 0.002), mat(0x1f7a38), 0, -0.006));
  },
  horseshoe(g) { g.add(m(ring(0.013, 0.0035, Math.PI * 1.5), SILVER, 0, -0.026, 0, [0, 0, Math.PI * 0.75]), eyelet(0.0)); },
  feather(g) {
    g.add(m(sph(0.01, 10), mat(0x4aa3d8, { rough: 0.8 }), 0, -0.03, 0, [0, 0, 0.15], [0.45, 2.1, 0.12]), m(box(0.0015, 0.044, 0.0025), WHITE, 0, -0.028, 0.0008, [0, 0, 0.15]), eyelet(0.0));
  },
  coin(g) { g.add(m(cyl(0.014, 0.014, 0.003, 18), GOLD, 0, -0.022, 0, [Math.PI / 2, 0, 0]), m(ring(0.0105, 0.0012), mat(0xb88a14, { metal: 0.9 }), 0, -0.022, 0.0016), m(box(0.004, 0.012, 0.0012), mat(0xb88a14, { metal: 0.9 }), 0, -0.022, 0.0018), eyelet(0.0)); },
  compass(g) {
    g.add(m(cyl(0.014, 0.014, 0.008, 18), mat(0xb08d3c, { metal: 0.9, rough: 0.35 }), 0, -0.025, 0, [Math.PI / 2, 0, 0]), m(cyl(0.011, 0.011, 0.002, 18), mat(0xeaf2f7), 0, -0.025, 0.0045, [Math.PI / 2, 0, 0]));
    g.add(m(cyl(0, 0.0025, 0.016, 4), RED, 0, -0.019, 0.0062, [0, 0, 0.5]), m(cyl(0, 0.0025, 0.016, 4), WHITE, 0, -0.031, 0.0062, [0, 0, 0.5 + Math.PI]), eyelet(0.0));
  },
  nut(g) { g.add(m(cyl(0.013, 0.013, 0.01, 6), mat(0x8b939c, { metal: 0.9, rough: 0.4 }), 0, -0.024, 0, [Math.PI / 2, 0, 0]), m(cyl(0.006, 0.006, 0.0106, 10), DARK, 0, -0.024, 0, [Math.PI / 2, 0, 0]), eyelet(-0.006)); },
  // ---------------------------------------------------------------- rare
  skull(g) {
    const bone = mat(0xeee9dc, { rough: 0.8 });
    g.add(m(sph(0.014, 14), bone, 0, -0.026, 0, null, [1, 0.95, 0.95]), m(box(0.016, 0.009, 0.014), bone, 0, -0.04), m(sph(0.0042, 8), DARK, -0.0058, -0.026, 0.012), m(sph(0.0042, 8), DARK, 0.0058, -0.026, 0.012), m(box(0.003, 0.005, 0.002), DARK, 0, -0.033, 0.0135), eyelet(-0.008));
    for (const x of [-0.0045, 0, 0.0045]) g.add(m(box(0.0016, 0.004, 0.002), DARK, x, -0.042, 0.0072));
  },
  medal(g) {
    g.add(m(box(0.008, 0.02, 0.002), RED, -0.004, -0.01, 0, [0, 0, 0.18]), m(box(0.008, 0.02, 0.002), mat(0x2a56c6), 0.004, -0.01, 0, [0, 0, -0.18]), m(cyl(0.013, 0.013, 0.003, 18), GOLD, 0, -0.034, 0, [Math.PI / 2, 0, 0]), m(slab(starPoints(5, 0.0045, 0.0105), 0.002), mat(0xfff0a0, { metal: 0.9 }), 0, -0.034, 0.002));
  },
  tiny_shield(g) { g.add(m(slab([[-0.014, -0.004], [0.014, -0.004], [0.014, -0.028], [0, -0.048], [-0.014, -0.028]], 0.005), mat(0x3a6fb0, { metal: 0.6, rough: 0.35 })), m(slab(starPoints(5, 0.0045, 0.011), 0.002), WHITE, 0, -0.022, 0.0035), eyelet(-0.002)); },
  star(g) { g.add(m(slab(starPoints(5, 0.0095, 0.021), 0.006), mat(0xf5c518, { metal: 0.85, rough: 0.3 }), 0, -0.027), eyelet(-0.004)); },
  heart(g) {
    const s = new THREE.Shape();
    s.moveTo(0, -0.018); s.bezierCurveTo(-0.03, 0.002, -0.016, 0.018, 0, 0.006); s.bezierCurveTo(0.016, 0.018, 0.03, 0.002, 0, -0.018);
    const geo = new THREE.ExtrudeGeometry(s, { depth: 0.007, bevelEnabled: false }); geo.translate(0, 0, -0.0035);
    g.add(m(geo, mat(0xe0243c, { metal: 0.4, rough: 0.3 }), 0, -0.03), eyelet(-0.005));
  },
  moon(g) {
    // outer circle minus an offset inner circle: a crescent
    const R = 0.016, r = 0.0125, d = 0.0065;
    const x0 = (R * R - r * r + d * d) / (2 * d), y0 = Math.sqrt(R * R - x0 * x0);
    const s = new THREE.Shape();
    s.moveTo(x0, y0);
    s.absarc(0, 0, R, Math.atan2(y0, x0), Math.PI * 2 - Math.atan2(y0, x0), false);
    s.absarc(d, 0, r, -Math.atan2(y0, x0 - d), Math.atan2(y0, x0 - d), true);
    const geo = new THREE.ExtrudeGeometry(s, { depth: 0.006, bevelEnabled: false }); geo.translate(0, 0, -0.003);
    g.add(m(geo, mat(0xf4e6a0, { metal: 0.5, glow: 0.35 }), 0.002, -0.026, 0, [0, 0, -0.25]), eyelet(-0.004));
  },
  mini_grenade(g) {
    const o = mat(0x4a5a34, { rough: 0.7 });
    g.add(m(sph(0.014, 12), o, 0, -0.028, 0, null, [0.85, 1.1, 0.85]), m(cyl(0.006, 0.006, 0.008), mat(0x2f3a22), 0, -0.01), m(box(0.004, 0.02, 0.003), SILVER, 0.007, -0.018, 0, [0, 0, -0.1]), m(ring(0.004, 0.0009), SILVER, -0.006, -0.008, 0, [Math.PI / 2, 0, 0]), eyelet(-0.002));
    for (const y of [-0.022, -0.03, -0.038]) g.add(m(box(0.026, 0.0014, 0.0016), mat(0x2f3a22), 0, y, 0.011));
  },
  lightning(g) { g.add(m(slab([[0.004, 0], [-0.012, -0.024], [-0.002, -0.024], [-0.008, -0.05], [0.014, -0.02], [0.003, -0.02], [0.012, 0]], 0.006), mat(0xffe033, { metal: 0.4, glow: 0.6 }), 0, 0, 0)); },
  anchor(g) {
    g.add(m(ring(0.004, 0.0013), SILVER, 0, -0.004), m(box(0.004, 0.036, 0.004), SILVER, 0, -0.026), m(box(0.018, 0.004, 0.004), SILVER, 0, -0.012), m(ring(0.013, 0.0024, Math.PI), SILVER, 0, -0.03, 0, [0, 0, Math.PI]), m(cone(0.006), SILVER, -0.013, -0.031, 0, [0, 0, 0.6]), m(cone(0.006), SILVER, 0.013, -0.031, 0, [0, 0, -0.6]));
  },
  // ---------------------------------------------------------------- epic
  crown(g) {
    g.add(m(cyl(0.013, 0.013, 0.012, 12), GOLD, 0, -0.034), m(ring(0.013, 0.0012), mat(0xffe27a, { metal: 0.9 }), 0, -0.039, 0, [Math.PI / 2, 0, 0]));
    for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2; g.add(m(cyl(0.004, 0, 0.012, 4), GOLD, Math.cos(a) * 0.011, -0.022, Math.sin(a) * 0.011), m(sph(0.0028, 6), mat(0xe0243c, { glow: 0.6 }), Math.cos(a) * 0.013, -0.033, Math.sin(a) * 0.013)); }
    g.add(eyelet(-0.014));
  },
  gem(g) { g.add(m(new THREE.OctahedronGeometry(0.016), mat(0x5ae0ff, { metal: 0.3, rough: 0.1, glow: 0.7, opacity: 0.92 }), 0, -0.03, 0, null, [0.85, 1.25, 0.85]), eyelet(-0.01)); },
  fang(g) { g.add(m(cyl(0.007, 0.0005, 0.04, 8), mat(0xf3eedd, { rough: 0.3 }), 0, -0.028, 0, [0, 0, 0.18]), m(cyl(0.0085, 0.0085, 0.008, 10), GOLD, 0.001, -0.01), m(sph(0.002, 6), mat(0xd22b2b, { glow: 0.8 }), 0, -0.01, 0.0085)); },
  orb(g) {
    g.add(m(sph(0.0155, 16), mat(0xa66bff, { metal: 0.2, rough: 0.1, glow: 0.7, opacity: 0.85 }), 0, -0.034), m(sph(0.006, 8), mat(0xffffff, { glow: 1 }), 0, -0.034), m(ring(0.011, 0.0018), GOLD, 0, -0.0485, 0, [Math.PI / 2, 0, 0]), eyelet(-0.014));
  },
  rocket(g) {
    g.add(m(cyl(0.007, 0.007, 0.034, 10), WHITE, 0, -0.03), m(cyl(0.007, 0.0005, 0.016, 10), RED, 0, -0.055), m(cyl(0.006, 0.006, 0.004, 10), mat(0x4a90e2), 0, -0.02), eyelet(-0.011));
    for (let i = 0; i < 3; i++) { const a = (i / 3) * Math.PI * 2; g.add(m(box(0.002, 0.012, 0.008), RED, Math.cos(a) * 0.009, -0.016, Math.sin(a) * 0.009, [0, -a, 0])); }
    g.add(m(cyl(0.005, 0, 0.012, 8), mat(0xffa030, { glow: 0.9 }), 0, -0.01, 0, [Math.PI, 0, 0]));
  },
  flame(g) { g.add(m(sph(0.012, 12), mat(0xff6a1a, { glow: 0.9 }), 0, -0.032, 0, null, [1, 1.1, 1]), m(cyl(0.011, 0, 0.03, 10), mat(0xff8a2a, { glow: 0.9 }), 0, -0.016), m(sph(0.0065, 10), mat(0xffe27a, { glow: 1 }), 0, -0.034, 0.003, null, [1, 1.3, 1]), eyelet(0.0)); },
  // ---------------------------------------------------------------- legendary
  polish_eagle(g) {
    // The white eagle of Poland on a red shield, in the colours of the flag, with a gold crown and beak
    const red = mat(0xdc143c, { metal: 0.3, rough: 0.35 }), white = mat(0xffffff, { rough: 0.45 });
    g.add(m(slab([[-0.02, -0.004], [0.02, -0.004], [0.02, -0.032], [0, -0.056], [-0.02, -0.032]], 0.006), red));
    g.add(m(box(0.044, 0.0035, 0.007), white, 0, -0.0055));                                     // the white upper band
    g.add(m(sph(0.0085, 10), white, 0, -0.03, 0.004, null, [0.85, 1.25, 0.5]));                // body
    g.add(m(sph(0.0048, 10), white, 0, -0.0175, 0.004));                                       // head
    g.add(m(cyl(0, 0.0018, 0.008, 6), GOLD, -0.0065, -0.0175, 0.004, [0, 0, Math.PI / 2]));    // beak
    g.add(m(sph(0.0095, 10), white, -0.0125, -0.027, 0.004, [0, 0, 0.6], [0.4, 1.7, 0.3]));    // wings
    g.add(m(sph(0.0095, 10), white, 0.0125, -0.027, 0.004, [0, 0, -0.6], [0.4, 1.7, 0.3]));
    g.add(m(cyl(0.004, 0.0015, 0.014, 6), white, 0, -0.045, 0.004));                           // tail
    g.add(m(box(0.011, 0.0028, 0.004), GOLD, 0, -0.0128, 0.004));                              // crown
    for (const x of [-0.0045, 0, 0.0045]) g.add(m(cyl(0, 0.0013, 0.004, 4), GOLD, x, -0.0098, 0.004, [Math.PI, 0, 0]));
    g.add(eyelet(0.0));
  },
  golden_dragon(g) {
    const gold = mat(0xf0b422, { metal: 0.95, rough: 0.25, glow: 0.15 });
    const h = new THREE.Group();     // the head faces the viewer (+z)
    h.add(m(box(0.022, 0.016, 0.026), gold, 0, -0.03, 0), m(box(0.014, 0.01, 0.014), gold, 0, -0.033, 0.019));
    for (const s of [-1, 1]) {
      h.add(m(cyl(0.0035, 0, 0.022, 6), gold, s * 0.009, -0.016, -0.004, [0.7, 0, s * -0.3]), m(sph(0.0028, 8), mat(0xff2a2a, { glow: 1 }), s * 0.0075, -0.026, 0.0135));
      h.add(m(cyl(0, 0.0022, 0.012, 5), mat(0xfff7d6), s * 0.005, -0.04, 0.024, [Math.PI, 0, 0]), m(slab([[0, 0], [s * 0.016, 0.006], [s * 0.012, -0.012]], 0.002), gold, s * 0.011, -0.03, 0.0));
      h.add(m(sph(0.0016, 5), DARK, s * 0.0035, -0.034, 0.0255));
    }
    g.add(h, eyelet(-0.017));
  },
  galaxy(g) {
    const orb = m(sph(0.0155, 18), mat(0x0c0a2a, { metal: 0.5, rough: 0.2, glow: 0.2 }), 0, -0.034);
    g.add(orb, m(ring(0.022, 0.0012), mat(0x9a7bff, { glow: 1 }), 0, -0.034, 0, [1.2, 0.3, 0]), m(ring(0.019, 0.001), mat(0x4ad6ff, { glow: 1 }), 0, -0.034, 0, [-0.4, 0, 0.9]), eyelet(-0.014));
    for (let i = 0; i < 4; i++) { const a = i * 1.6; g.add(m(sph(0.0016, 5), mat(0xffffff, { glow: 1 }), Math.cos(a) * 0.01, -0.034 + Math.sin(a * 1.3) * 0.011, Math.sin(a) * 0.012)); }
    g.userData.spin = [orb];
  },
};
function cone(r) { return new THREE.ConeGeometry(r, r * 1.6, 6); }

/** A charm model hanging from its tie point. */
export function makeCharmModel(id) {
  const g = new THREE.Group();
  (BUILD[id] || BUILD.coin)(g);
  g.name = `charm.${id}`;
  g.traverse((o) => { if (o.isMesh) o.castShadow = false; });
  return g;
}

/**
 * A charm on a gun: a pivot at the gun's charm anchor, a short string, and the charm. Returns a controller
 * whose update() swings it like a pendulum: gun movement and recoil push it, a spring and damping settle it.
 */
export function attachCharm(gun, charmId) {
  const anchor = gun.userData.charmAnchor;
  if (!anchor || !CHARMS[charmId]) return null;
  const pivot = new THREE.Group();
  const string = new THREE.Mesh(new THREE.CylinderGeometry(0.0007, 0.0007, 0.024, 4), mat(0x1b1b1b));
  string.position.y = -0.012;
  const charm = makeCharmModel(charmId);
  charm.scale.setScalar(1.6);
  const face = new THREE.Group();            // charms are drawn facing +z; turn them to face out of the gun's left side
  face.position.y = -0.024;
  face.rotation.y = -Math.PI / 2;
  face.add(charm);
  pivot.add(string, face);
  anchor.add(pivot);
  gun.userData.charm = new CharmSwing(pivot, charm);
  gun.userData.charmId = charmId;
  return gun.userData.charm;
}

export class CharmSwing {
  constructor(pivot, charm) {
    this.pivot = pivot;
    this.charm = charm;
    this.angle = [0, 0];       // [side to side (about z), forward and back (about x)]
    this.vel = [0.0, 0.0];
    this.t = Math.random() * 10;
    this.last = null;
    this.lastVel = null;
  }

  /** A push, in the gun's own axes (x: right, z: back), e.g. recoil kicks it forward. */
  push(x, z) { this.vel[0] += x; this.vel[1] += z; }

  /** pos: where the gun is right now (any consistent space); the change in its speed swings the charm. */
  update(dt, pos) {
    dt = Math.min(dt, 0.05);
    if (dt <= 0) return;
    this.t += dt;
    if (pos) {
      if (this.last) {
        const v = [(pos.x - this.last.x) / dt, (pos.y - this.last.y) / dt, (pos.z - this.last.z) / dt];
        if (this.lastVel) {
          const ax = (v[0] - this.lastVel[0]), az = (v[2] - this.lastVel[2]);
          this.vel[0] += -ax * 1.6;
          this.vel[1] += az * 1.6;
        }
        this.lastVel = v;
      }
      this.last = { x: pos.x, y: pos.y, z: pos.z };
    }
    const k = 120, c = 5.5;                                // spring and damping: a lively little pendulum
    for (let i = 0; i < 2; i++) {
      this.vel[i] += (-k * this.angle[i] - c * this.vel[i]) * dt;
      this.angle[i] = Math.max(-1.1, Math.min(1.1, this.angle[i] + this.vel[i] * dt));
    }
    // a faint idle sway so it never looks frozen
    this.pivot.rotation.z = this.angle[0] + Math.sin(this.t * 1.7) * 0.03;
    this.pivot.rotation.x = this.angle[1] + Math.cos(this.t * 1.3) * 0.02;
    const spin = this.charm.userData.spin;
    if (spin) for (const s of spin) s.rotation.y += dt * 0.8;
    this.charm.rotation.y = Math.sin(this.t * 0.9) * 0.25;   // turns a little on its string
  }
}

export const charmColor = (id) => RARITIES[CHARMS[id]?.rarity]?.color || '#b0b6bd';
