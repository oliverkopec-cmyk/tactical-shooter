// The player models (Stage O), built from many small shapes in code. Each body part is one merged shape with its
// colours in the vertices, shared by every player on the same operator, so a detailed body costs about 15 draw calls
// (the old blocky one was 25) and very little memory. The low version (far away, or the Low graphics setting) has the
// same parts in far fewer triangles and without the small details.
//
// Each part hangs from its joint: an arm or leg part runs down -y from its joint, the front of the body is -z.
// The sizes here are what client/src/avatars.js poses, and they stay inside the hitboxes in shared/raycast.js.

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { OPERATORS } from '../../shared/operators.js';
import { TEAM_COLORS } from '../../shared/constants.js';
import { LOOKS } from './operatorLooks.js';

export const LIMBS = { upperArm: 0.29, foreArm: 0.3, thigh: 0.42, shin: 0.38, ankle: 0.08 };

const BOOT = 0x17191c, SOLE = 0x0b0c0d, STRAP = 0x1b1d20, STEEL = 0x8a9098, GLOVE = 0x1e2024, BRASS = 0xc8a040, WHITE = 0xece8e0, RED = 0xc8202c;

const color = new THREE.Color(), other = new THREE.Color();
function mix(a, b, t) { return color.setHex(a).lerp(other.setHex(b), t).getHex(); }
const shade = (c, f) => { color.setHex(c).multiplyScalar(f); return color.getHex(); };

/** All the triangles of one body part. */
class Part {
  constructor(low) { this.low = low; this.pos = []; this.norm = []; this.col = []; this.idx = []; this.count = 0; }

  add(geo, m, hex) {
    const p = geo.attributes.position, n = geo.attributes.normal, idx = geo.index;
    const v = new THREE.Vector3(), nm = new THREE.Matrix3().getNormalMatrix(m), base = this.count;
    if (!geo.boundingBox) geo.computeBoundingBox();
    const y0 = geo.boundingBox.min.y, span = Math.max(1e-4, geo.boundingBox.max.y - y0);
    color.setHex(hex);
    const { r, g, b } = color;
    for (let i = 0; i < p.count; i++) {
      // A little darker towards the bottom of each shape, so the shapes read without textures
      const f = 0.86 + 0.14 * ((p.getY(i) - y0) / span);
      v.fromBufferAttribute(p, i).applyMatrix4(m);
      this.pos.push(v.x, v.y, v.z);
      v.fromBufferAttribute(n, i).applyMatrix3(nm).normalize();
      this.norm.push(v.x, v.y, v.z);
      this.col.push(r * f, g * f, b * f);
    }
    if (idx) for (let i = 0; i < idx.count; i++) this.idx.push(base + idx.getX(i));
    else for (let i = 0; i < p.count; i++) this.idx.push(base + i);
    this.count += p.count;
    geo.dispose();
  }

  place(x, y, z, o) {
    return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(o.rx || 0, o.ry || 0, o.rz || 0)), new THREE.Vector3(o.sx || 1, o.sy || 1, o.sz || 1));
  }

  /** A box. o.r: rounded corners. o.fine: left out of the low version. */
  box(w, h, d, x, y, z, hex, o = {}) {
    if (o.fine && this.low) return;
    const geo = o.r && !this.low ? new RoundedBoxGeometry(w, h, d, 1, Math.min(o.r, Math.min(w, h, d) * 0.49)) : new THREE.BoxGeometry(w, h, d);
    this.add(geo, this.place(x, y, z, o), hex);
  }

  /** A cylinder along y, r0 at the top and r1 at the bottom. */
  cyl(r0, r1, h, x, y, z, hex, o = {}) {
    if (o.fine && this.low) return;
    this.add(new THREE.CylinderGeometry(r0, r1, h, this.low ? 6 : o.seg || 12, 1, !!o.open), this.place(x, y, z, o), hex);
  }

  /** A sphere, stretched by sx, sy, sz. theta: only the top part of it, as a fraction (a dome). */
  sph(r, x, y, z, hex, o = {}) {
    if (o.fine && this.low) return;
    this.add(new THREE.SphereGeometry(r, this.low ? 7 : o.seg || 14, this.low ? 5 : 10, 0, Math.PI * 2, 0, Math.PI * (o.theta || 1)), this.place(x, y, z, o), hex);
  }

  /** A ring around y, for straps round a limb and hat brims. */
  ring(r, t, x, y, z, hex, o = {}) {
    if (o.fine && this.low) return;
    this.add(new THREE.TorusGeometry(r, t, this.low ? 4 : 6, this.low ? 8 : 16), this.place(x, y, z, { rx: Math.PI / 2, ...o }), hex);
  }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.norm, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.count > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    return g;
  }
}

// ---------------------------------------------------------------- the head

function buildHead(H, L, P) {
  const skin = L.skin, A = P.accent, hat = P.suit, dark = P.web;
  const hairy = !['balaclava'].includes(L.face);
  // Skull, jaw and neck end; the face looks towards -z
  H.sph(0.122, 0, 0.008, 0, hairy ? skin : dark, { sy: 1.12, sz: 1.04 });
  H.sph(0.09, 0, -0.07, -0.022, hairy ? skin : dark, { sy: 0.84, sz: 0.95 });
  H.cyl(0.058, 0.066, 0.1, 0, -0.14, 0.01, skin);
  if (hairy) {
    H.sph(0.021, 0, -0.012, -0.123, shade(skin, 0.94), { sy: 1.25, fine: true, seg: 8 });                 // nose
    for (const s of [-1, 1]) {
      H.sph(0.024, s * 0.122, 0.0, 0.005, shade(skin, 0.9), { sx: 0.5, sy: 1.3, fine: true, seg: 8 });    // ears
      if (L.face === 'none' || L.face === 'halfmask') {
        H.sph(0.014, s * 0.046, 0.022, -0.112, 0x1a1412, { sy: 0.7, fine: true, seg: 8 });                // eyes
        H.box(0.046, 0.009, 0.01, s * 0.046, 0.044, -0.112, 0x2a1c14, { fine: true });                    // brows
      }
    }
    H.box(0.052, 0.008, 0.012, 0, -0.058, -0.104, shade(skin, 0.62), { fine: true });                     // mouth
  }
  // Hair under anything that doesn't cover it
  const hair = [0x2a1c12, 0x1a1a1c, 0x5a3a1e, 0x8a6a3a][Math.round((skin % 97) / 32) % 4];
  if (L.head === 'headset' || L.head === 'bandana') H.sph(0.127, 0, 0.022, 0.008, hair, { theta: 0.52, sy: 1.08 });

  // ---------------------------------------------------------------- headgear
  const lamp = () => { H.box(0.03, 0.022, 0.018, 0, 0.1, -0.15, 0x2a2c30, { fine: true }); };
  const shellHelmet = (c, r = 0.158) => {
    H.sph(r, 0, 0.018, 0.004, c, { theta: 0.56, sz: 1.08 });
    H.box(r * 1.5, 0.018, 0.03, 0, 0.018, -r * 1.02, shade(c, 0.75), { r: 0.006 });                        // rim
    for (const s of [-1, 1]) {
      H.box(0.012, 0.03, 0.09, s * r * 0.99, 0.03, -0.01, STRAP, { fine: true });                          // side rails
      H.box(0.012, 0.13, 0.02, s * 0.118, -0.07, 0.02, STRAP, { fine: true, rz: s * 0.1 });                // chin strap
    }
    H.box(0.09, 0.014, 0.1, 0, 0.17, 0.0, shade(c, 1.2), { fine: true, rx: 0.1 });                         // top ridge
    H.box(0.05, 0.03, 0.012, 0, 0.09, -0.15, 0x24262a, { fine: true, rx: 0.5 });                           // front mount
    H.box(0.056, 0.03, 0.02, 0, 0.115, 0.14, A, { fine: true, rx: -0.5 });                                 // a coloured patch on the back
  };
  switch (L.head) {
    case 'helmet': shellHelmet(hat); break;
    case 'heavy':
      shellHelmet(shade(hat, 0.82), 0.165);
      for (const s of [-1, 1]) H.box(0.02, 0.1, 0.1, s * 0.145, -0.04, 0.0, shade(hat, 0.7), { r: 0.006 });   // ear guards
      H.box(0.2, 0.032, 0.022, 0, 0.09, -0.158, A, { fine: true, r: 0.006 });
      break;
    case 'cap':
    case 'backcap': {
      const way = L.head === 'cap' ? -1 : 1;
      H.sph(0.133, 0, 0.022, 0.0, hat, { theta: 0.5, sy: 0.98 });
      H.box(0.17, 0.012, 0.11, 0, 0.03, way * 0.17, shade(hat, 0.75), { rx: way * 0.12, r: 0.005 });
      H.sph(0.012, 0, 0.152, 0, A, { fine: true, seg: 8 });
      H.box(0.056, 0.04, 0.008, 0, 0.09, way * 0.122, A, { fine: true, rx: way * -0.4 });                  // badge
      break;
    }
    case 'beanie':
      H.sph(0.136, 0, 0.02, 0.004, hat, { theta: 0.55, sy: 1.1 });
      H.cyl(0.14, 0.14, 0.05, 0, 0.03, 0.004, shade(hat, 0.78));
      for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; H.box(0.006, 0.05, 0.012, Math.sin(a) * 0.141, 0.03, Math.cos(a) * 0.141, shade(hat, 0.6), { fine: true, ry: a }); }
      break;
    case 'boonie':
      H.sph(0.135, 0, 0.03, 0, hat, { theta: 0.5, sy: 0.92 });
      H.cyl(0.192, 0.195, 0.012, 0, 0.03, 0, shade(hat, 0.82), { seg: 18 });
      H.ring(0.137, 0.007, 0, 0.045, 0, A, { fine: true });
      for (const s of [-1, 1]) H.box(0.008, 0.11, 0.008, s * 0.112, -0.05, 0.0, STRAP, { fine: true, rz: s * 0.08 });
      break;
    case 'hardhat':
      H.sph(0.15, 0, 0.022, 0, A, { theta: 0.5 });
      H.cyl(0.176, 0.182, 0.012, 0, 0.022, -0.004, shade(A, 0.86), { seg: 18 });
      H.box(0.034, 0.05, 0.27, 0, 0.142, 0, shade(A, 1.08), { r: 0.012 });                                  // ridge
      H.box(0.04, 0.024, 0.024, 0, 0.1, -0.142, 0xf8f0c0, { fine: true, rx: 0.5 });                         // lamp
      lamp();
      break;
    case 'beret':
      H.sph(0.134, 0.012, 0.075, 0.006, hat, { sy: 0.42, rz: -0.22, sx: 1.08 });
      H.ring(0.126, 0.012, 0, 0.056, 0, shade(hat, 0.7), {});
      H.sph(0.016, -0.08, 0.08, -0.09, A, { fine: true, seg: 8 });                                           // badge
      H.sph(0.127, 0, 0.012, 0.015, hair, { theta: 0.5 });
      break;
    case 'ushanka':
      H.sph(0.142, 0, 0.022, 0.004, hat, { theta: 0.52, sy: 1.02 });
      H.cyl(0.154, 0.15, 0.056, 0, 0.042, 0, 0xc8b89a, { seg: 16 });                                         // fur band
      for (const s of [-1, 1]) H.box(0.03, 0.12, 0.11, s * 0.142, -0.04, 0.016, 0xc8b89a, { r: 0.012 });     // ear flaps
      H.box(0.05, 0.04, 0.012, 0, 0.066, -0.155, A, { fine: true });
      break;
    case 'medcap':
      H.cyl(0.132, 0.13, 0.09, 0, 0.09, 0, WHITE);
      H.cyl(0.134, 0.134, 0.012, 0, 0.14, 0, shade(WHITE, 0.9));
      H.box(0.044, 0.014, 0.006, 0, 0.09, -0.133, RED, { fine: true });
      H.box(0.014, 0.044, 0.006, 0, 0.09, -0.133, RED, { fine: true });
      break;
    case 'bandana':
      H.sph(0.13, 0, 0.022, 0.002, A, { theta: 0.42 });
      H.cyl(0.128, 0.128, 0.03, 0, 0.056, 0.002, shade(A, 0.8));
      H.box(0.02, 0.09, 0.012, 0.02, -0.0, 0.135, A, { rz: 0.2 });                                            // knot tails
      H.box(0.02, 0.08, 0.012, -0.02, 0.005, 0.135, shade(A, 0.82), { rz: -0.25 });
      break;
    case 'headset':
      H.ring(0.135, 0.009, 0, 0.0, 0.0, STRAP, { rx: 0, ry: Math.PI / 2 });
      for (const s of [-1, 1]) H.cyl(0.042, 0.042, 0.03, s * 0.129, 0.004, 0.006, 0x24262a, { rz: Math.PI / 2 });
      H.box(0.008, 0.008, 0.1, 0.112, -0.04, -0.07, STRAP, { fine: true, ry: -0.3 });                         // mic
      H.sph(0.012, 0.09, -0.056, -0.115, A, { fine: true, seg: 8 });
      break;
    case 'hood':
      H.sph(0.15, 0, 0.012, 0.018, hat, { sy: 1.1, sz: 1.02 });
      H.box(0.05, 0.1, 0.03, 0, -0.1, 0.12, shade(hat, 0.75), { fine: true });
      break;
    default:
  }

  // ---------------------------------------------------------------- the face
  const lens = H.lens;
  const strap = () => { H.cyl(0.13, 0.13, 0.03, 0, 0.022, 0.004, STRAP, { fine: true, open: true }); };
  switch (L.face) {
    case 'goggles':
      strap();
      H.box(0.2, 0.066, 0.05, 0, 0.022, -0.106, 0x202226, { r: 0.018 });
      for (const s of [-1, 1]) lens.sph(0.03, s * 0.046, 0.022, -0.13, 0, { sx: 1.25, sz: 0.5, seg: 10 });
      break;
    case 'gasmask':
      H.sph(0.098, 0, -0.03, -0.044, 0x24272b, { sy: 1.1, sz: 0.96 });
      H.cyl(0.046, 0.05, 0.075, 0, -0.078, -0.13, 0x2e3136, { rx: Math.PI / 2 });                              // filter
      H.cyl(0.051, 0.051, 0.012, 0, -0.078, -0.17, STEEL, { rx: Math.PI / 2, fine: true });
      for (const s of [-1, 1]) {
        lens.sph(0.031, s * 0.05, 0.022, -0.117, 0, { sz: 0.45, seg: 10 });
        H.ring(0.032, 0.006, s * 0.05, 0.022, -0.118, 0x34373c, { rx: 0, fine: true });
      }
      strap();
      break;
    case 'balaclava':
      H.box(0.15, 0.03, 0.01, 0, 0.02, -0.118, shade(L.skin, 0.95), {});                                       // the eye slit
      for (const s of [-1, 1]) H.sph(0.012, s * 0.04, 0.02, -0.122, 0x101010, { fine: true, seg: 8 });
      break;
    case 'visor':
      lens.sph(0.135, 0, 0.0, -0.016, 0, { theta: 0.62, rx: -Math.PI / 2 - 0.1, sy: 1.0, sz: 1.08, seg: 14 });
      H.box(0.24, 0.014, 0.1, 0, 0.066, -0.09, 0x24262a, { r: 0.006 });
      break;
    case 'shades':
      for (const s of [-1, 1]) lens.box(0.05, 0.03, 0.008, s * 0.042, 0.022, -0.117, 0, { r: 0.005 });
      H.box(0.1, 0.008, 0.008, 0, 0.032, -0.118, 0x141414, {});
      for (const s of [-1, 1]) H.box(0.006, 0.008, 0.12, s * 0.118, 0.028, -0.055, 0x141414, { fine: true });
      break;
    case 'halfmask':
      H.sph(0.095, 0, -0.058, -0.03, 0x2a2d31, { sy: 0.78 });
      H.cyl(0.024, 0.026, 0.03, 0.06, -0.075, -0.102, A, { rx: Math.PI / 2, rz: 0, fine: true });
      H.cyl(0.024, 0.026, 0.03, -0.06, -0.075, -0.102, A, { rx: Math.PI / 2, fine: true });
      H.cyl(0.13, 0.13, 0.016, 0, -0.03, 0.0, STRAP, { fine: true, open: true });
      break;
    case 'welder':
      H.box(0.2, 0.15, 0.024, 0, 0.1, -0.125, 0x2a2c30, { rx: -0.55, r: 0.012 });                               // flipped up
      lens.box(0.11, 0.05, 0.008, 0, 0.105, -0.142, 0, { rx: -0.55 });
      H.box(0.15, 0.04, 0.03, 0, 0.022, -0.116, 0x24262a, { r: 0.01 });
      for (const s of [-1, 1]) lens.sph(0.018, s * 0.04, 0.022, -0.13, 0, { sz: 0.5, seg: 8 });
      break;
    case 'nvg':
      for (const s of [-1, 1]) {
        H.cyl(0.024, 0.026, 0.08, s * 0.034, 0.05, -0.15, 0x1b1d20, { rx: Math.PI / 2 });
        lens.cyl(0.021, 0.021, 0.006, s * 0.034, 0.05, -0.192, 0, { rx: Math.PI / 2 });
      }
      H.box(0.1, 0.03, 0.04, 0, 0.08, -0.125, 0x24262a, { r: 0.008 });
      strap();
      break;
    default:
  }
}

// ---------------------------------------------------------------- the torso: from the hips up to the neck

function pouch(T, w, h, x, y, z, c, flap) {
  T.box(w, h, 0.042, x, y, z, c, { r: 0.008 });
  T.box(w * 1.04, h * 0.3, 0.046, x, y + h * 0.36, z, flap, { fine: true, r: 0.006 });
  T.box(w * 0.2, 0.012, 0.008, x, y + h * 0.2, z - 0.024, BRASS, { fine: true });
}

function buildTorso(T, L, P) {
  const { suit, vest, web, accent: A, team } = P;
  const wide = L.build === 'heavy' ? 1.04 : L.build === 'lean' ? 0.94 : 1;
  // The body under the kit
  T.box(0.33 * wide, 0.24, 0.2, 0, 0.13, 0, suit, { r: 0.05 });
  T.box(0.4 * wide, 0.3, 0.235, 0, 0.36, 0, suit, { r: 0.07 });
  for (const s of [-1, 1]) T.sph(0.085, s * 0.2 * wide, 0.455, 0, suit, { sy: 0.8 });
  T.cyl(0.07, 0.078, 0.06, 0, 0.535, 0.006, shade(suit, 0.72));                                  // collar

  if (L.vest === 'plate' || L.vest === 'heavy') {
    const h = L.vest === 'heavy';
    T.box(0.385 * wide, 0.355, 0.262, 0, 0.31, 0, vest, { r: 0.05 });
    T.box(0.3 * wide, 0.25, 0.028, 0, 0.36, -0.138, shade(vest, 1.16), { r: 0.012 });            // front plate
    T.box(0.3 * wide, 0.25, 0.028, 0, 0.36, 0.138, shade(vest, 1.1), { r: 0.012 });              // back plate
    for (const s of [-1, 1]) {
      T.box(0.07, 0.03, 0.27, s * 0.135, 0.5, 0, web, { r: 0.008 });                              // shoulder straps
      T.box(0.03, 0.1, 0.2, s * 0.195 * wide, 0.23, 0, shade(web, 1.2), { r: 0.008 });            // the band round the waist
    }
    for (let i = 0; i < 3; i++) T.box(0.3 * wide, 0.009, 0.006, 0, 0.3 + i * 0.05, -0.154, shade(web, 1.3), { fine: true });   // webbing rows
    if (h) {
      T.box(0.14, 0.11, 0.05, 0, 0.1, -0.128, vest, { r: 0.012 });                                // groin flap
      T.cyl(0.095, 0.112, 0.07, 0, 0.525, 0.006, vest, {});                                       // high collar
      for (const s of [-1, 1]) T.box(0.09, 0.05, 0.17, s * 0.232, 0.487, 0, shade(vest, 1.2), { r: 0.018, rz: s * -0.42 });   // pauldrons
      for (const s of [-1, 1]) T.box(0.05, 0.22, 0.08, s * 0.206, 0.28, -0.04, shade(vest, 1.1), { r: 0.01 });   // side armour
    }
  } else if (L.vest === 'rig') {
    for (const s of [-1, 1]) {
      T.box(0.055, 0.42, 0.012, s * 0.1, 0.32, -0.124, web, { rz: s * 0.09 });
      T.box(0.055, 0.42, 0.012, s * 0.1, 0.32, 0.123, web, { rz: s * -0.09 });
      T.box(0.055, 0.02, 0.25, s * 0.122, 0.505, 0, web, {});
    }
    T.box(0.34 * wide, 0.06, 0.226, 0, 0.17, 0, web, { r: 0.012 });
    T.box(0.32 * wide, 0.15, 0.03, 0, 0.21, -0.116, vest, { r: 0.012 });
  } else if (L.vest === 'apron') {
    T.box(0.38 * wide, 0.5, 0.02, 0, 0.21, -0.13, vest, { r: 0.008 });                            // long leather apron
    T.box(0.32 * wide, 0.28, 0.02, 0, 0.33, 0.13, shade(vest, 0.85), { r: 0.008 });
    for (const s of [-1, 1]) T.box(0.05, 0.016, 0.27, s * 0.12, 0.5, 0, web, {});
    T.box(0.36, 0.028, 0.23, 0, 0.21, 0, web, {});
    for (let i = 0; i < 2; i++) T.box(0.34 * wide, 0.006, 0.004, 0, 0.1 + i * 0.26, -0.142, shade(vest, 1.4), { fine: true });
  } else {   // medic
    T.box(0.37 * wide, 0.34, 0.25, 0, 0.32, 0, WHITE, { r: 0.05 });
    T.box(0.19, 0.17, 0.012, 0, 0.36, -0.13, vest, { r: 0.01 });
    T.box(0.11, 0.032, 0.006, 0, 0.36, -0.138, RED, {});
    T.box(0.032, 0.11, 0.006, 0, 0.36, -0.138, RED, {});
    for (const s of [-1, 1]) T.box(0.06, 0.02, 0.26, s * 0.13, 0.5, 0, web, {});
  }

  // A team-coloured flash on the chest, and a stripe of the operator's colour over the shoulder
  T.box(0.07, 0.03, 0.006, -0.1, 0.47, -0.14, team, {});
  T.box(0.08, 0.018, 0.006, 0.09, 0.46, -0.14, A, { fine: true });

  // What is carried on the front
  const pz = -0.165, py = 0.195;
  if (L.chest === 'mags') {
    for (const x of [-0.1, 0, 0.1]) { pouch(T, 0.082, 0.13, x, py, pz, web, shade(web, 1.3)); T.box(0.05, 0.02, 0.02, x, py + 0.075, pz, 0x2a2c30, { fine: true }); }
  } else if (L.chest === 'grenades') {
    for (const x of [-0.1, -0.03, 0.04, 0.11]) { T.sph(0.034, x, py + 0.01, pz, A === P.accent && x < 0 ? shade(A, 0.8) : 0x3a3f36, { sy: 1.25, seg: 10 }); T.box(0.014, 0.02, 0.014, x, py + 0.055, pz, STEEL, { fine: true }); }
  } else if (L.chest === 'charges') {
    for (const x of [-0.08, 0.08]) { T.box(0.13, 0.085, 0.034, x, py, pz, 0x3a3f36, { r: 0.006 }); T.box(0.1, 0.018, 0.038, x, py, pz, A, { fine: true }); T.box(0.014, 0.014, 0.04, x + 0.04, py + 0.03, pz, 0xff3a2a, { fine: true }); }
  } else if (L.chest === 'tools') {
    pouch(T, 0.1, 0.12, -0.08, py, pz, web, shade(web, 1.3));
    T.box(0.1, 0.09, 0.03, 0.08, py - 0.01, pz, 0x24262a, { r: 0.006 });
    T.box(0.074, 0.05, 0.006, 0.08, py, pz - 0.018, A, { fine: true });
    T.box(0.014, 0.12, 0.014, 0.0, py + 0.03, pz, STEEL, { fine: true, rz: 0.2 });
  } else if (L.chest === 'med') {
    for (const x of [-0.1, 0.1]) { pouch(T, 0.09, 0.11, x, py, pz, WHITE, shade(WHITE, 0.82)); T.box(0.03, 0.01, 0.004, x, py - 0.012, pz - 0.022, RED, { fine: true }); T.box(0.01, 0.03, 0.004, x, py - 0.012, pz - 0.022, RED, { fine: true }); }
    for (const x of [-0.015, 0.015]) T.cyl(0.011, 0.011, 0.09, x, py + 0.02, pz, 0x88e0f0, { fine: true, seg: 6 });
  } else {   // wires: a spool or a little box with a coil of wire
    T.box(0.12, 0.08, 0.034, -0.08, py, pz, 0x24262a, { r: 0.008 });
    T.box(0.05, 0.016, 0.006, -0.08, py + 0.012, pz - 0.018, A, { fine: true });
    T.cyl(0.044, 0.044, 0.036, 0.09, py, pz, A, { rx: Math.PI / 2 });
    T.cyl(0.018, 0.018, 0.04, 0.09, py, pz, 0x24262a, { rx: Math.PI / 2, fine: true });
  }

  // ---------------------------------------------------------------- what is on the back
  const bz = 0.166;
  switch (L.back) {
    case 'radio':
      T.box(0.15, 0.2, 0.05, 0, 0.32, bz, 0x24262a, { r: 0.012 });
      T.box(0.09, 0.03, 0.006, 0, 0.38, bz + 0.027, A, { fine: true });
      for (let i = 0; i < 3; i++) T.sph(0.008, -0.04 + i * 0.04, 0.32, bz + 0.027, STEEL, { fine: true, seg: 6 });
      T.cyl(0.004, 0.006, 0.32, 0.055, 0.56, bz, 0x111214, { fine: true, seg: 5 });
      T.sph(0.01, 0.055, 0.72, bz, A, { fine: true, seg: 6 });
      break;
    case 'pack':
      T.box(0.27, 0.3, 0.055, 0, 0.3, bz, P.web, { r: 0.02 });
      T.box(0.27, 0.08, 0.06, 0, 0.45, bz, shade(P.web, 1.25), { r: 0.02 });
      T.box(0.2, 0.09, 0.012, 0, 0.23, bz + 0.03, A, { fine: true, r: 0.004 });
      break;
    case 'tanks':
      for (const s of [-1, 1]) {
        T.cyl(0.042, 0.042, 0.3, s * 0.06, 0.34, bz, A, { seg: 12 });
        T.sph(0.042, s * 0.06, 0.49, bz, shade(A, 0.8), { seg: 10 });
        T.cyl(0.014, 0.014, 0.03, s * 0.06, 0.535, bz, STEEL, { fine: true, seg: 6 });
      }
      T.box(0.2, 0.024, 0.04, 0, 0.3, bz, STRAP, { fine: true });
      T.cyl(0.008, 0.008, 0.46, 0.15, 0.25, 0.09, 0x141414, { fine: true, seg: 5, rx: 0.5, rz: -0.2 });   // the hose
      break;
    case 'medbag':
      T.box(0.27, 0.27, 0.052, 0, 0.32, bz, WHITE, { r: 0.018 });
      T.box(0.13, 0.04, 0.008, 0, 0.32, bz + 0.027, RED, {});
      T.box(0.04, 0.13, 0.008, 0, 0.32, bz + 0.027, RED, {});
      break;
    case 'coil':
      T.box(0.2, 0.24, 0.05, 0, 0.32, bz, 0x24262a, { r: 0.012 });
      for (let i = 0; i < 4; i++) T.ring(0.058, 0.01, 0, 0.26 + i * 0.04, bz + 0.022, A, { rx: Math.PI / 2, fine: i > 1 });
      T.box(0.03, 0.014, 0.006, 0.07, 0.42, bz + 0.027, 0xff3a2a, { fine: true });
      break;
    case 'spool':
      T.cyl(0.095, 0.095, 0.05, 0, 0.33, bz, 0x4a4438, { rx: Math.PI / 2 });
      T.ring(0.066, 0.016, 0, 0.33, bz + 0.012, 0x8a8e94, { rx: 0 });
      T.ring(0.046, 0.012, 0, 0.33, bz + 0.012, shade(A, 0.8), { rx: 0, fine: true });
      break;
    case 'dish':
      T.box(0.18, 0.2, 0.05, 0, 0.3, bz, 0x24262a, { r: 0.012 });
      T.cyl(0.008, 0.008, 0.18, 0.075, 0.48, bz, STEEL, { fine: true, seg: 5 });
      T.sph(0.06, 0.075, 0.6, bz, A, { rx: Math.PI / 2 + 0.5, theta: 0.3, sy: 0.7 });
      break;
    case 'tools':
      T.box(0.24, 0.24, 0.04, 0, 0.32, bz, shade(P.web, 1.2), { r: 0.012 });
      for (let i = 0; i < 4; i++) T.box(0.026, 0.2, 0.014, -0.08 + i * 0.054, 0.36, bz + 0.024, i % 2 ? STEEL : shade(A, 0.8), { fine: true });
      break;
    case 'hammer':
      T.cyl(0.015, 0.015, 0.62, 0.05, 0.26, bz - 0.006, 0x5a3a20, { rz: -0.32, seg: 6 });
      T.box(0.17, 0.08, 0.08, 0.15, 0.56, bz - 0.006, 0x4a4e54, { rz: -0.32, r: 0.01 });
      T.box(0.2, 0.024, 0.04, 0, 0.27, 0.148, STRAP, { fine: true });
      break;
    case 'camera':
      T.box(0.2, 0.22, 0.05, 0, 0.3, bz, P.web, { r: 0.012 });
      T.cyl(0.04, 0.04, 0.03, 0, 0.3, bz + 0.03, 0x141414, { rx: Math.PI / 2 });
      T.cyl(0.024, 0.024, 0.034, 0, 0.3, bz + 0.03, A, { rx: Math.PI / 2, fine: true });
      break;
    case 'charges':
      for (const x of [-0.08, 0.08]) { T.box(0.12, 0.24, 0.03, x, 0.31, bz, 0x3a3f36, { r: 0.006 }); T.box(0.09, 0.03, 0.034, x, 0.36, bz, A, { fine: true }); }
      break;
    default:
  }
}

// ---------------------------------------------------------------- hips and limbs

function buildHips(G, L, P) {
  G.box(0.325, 0.2, 0.215, 0, -0.02, 0, P.suit, { r: 0.05 });
  G.box(0.345, 0.05, 0.232, 0, 0.065, 0, P.web, { r: 0.014 });
  G.box(0.05, 0.04, 0.012, 0, 0.065, -0.118, BRASS, { fine: true });
  for (const x of [-0.13, 0.13]) G.box(0.05, 0.075, 0.03, x, 0.02, -0.112, shade(P.web, 1.25), { fine: true, r: 0.006 });
  G.box(0.1, 0.07, 0.03, -0.1, 0.02, 0.116, shade(P.web, 1.25), { fine: true, r: 0.006 });
}

function buildThigh(G, side, L, P) {
  const big = L.build === 'heavy' ? 1.05 : L.build === 'lean' ? 0.93 : 1;
  G.cyl(0.088 * big, 0.066 * big, LIMBS.thigh, 0, -LIMBS.thigh / 2, 0, P.suit, { seg: 12 });
  G.box(0.03, 0.13, 0.1, side * 0.074 * big, -0.21, 0, shade(P.suit, 0.8), { r: 0.01 });        // cargo pocket
  G.box(0.033, 0.03, 0.104, side * 0.074 * big, -0.155, 0, shade(P.suit, 0.68), { fine: true });
  for (const y of [-0.1, -0.31]) G.ring(0.08 * big - (y < -0.2 ? 0.012 : 0), 0.006, 0, y, 0, P.web, { fine: true });
  if (side > 0) {
    G.box(0.05, 0.16, 0.08, 0.098, -0.17, -0.01, 0x1e2024, { r: 0.012 });                        // holster
    G.box(0.04, 0.04, 0.045, 0.098, -0.09, 0.0, 0x2a2c30, { fine: true });
  }
}

function buildShin(G, L, P) {
  const big = L.build === 'heavy' ? 1.05 : L.build === 'lean' ? 0.93 : 1;
  G.cyl(0.066 * big, 0.05, LIMBS.shin - 0.06, 0, -(LIMBS.shin - 0.06) / 2, 0, P.suit, { seg: 12 });
  // Knee pad on the front of the joint
  G.box(0.115 * big, 0.12, 0.05, 0, -0.02, -0.052 * big, P.pad, { r: 0.02 });
  G.box(0.085, 0.02, 0.054, 0, -0.03, -0.054 * big, P.accent, { fine: true });
  for (const y of [-0.095, 0.045]) G.ring(0.066 * big, 0.005, 0, y, 0, STRAP, { fine: true });
  // The boot's shaft (the foot is its own part)
  G.cyl(0.056, 0.058, 0.14, 0, -LIMBS.shin + 0.06, 0, BOOT, { seg: 12 });
  for (let i = 0; i < 3; i++) G.box(0.05, 0.007, 0.006, 0, -LIMBS.shin + 0.02 + i * 0.038, -0.056, 0x3a3c40, { fine: true });
}

function buildFoot(G, P) {
  G.box(0.1, 0.075, 0.255, 0, -0.038, -0.052, BOOT, { r: 0.028 });
  G.box(0.108, 0.018, 0.265, 0, -0.072, -0.052, SOLE, { r: 0.006 });
  G.box(0.08, 0.008, 0.09, 0, -0.002, -0.1, 0x3a3c40, { fine: true });
}

function buildUpperArm(G, side, L, P) {
  const big = L.build === 'heavy' ? 1.06 : L.build === 'lean' ? 0.93 : 1;
  G.cyl(0.056 * big, 0.047 * big, LIMBS.upperArm, 0, -LIMBS.upperArm / 2, 0, P.suit, { seg: 10 });
  G.sph(0.06 * big, 0, 0, 0, P.suit, { seg: 10 });
  // The team-coloured armband, easy to see from any side, and a patch of the operator's colour
  G.cyl(0.058 * big, 0.056 * big, 0.05, 0, -0.11, 0, P.team, { seg: 10 });
  G.box(0.015, 0.05, 0.05, side * 0.054 * big, -0.05, 0, P.accent, { fine: true });
  // Elbow pad on the outside of the joint
  G.box(0.08, 0.075, 0.04, 0, -LIMBS.upperArm + 0.012, -0.04 * big, P.pad, { r: 0.016 });
}

function buildForeArm(G, side, L, P) {
  const sleeve = L.vest === 'medic' ? P.suit : shade(P.suit, 0.92);
  G.cyl(0.046, 0.036, 0.22, 0, -0.11, 0, sleeve, { seg: 10 });
  G.cyl(0.038, 0.04, 0.04, 0, -0.2, 0, GLOVE, { seg: 8 });
  if (side < 0) G.box(0.026, 0.012, 0.042, 0.026, -0.17, 0, 0x101214, { fine: true });            // a watch
  // A gloved hand: palm, knuckles, four fingers and a thumb
  G.box(0.078, 0.085, 0.04, 0, -0.27, 0, GLOVE, { r: 0.012 });
  G.box(0.08, 0.02, 0.044, 0, -0.232, 0, shade(P.pad, 1.05), { fine: true });
  for (let i = 0; i < 4; i++) G.box(0.016, 0.05, 0.022, -0.028 + i * 0.019, -0.33, 0.004, GLOVE, { fine: true, rx: -0.5 });
  G.box(0.018, 0.05, 0.022, -side * 0.044, -0.27, -0.008, GLOVE, { fine: true, rz: side * 0.5 });
}

// ---------------------------------------------------------------- putting it together

const bodyMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.74, metalness: 0.05 });
const lensMaterials = new Map();
function lensMaterial(hex) {
  if (!lensMaterials.has(hex)) lensMaterials.set(hex, new THREE.MeshStandardMaterial({ color: mix(hex, 0x101418, 0.45), emissive: hex, emissiveIntensity: 0.32, metalness: 0.7, roughness: 0.14 }));
  return lensMaterials.get(hex);
}

const cache = new Map();

/**
 * The shapes of an operator's body, one geometry per part: { hips, torso, head, lens, upperArm: [right, left],
 * foreArm: [...], thigh: [...], shin: [...], foot: [...] }. Built once and shared by every player wearing them.
 */
export function bodyShapes(opId, team, low) {
  const key = `${opId}|${team}|${low ? 1 : 0}`;
  if (cache.has(key)) return cache.get(key);
  const L = LOOKS[opId] || LOOKS[team === 'attack' ? 'recruit_atk' : 'recruit_def'];
  const op = OPERATORS[opId];
  const accent = op?.color ?? 0xb0b6bd;
  const P = {
    accent,
    team: TEAM_COLORS[team] ?? 0xffffff,
    suit: L.suit ?? mix(accent, 0x34383c, 0.72),
    vest: L.vestColor ?? mix(accent, 0x16191d, 0.62),
    web: mix(accent, 0x101214, 0.88),
    pad: mix(accent, 0x1a1c20, 0.7),
  };
  const part = () => new Part(low);
  const H = part(); H.lens = part();
  buildHead(H, L, P);
  const T = part(); buildTorso(T, L, P);
  const G = part(); buildHips(G, L, P);
  const limb = (fn, ...extra) => [1, -1].map((side) => { const p = part(); fn(p, side, ...extra); return p.build(); });
  const out = {
    hips: G.build(), torso: T.build(), head: H.build(), lens: H.lens.count ? H.lens.build() : null, lensMaterial: lensMaterial(accent),
    upperArm: limb(buildUpperArm, L, P), foreArm: limb(buildForeArm, L, P), thigh: limb(buildThigh, L, P),
    shin: limb((p, side) => buildShin(p, L, P)), foot: limb((p, side) => buildFoot(p, P)),
  };
  cache.set(key, out);
  return out;
}

/** A mesh for a body part. Its geometry and material are shared, so nobody may dispose them. */
export function bodyMesh() {
  const m = new THREE.Mesh(undefined, bodyMaterial);
  m.castShadow = true;
  m.userData.shared = true;
  return m;
}
