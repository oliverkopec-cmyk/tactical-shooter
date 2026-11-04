// The Christmas room (Stage M), shown by the Christmas tab: a cozy fireplace room at night. A stone fireplace with a
// real-looking fire, a mantel with garland, stockings and candles, a wreath, a big decorated tree with the presents
// under it, snowy windows with curtains, an armchair, a bookshelf, lamps, a rug and a sleeping cat. All built in code.
//
// The middle of the rug is the origin, so the unwrapping (giftScene.js) and the crate opening (crateScene.js) play
// here just as they do on the rooftop's platform. Everything that doesn't move is merged into one mesh per texture.
// `low` (the Low graphics setting) drops the small details, the shadows and all but the fire's light.

import * as THREE from 'three';
import { mapTexture, TEX_SCALE } from './mapTextures.js';
import { canvasTexture, haloTexture, seededRandom, TwinklingBulbs } from './menuChristmas.js';

/** Where unopened presents wait, around the foot of the tree. */
export const TREE = { x: 2.6, z: -2.0 };
export const PRESENT_SPOTS = [[1.75, -0.75], [2.5, -0.55], [3.25, -0.75], [1.45, -1.35], [2.1, 0.0], [2.9, 0.05], [3.6, -1.3], [1.4, -0.1]];

const FIRE = { x: -0.3, z: -3.4 };
const ROOM = { x: 6.6, back: -4, front: 9, ceil: 3.5 };
const ROUGH = { metal: 0.4, tiles: 0.4, carpet: 1, fabric: 0.95, stone: 0.92, brick: 0.95, wood: 0.68, plaster: 0.92, bark: 1, leaf: 0.9 };

const rnd = seededRandom(1225);
const color = new THREE.Color();

const FLAME_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const FLAME_FRAG = /* glsl */ `
uniform float uTime, uSeed;
varying vec2 vUv;
float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
float fbm(vec2 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * n(p); p = p * 2.05 + 7.3; a *= 0.5; } return s; }
void main() {
  vec2 p = vUv; float x = (p.x - 0.5) * 2.0;
  float t = uTime + uSeed * 10.0;
  // Tongues of flame: noise rushing upwards, bent sideways more the higher it gets, under a shape that narrows to the top
  float bend = (fbm(vec2(p.y * 1.6 - t * 0.5, uSeed)) - 0.5) * 0.9 * p.y;
  float q = fbm(vec2((x + bend) * 2.6 + uSeed * 3.0, p.y * 2.4 - t * 1.7));
  float width = (1.0 - p.y) * (1.0 - p.y * 0.25);
  float shape = 1.0 - abs(x + bend) / max(width, 0.001);
  float f = smoothstep(0.0, 0.62, shape + (q - 0.52) * 1.5 - p.y * 0.72);
  f *= smoothstep(0.0, 0.05, p.y);
  vec3 c = mix(vec3(0.85, 0.12, 0.01), vec3(1.0, 0.5, 0.05), smoothstep(0.05, 0.5, f));
  c = mix(c, vec3(1.0, 0.93, 0.55), smoothstep(0.5, 0.95, f));
  gl_FragColor = vec4(c * f * 1.5, f);
}`;

const SNOW_VERT = /* glsl */ `
uniform float uTime;
attribute vec3 aFlake;
void main() {
  float y = mod(aFlake.y - uTime * aFlake.z, 1.0);
  vec3 p = vec3(position.x + sin(uTime * 0.7 + aFlake.x * 30.0) * 0.03, position.y + y * 1.6, position.z);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_PointSize = (1.6 + aFlake.x * 3.2) * 7.0 / -mv.z * 1.6;
  gl_Position = projectionMatrix * mv;
}`;
const SNOW_FRAG = /* glsl */ `
void main() {
  float d = length(gl_PointCoord - 0.5);
  if (d > 0.5) discard;
  gl_FragColor = vec4(0.92, 0.96, 1.0, smoothstep(0.5, 0.1, d) * 0.9);
}`;

/** The night outside a window: deep blue sky, stars, a moon, snowy hills and pines. */
function nightTexture() {
  const r = seededRandom(77);
  return canvasTexture(256, 320, (g, w, h) => {
    const sky = g.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, '#071230'); sky.addColorStop(0.65, '#1a3a68'); sky.addColorStop(1, '#3a5f8c');
    g.fillStyle = sky;
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 70; i++) { g.fillStyle = `rgba(255,255,255,${0.3 + r() * 0.7})`; g.fillRect(r() * w, r() * h * 0.6, 1 + r(), 1 + r()); }
    const moon = g.createRadialGradient(182, 66, 2, 182, 66, 44);
    moon.addColorStop(0, 'rgba(250,246,226,1)'); moon.addColorStop(0.42, 'rgba(250,246,226,0.95)'); moon.addColorStop(0.5, 'rgba(190,210,250,0.28)'); moon.addColorStop(1, 'rgba(190,210,250,0)');
    g.fillStyle = moon;
    g.fillRect(130, 14, 104, 104);
    const hill = (y, c, amp) => {
      g.fillStyle = c;
      g.beginPath(); g.moveTo(0, h);
      for (let x = 0; x <= w; x += 8) g.lineTo(x, y + Math.sin(x * 0.03 + y) * amp);
      g.lineTo(w, h); g.fill();
    };
    const pine = (x, y, s) => {
      g.fillStyle = '#10243a';
      for (let k = 0; k < 4; k++) { g.beginPath(); g.moveTo(x, y - s + k * s * 0.2); g.lineTo(x - s * (0.18 + k * 0.08), y - s * 0.55 + k * s * 0.2); g.lineTo(x + s * (0.18 + k * 0.08), y - s * 0.55 + k * s * 0.2); g.fill(); }
      g.fillStyle = 'rgba(226,238,250,0.9)';
      for (let k = 0; k < 3; k++) { g.beginPath(); g.moveTo(x, y - s + k * s * 0.2); g.lineTo(x - s * (0.09 + k * 0.05), y - s * 0.8 + k * s * 0.2); g.lineTo(x + s * (0.09 + k * 0.05), y - s * 0.8 + k * s * 0.2); g.fill(); }
    };
    hill(208, '#6d8cb2', 9);
    for (let i = 0; i < 9; i++) pine(r() * w, 222 + r() * 10, 30 + r() * 26);
    hill(250, '#b4cce2', 7);
    for (let i = 0; i < 4; i++) pine(r() * w, 276 + r() * 10, 56 + r() * 34);
    hill(292, '#e6f0f8', 4);
  });
}

/** A small painted winter scene for a picture frame. */
function pictureTexture(seed) {
  const r = seededRandom(seed);
  return canvasTexture(128, 96, (g, w, h) => {
    const sky = g.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, seed % 2 ? '#c8875a' : '#5a7aa8'); sky.addColorStop(1, seed % 2 ? '#f0cf9a' : '#c8d8e8');
    g.fillStyle = sky;
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#f0f4f8';
    g.beginPath(); g.moveTo(0, h); g.lineTo(0, h * 0.62); g.quadraticCurveTo(w * 0.4, h * 0.45, w, h * 0.68); g.lineTo(w, h); g.fill();
    for (let i = 0; i < 6; i++) { const x = r() * w, y = h * (0.62 + r() * 0.26), s = 10 + r() * 14; g.fillStyle = '#2a4a3a'; g.beginPath(); g.moveTo(x, y - s * 1.5); g.lineTo(x - s * 0.5, y); g.lineTo(x + s * 0.5, y); g.fill(); }
    g.fillStyle = '#6a2a24'; g.fillRect(w * 0.55, h * 0.56, 22, 15);
    g.fillStyle = '#3a2420'; g.beginPath(); g.moveTo(w * 0.55 - 3, h * 0.56); g.lineTo(w * 0.55 + 11, h * 0.46); g.lineTo(w * 0.55 + 25, h * 0.56); g.fill();
    g.fillStyle = '#ffd880'; g.fillRect(w * 0.55 + 8, h * 0.6, 5, 5);
  });
}

/** Wallpaper: deep green with a faint damask of diamonds and leaves. */
function wallpaperTexture() {
  const t = canvasTexture(128, 128, (g, w, h) => {
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(0,0,0,0.13)';
    g.fillStyle = 'rgba(0,0,0,0.1)';
    g.lineWidth = 2;
    g.beginPath(); g.moveTo(64, 0); g.lineTo(128, 64); g.lineTo(64, 128); g.lineTo(0, 64); g.closePath(); g.stroke();
    for (const [x, y] of [[64, 64], [0, 0], [128, 0], [0, 128], [128, 128]]) {
      g.save(); g.translate(x, y);
      for (let k = 0; k < 4; k++) { g.rotate(Math.PI / 2); g.beginPath(); g.ellipse(0, 13, 6, 13, 0, 0, Math.PI * 2); g.fill(); }
      g.restore();
    }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** All the triangles of one material, with colour in the vertices and texture coordinates in metres. */
class Batch {
  constructor() { this.pos = []; this.norm = []; this.uv = []; this.col = []; this.idx = []; this.count = 0; }

  add(geo, matrix, hex, scale, glow = 1) {
    const p = geo.attributes.position, n = geo.attributes.normal, idx = geo.index;
    const nm = new THREE.Matrix3().getNormalMatrix(matrix), v = new THREE.Vector3(), w = new THREE.Vector3();
    color.setHex(hex);
    const base = this.count;
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(matrix);
      w.fromBufferAttribute(n, i).applyMatrix3(nm).normalize();
      this.pos.push(v.x, v.y, v.z);
      this.norm.push(w.x, w.y, w.z);
      const ax = Math.abs(w.x), ay = Math.abs(w.y), az = Math.abs(w.z);
      if (ax >= ay && ax >= az) this.uv.push(v.z * scale, v.y * scale);
      else if (ay >= az) this.uv.push(v.x * scale, v.z * scale);
      else this.uv.push(v.x * scale, v.y * scale);
      this.col.push(color.r * glow, color.g * glow, color.b * glow);
    }
    if (idx) for (let i = 0; i < idx.count; i++) this.idx.push(base + idx.getX(i));
    else for (let i = 0; i < p.count; i++) this.idx.push(base + i);
    this.count += p.count;
  }

  build(material) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.norm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(new THREE.Uint32BufferAttribute(this.idx, 1));
    const mesh = new THREE.Mesh(g, material);
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    return mesh;
  }
}

export class ChristmasRoom {
  constructor({ low = false } = {}) {
    this.low = low;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0a0604);
    this.time = 0;
    this.disposables = [];
    this.batches = new Map();
    this.bulbs = new TwinklingBulbs({ low });
    this.texSize = low ? 128 : 256;
    this.unit = { box: new THREE.BoxGeometry(1, 1, 1), cyl: new THREE.CylinderGeometry(0.5, 0.5, 1, low ? 10 : 18), sph: new THREE.SphereGeometry(0.5, low ? 7 : 10, low ? 5 : 7), cone: new THREE.ConeGeometry(0.5, 1, low ? 10 : 18) };
    this.buildShell();
    this.buildFireplace();
    this.buildMantel();
    this.buildWindows();
    this.buildFurniture();
    this.buildTree();
    this.buildPresents();
    this.buildStrings();
    this.finishBatches();
    this.buildFire();
    this.buildLights();
    this.scene.add(this.bulbs.build());
    this.disposables.push(this.bulbs);
    for (const g of Object.values(this.unit)) g.dispose();
  }

  // ---------------------------------------------------------------- shapes

  batch(tex) {
    if (!this.batches.has(tex || '')) this.batches.set(tex || '', new Batch());
    return this.batches.get(tex || '');
  }

  /** A shape centred on (x, y, z), sized (w, h, d), turned about y (radians), in a colour and a texture. */
  shape(kind, x, y, z, w, h, d, hex, tex = null, { turn = 0, tiltX = 0, tiltZ = 0 } = {}) {
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(tiltX, turn, tiltZ, 'YXZ')), new THREE.Vector3(w, h, d));
    const texScale = tex && tex !== 'wall' ? 1 / (TEX_SCALE[tex] || 1) : tex === 'wall' ? 1.6 : 1;
    this.batch(tex).add(this.unit[kind], m, hex, texScale);
  }
  box(...a) { this.shape('box', ...a); }
  cyl(...a) { this.shape('cyl', ...a); }
  sph(...a) { this.shape('sph', ...a); }
  cone(...a) { this.shape('cone', ...a); }
  /** A cylinder lying along x. */
  logX(x, y, z, r, len, hex, tex, turn = 0) { this.shape('cyl', x, y, z, r * 2, len, r * 2, hex, tex, { turn, tiltZ: Math.PI / 2 }); }

  finishBatches() {
    for (const [tex, b] of this.batches) {
      let material;
      if (tex === 'wall') { const map = wallpaperTexture(); map.repeat.set(1, 1); material = new THREE.MeshStandardMaterial({ map, vertexColors: true, roughness: 0.9 }); this.disposables.push(map); }
      else material = new THREE.MeshStandardMaterial({ map: tex ? mapTexture(tex, this.texSize) : null, vertexColors: true, roughness: ROUGH[tex] ?? 0.6, metalness: tex === 'metal' ? 0.55 : 0 });
      const mesh = b.build(material);
      this.disposables.push(mesh.geometry, material);
      this.scene.add(mesh);
    }
    this.batches.clear();
  }

  // ---------------------------------------------------------------- the room

  buildShell() {
    const { x: X, back, front, ceil } = ROOM, W = X * 2, D = front - back, midZ = (front + back) / 2;
    const WALL = 0x2f5240, WAINSCOT = 0x5a3820, TRIM = 0x46290f;
    // Floorboards, each its own shade
    const boards = this.low ? 10 : 18, bw = D / boards;
    for (let i = 0; i < boards; i++) this.box(0, -0.05, back + (i + 0.5) * bw, W, 0.1, bw - 0.012, [0x7a4c28, 0x6f4423, 0x84542c, 0x74482a][i * 7 % 4], 'wood');
    this.box(0, -0.12, midZ, W, 0.1, D, 0x1a0f08);                                       // the gaps between boards
    this.box(0, ceil + 0.05, midZ, W, 0.1, D, 0x8a7a64, 'plaster');
    for (let z = back + 1.1; z < front; z += 2.2) this.box(0, ceil - 0.09, z, W, 0.18, 0.22, 0x3e2610, 'wood');   // beams
    // Walls: wallpaper above, panelling below
    this.box(0, ceil / 2, back - 0.05, W, ceil, 0.1, WALL, 'wall');
    for (const s of [-1, 1]) this.box(s * (X + 0.05), ceil / 2, midZ, 0.1, ceil, D, WALL, 'wall');
    const panel = (x, z, turn, len) => {
      const cos = Math.cos(turn), sin = Math.sin(turn);
      const out = (a, n) => [x + cos * a + sin * n, z - sin * a + cos * n];
      const [bx, bz] = out(0, 0.03), [rx, rz] = out(0, 0.05);
      this.box(bx, 0.55, bz, len, 1.1, 0.06, WAINSCOT, 'wood', { turn });
      this.box(rx, 1.13, rz, len, 0.07, 0.1, TRIM, 'wood', { turn });
      this.box(rx, 0.09, rz, len, 0.18, 0.1, TRIM, 'wood', { turn });
      const n = Math.round(len / 1.05);
      for (let i = 0; i < n; i++) {
        const [px, pz] = out(-len / 2 + (i + 0.5) * (len / n), 0.07);
        this.box(px, 0.64, pz, len / n - 0.2, 0.7, 0.02, WAINSCOT - 0x0a0604, 'wood', { turn });
      }
    };
    panel(0, back, 0, W);
    panel(-X, midZ, Math.PI / 2, D);
    panel(X, midZ, -Math.PI / 2, D);
    this.box(0, ceil - 0.06, back + 0.05, W, 0.12, 0.1, TRIM, 'wood');                    // crown moulding
    // The round rug in front of the fire: rings of red and cream
    for (const [r, hex, y] of [[2.55, 0xd8c8a0, 0.012], [2.45, 0x8a1a20, 0.016], [1.95, 0xd8c8a0, 0.02], [1.87, 0x1f5a38, 0.024], [1.45, 0xd8c8a0, 0.028], [1.38, 0x9a1f24, 0.032]]) {
      this.cyl(0, y, 0.1, r * 2, 0.008 + y * 0.2, r * 2, hex, 'carpet');
    }
    // Pictures on the walls
    this.pictures = [[-5.55, 2.15, back + 0.06, 0.9, 0.7, 0], [5.95, 2.1, back + 0.06, 0.7, 0.55, 0]];
    for (const [x, y, z, w, h] of this.pictures) this.box(x, y, z, w, h, 0.05, 0x3e2610, 'wood');
    this.buildPictures();
  }

  buildPictures() {
    this.pictures.forEach(([x, y, z, w, h], i) => {
      const map = pictureTexture(3 + i);
      const art = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.14, h - 0.14), new THREE.MeshStandardMaterial({ map, roughness: 0.7 }));
      art.position.set(x, y, z + 0.032);
      this.scene.add(art);
      this.disposables.push(map, art.geometry, art.material);
    });
  }

  buildFireplace() {
    const { x: fx, z: fz } = FIRE, STONE = [0x8c8074, 0x7a6e62, 0x98897a, 0x6e6458];
    const depth = 0.9, w = 3.0, open = 1.5, openH = 1.15;
    const front = fz + depth / 2;
    const backZ = fz - 0.2;
    // The inside of the firebox: dark soot-stained brick
    this.box(fx, openH / 2 + 0.02, backZ, open + 0.2, openH + 0.1, 0.06, 0x2a1c14, 'brick');
    for (const s of [-1, 1]) this.box(fx + s * (open / 2 + 0.03), openH / 2, fz + 0.15, 0.06, openH, 0.8, 0x241810, 'brick');
    this.box(fx, 0.02, fz + 0.15, open + 0.1, 0.05, 0.9, 0x1a1210, 'stone');
    // The stones of the surround: rows of uneven blocks either side and above, up to the ceiling
    const course = (x0, x1, y, h) => {
      let x = x0;
      while (x < x1 - 0.01) {
        const bw = Math.min(x1 - x, 0.3 + rnd() * 0.32);
        this.box(x + bw / 2, y + h / 2, front - 0.04 + rnd() * 0.035, bw - 0.018, h - 0.018, 0.09, STONE[Math.floor(rnd() * 4)], 'stone');
        x += bw;
      }
    };
    // The solid chimney behind the stones, either side of the opening and above it
    for (const s of [-1, 1]) this.box(fx + s * (w + open) / 4, ROOM.ceil / 2, fz, (w - open) / 2, ROOM.ceil, depth - 0.04, 0x241c16, 'stone');
    this.box(fx, (openH + 0.04 + ROOM.ceil) / 2, fz, open + 0.02, ROOM.ceil - openH - 0.04, depth - 0.04, 0x241c16, 'stone');
    const rows = this.low ? 9 : 14, rowH = ROOM.ceil / rows;
    for (let r = 0; r < rows; r++) {
      const y = r * rowH;
      if (y < openH + 0.08) { course(fx - w / 2, fx - open / 2, y, rowH); course(fx + open / 2, fx + w / 2, y, rowH); }
      else course(fx - w / 2, fx + w / 2, y, rowH);
    }
    // An arched head of bigger stones over the opening
    for (let i = 0; i < 7; i++) {
      const a = Math.PI * (0.14 + (i / 6) * 0.72), bx = fx + Math.cos(a) * open * 0.56, by = openH - 0.24 + Math.sin(a) * 0.42;
      this.box(bx, by, front + 0.01, 0.26, 0.2, 0.14, STONE[i % 4] + 0x0a0a0a, 'stone', { tiltZ: a - Math.PI / 2 });
    }
    // The raised hearth
    this.box(fx, 0.06, front + 0.32, w + 0.3, 0.12, 0.72, 0x6a6058, 'stone');
    this.box(fx, 0.13, front + 0.34, w + 0.2, 0.02, 0.64, 0x7a6e62, 'stone');
    // Iron grate and logs
    for (let i = 0; i < 7; i++) this.box(fx - 0.48 + i * 0.16, 0.2, fz + 0.32, 0.025, 0.22, 0.03, 0x17171a, 'metal');
    this.box(fx, 0.14, fz + 0.32, 1.1, 0.03, 0.42, 0x17171a, 'metal');
    this.logX(fx - 0.05, 0.22, fz + 0.18, 0.09, 1.1, 0x4a2c18, 'bark', 0.1);
    this.logX(fx + 0.03, 0.2, fz + 0.42, 0.08, 1.0, 0x523018, 'bark', -0.14);
    this.logX(fx, 0.35, fz + 0.3, 0.075, 0.82, 0x3a2212, 'bark', 0.3);
    this.emberBase = [fx, 0.16, fz + 0.3];
    // Fire tools and a basket of logs beside the hearth
    const toolsX = fx + w / 2 + 0.2, toolsZ = front - 0.1;
    this.cyl(toolsX, 0.03, toolsZ, 0.22, 0.05, 0.22, 0x17171a, 'metal');
    this.cyl(toolsX, 0.5, toolsZ, 0.022, 0.92, 0.022, 0x17171a, 'metal');
    this.box(toolsX, 0.93, toolsZ, 0.26, 0.02, 0.02, 0x17171a, 'metal');
    for (const s of [-1, 1]) { this.cyl(toolsX + s * 0.11, 0.52, toolsZ, 0.012, 0.8, 0.012, 0xb8862a, 'metal'); this.box(toolsX + s * 0.11, 0.13, toolsZ, 0.07, 0.1, 0.018, 0x17171a, 'metal'); }
    const basketX = fx - w / 2 - 0.5, basketZ = front - 0.1;
    this.cyl(basketX, 0.2, basketZ, 0.74, 0.4, 0.5, 0x8a6a38, 'fabric');
    for (let i = 0; i < 5; i++) this.logX(basketX + (rnd() - 0.5) * 0.3, 0.42 + (i % 2) * 0.12, basketZ - 0.15 + (i % 3) * 0.13, 0.06, 0.74, 0x5a3a20, 'bark', (rnd() - 0.5) * 0.3);
  }

  buildMantel() {
    const { x: fx, z: fz } = FIRE, y = 1.56, front = fz + 0.45;
    // A thick oak beam on two corbels
    this.box(fx, y, front + 0.05, 3.3, 0.16, 0.42, 0x6a3f1e, 'wood');
    for (const s of [-1, 1]) this.box(fx + s * 1.25, y - 0.2, front + 0.02, 0.22, 0.26, 0.28, 0x5a3418, 'wood');
    const top = y + 0.08;
    // Garland along the front of the mantel: clusters of green with berries and little lights
    const n = this.low ? 40 : 74;
    for (let i = 0; i < n; i++) {
      const u = i / (n - 1), x = fx - 1.62 + u * 3.24, sag = Math.sin(u * Math.PI * 4) * 0.035;
      this.sph(x + (rnd() - 0.5) * 0.04, top - 0.09 - Math.abs(sag) * 2 + (rnd() - 0.5) * 0.05, front + 0.27 + (rnd() - 0.5) * 0.05, 0.12, 0.07, 0.1, 0x1c5a2c + Math.floor(rnd() * 3) * 0x051005, 'leaf');
      if (i % 9 === 0) this.sph(x, top - 0.13, front + 0.33, 0.035, 0.035, 0.035, 0xc8141e);
      if (i % 6 === 3) this.bulbs.add(new THREE.Vector3(x, top - 0.1, front + 0.34), 0xffd080, 0.3);
    }
    // Stockings hanging from the mantel
    const stocking = (x, c, cuff, band) => {
      const z = front + 0.3, topY = y - 0.14;
      this.box(x, topY - 0.05, z, 0.24, 0.1, 0.07, cuff, 'fabric');
      this.box(x, topY - 0.25, z, 0.18, 0.32, 0.055, c, 'fabric');
      this.box(x + 0.06, topY - 0.46, z, 0.3, 0.14, 0.055, c, 'fabric');
      this.sph(x + 0.2, topY - 0.46, z, 0.12, 0.14, 0.06, c, 'fabric');
      this.box(x, topY - 0.2, z + 0.03, 0.185, 0.04, 0.008, band, 'fabric');
      this.box(x + 0.19, topY - 0.46, z + 0.03, 0.09, 0.13, 0.008, cuff, 'fabric');
      this.box(x - 0.01, topY - 0.46, z + 0.03, 0.09, 0.13, 0.008, cuff, 'fabric');
    };
    stocking(fx - 1.1, 0xb8141c, 0xf4f0e8, 0x1f6a3a);
    stocking(fx - 0.4, 0x1f6a3a, 0xf4f0e8, 0xc8141e);
    stocking(fx + 0.3, 0xc8a02a, 0xf4f0e8, 0xb8141c);
    stocking(fx + 1.0, 0xb8141c, 0xf4f0e8, 0xf4f0e8);
    // On top: candles, a clock, little trees and a framed photo
    this.candles = [];
    const candle = (x, z, h, c) => {
      this.cyl(x, top + 0.015, z, 0.13, 0.03, 0.13, 0xb8862a, 'metal');
      this.cyl(x, top + 0.03 + h / 2, z, 0.05, h, 0.05, c);
      this.candles.push(new THREE.Vector3(x, top + 0.05 + h + 0.03, z));
    };
    candle(fx - 1.42, front + 0.02, 0.24, 0xc8141e);
    candle(fx - 1.22, front + 0.08, 0.16, 0xf0ece0);
    candle(fx + 1.42, front + 0.02, 0.24, 0xf0ece0);
    candle(fx + 1.22, front + 0.08, 0.16, 0xc8141e);
    this.box(fx, top + 0.15, front - 0.02, 0.36, 0.3, 0.13, 0x4a2a12, 'wood');
    this.cyl(fx, top + 0.34, front - 0.02, 0.3, 0.14, 0.13, 0x4a2a12, 'wood', { tiltX: Math.PI / 2 });
    this.cyl(fx, top + 0.21, front + 0.05, 0.25, 0.012, 0.25, 0xf2ead8, null, { tiltX: Math.PI / 2 });
    this.box(fx - 0.03, top + 0.24, front + 0.06, 0.012, 0.09, 0.006, 0x141414, null, { tiltZ: 0.4 });
    this.box(fx + 0.04, top + 0.21, front + 0.06, 0.06, 0.012, 0.006, 0x141414);
    for (const s of [-1, 1]) {
      this.box(fx + s * 0.75, top + 0.13, front - 0.05, 0.26, 0.26, 0.03, 0x8a6a30, 'wood');
      this.box(fx + s * 0.75, top + 0.13, front - 0.03, 0.2, 0.2, 0.005, 0xe8dcc0);
    }
    for (const [x, h] of [[fx - 0.5, 0.3], [fx + 0.45, 0.24]]) {
      this.cone(x, top + h / 2 + 0.04, front - 0.02, h * 0.55, h, h * 0.55, 0x1f5a34, 'leaf');
      this.cyl(x, top + 0.02, front - 0.02, 0.05, 0.04, 0.05, 0xb8141c);
    }
    // A wreath on the chimney breast with a red bow
    const wy = 2.52, wz = fz + 0.5;
    const count = this.low ? 40 : 76;
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2, r = 0.34 + (rnd() - 0.5) * 0.09;
      this.sph(fx + Math.cos(a) * r, wy + Math.sin(a) * r, wz + rnd() * 0.04, 0.13, 0.11, 0.07, 0x1a5228 + Math.floor(rnd() * 3) * 0x061206, 'leaf', { turn: 0, tiltX: rnd() });
      if (i % 7 === 0) this.sph(fx + Math.cos(a) * r, wy + Math.sin(a) * r, wz + 0.06, 0.05, 0.05, 0.05, 0xd01c24);
    }
    this.box(fx, wy - 0.38, wz + 0.05, 0.1, 0.09, 0.05, 0xc8141e, 'fabric');
    for (const s of [-1, 1]) {
      this.sph(fx + s * 0.13, wy - 0.37, wz + 0.05, 0.2, 0.12, 0.05, 0xc8141e, 'fabric');
      this.box(fx + s * 0.08, wy - 0.53, wz + 0.04, 0.06, 0.24, 0.012, 0xb8141c, 'fabric', { tiltZ: s * 0.25 });
    }
  }

  /** Windows on the back wall: the night outside, snow falling past, a frame, a sill with candles and heavy curtains. */
  buildWindows() {
    const z = ROOM.back + 0.02;
    const night = nightTexture();
    this.disposables.push(night);
    this.windowFlakes = [];
    for (const [x, w] of [[-3.25, 1.5], [4.05, 1.5]]) {
      const y0 = 1.08, h = 1.72, cy = y0 + h / 2;
      const view = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: night }));
      view.position.set(x, cy, z + 0.04);
      this.scene.add(view);
      this.disposables.push(view.geometry, view.material);
      this.windowFlakes.push([x, y0, z + 0.06, w]);
      const FRAME = 0xe8dcc4;
      this.box(x, y0 + h + 0.05, z + 0.1, w + 0.28, 0.1, 0.12, FRAME, 'wood');
      this.box(x, y0 - 0.04, z + 0.14, w + 0.4, 0.08, 0.26, FRAME, 'wood');
      for (const s of [-1, 1]) this.box(x + s * (w / 2 + 0.05), cy, z + 0.1, 0.1, h + 0.1, 0.12, FRAME, 'wood');
      this.box(x, cy, z + 0.09, 0.05, h, 0.05, FRAME, 'wood');
      for (const u of [0.33, 0.66]) this.box(x, y0 + h * u, z + 0.09, w, 0.04, 0.05, FRAME, 'wood');
      // Snow gathered in the bottom of the panes
      this.sph(x - w / 4, y0 + 0.02, z + 0.07, w * 0.46, 0.14, 0.03, 0xf4f8ff);
      this.sph(x + w / 4, y0 + 0.02, z + 0.07, w * 0.46, 0.16, 0.03, 0xf4f8ff);
      // Curtains: heavy red folds on a brass pole, tied back
      this.cyl(x, y0 + h + 0.22, z + 0.2, 0.05, w + 1.15, 0.05, 0xb8862a, 'metal', { tiltZ: Math.PI / 2 });
      for (const s of [-1, 1]) {
        this.sph(x + s * (w / 2 + 0.58), y0 + h + 0.22, z + 0.2, 0.1, 0.1, 0.1, 0xd8a83a, 'metal');
        const folds = this.low ? 4 : 7;
        for (let i = 0; i < folds; i++) {
          const fx = x + s * (w / 2 + 0.42 - i * 0.075);
          this.cyl(fx, y0 + h / 2 - 0.25, z + 0.2 + (i % 2) * 0.03, 0.1, h + 1.0, 0.09, i % 2 ? 0x7a1016 : 0x8e141c, 'fabric');
        }
        this.box(x + s * (w / 2 + 0.2), y0 + 0.5, z + 0.26, 0.58, 0.06, 0.05, 0xd8a83a, 'fabric');
      }
      // A candle on each sill
      this.cyl(x, y0 + 0.12, z + 0.17, 0.05, 0.2, 0.05, 0xf0ece0);
      this.candles.push(new THREE.Vector3(x, y0 + 0.26, z + 0.17));
    }
  }

  buildFurniture() {
    // A big armchair turned towards the fire, with a tartan blanket
    const ax = -3.6, az = -1.3, at = 0.75;
    const seat = (lx, ly, lz, w, h, d, hex, tex = 'fabric', kind = 'box') => {
      const c = Math.cos(at), s = Math.sin(at);
      this.shape(kind, ax + c * lx + s * lz, ly, az - s * lx + c * lz, w, h, d, hex, tex, { turn: at });
    };
    const LEATHER = 0x7a2a1c;
    seat(0, 0.28, 0, 0.98, 0.36, 0.92, LEATHER);
    seat(0, 0.52, 0.06, 0.66, 0.16, 0.78, LEATHER + 0x0e0806);
    seat(0, 0.76, -0.42, 0.98, 1.02, 0.22, LEATHER);
    seat(0, 1.24, -0.42, 0.9, 0.14, 0.24, LEATHER + 0x0a0604);
    for (const s of [-1, 1]) {
      seat(s * 0.43, 0.48, 0, 0.2, 0.42, 0.9, LEATHER);
      seat(s * 0.43, 0.7, 0, 0.26, 0.12, 0.92, LEATHER + 0x0a0604);
      for (const f of [-1, 1]) seat(s * 0.4, 0.06, f * 0.38, 0.08, 0.12, 0.08, 0x2a180c, 'wood', 'cyl');
    }
    seat(0, 0.76, -0.27, 0.5, 0.36, 0.14, 0xd8b84a);                                       // a cushion
    // The blanket over the arm, in tartan stripes
    for (let i = 0; i < 6; i++) seat(-0.46, 0.5 - i * 0.002, -0.24 + i * 0.1, 0.32, 0.46, 0.1, i % 2 ? 0x1f5a38 : 0xb8141c);
    // A small table beside it with a mug of cocoa and a book
    const tx = -2.55, tz = -2.05;
    this.cyl(tx, 0.58, tz, 0.62, 0.04, 0.62, 0x6a3f1e, 'wood');
    this.cyl(tx, 0.3, tz, 0.06, 0.56, 0.06, 0x4e2e14, 'wood');
    for (let i = 0; i < 3; i++) { const a = i * 2.1; this.box(tx + Math.cos(a) * 0.14, 0.05, tz + Math.sin(a) * 0.14, 0.32, 0.03, 0.05, 0x4e2e14, 'wood', { turn: -a }); }
    this.cyl(tx - 0.08, 0.66, tz + 0.06, 0.1, 0.12, 0.1, 0xb8141c);
    this.cyl(tx - 0.08, 0.725, tz + 0.06, 0.082, 0.004, 0.082, 0x4a2412);
    this.box(tx + 0.1, 0.62, tz - 0.02, 0.24, 0.04, 0.17, 0x1f4a6a, 'fabric', { turn: 0.5 });
    // A floor lamp with a warm shade
    const lx = -5.1, lz = -2.65;
    this.cyl(lx, 0.02, lz, 0.42, 0.04, 0.42, 0x3a2a14, 'metal');
    this.cyl(lx, 0.85, lz, 0.035, 1.66, 0.035, 0x8a6a2a, 'metal');
    this.lampShade = [lx, 1.76, lz];
    const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.34, 0.36, this.low ? 12 : 20, 1, true), new THREE.MeshBasicMaterial({ color: 0xffc070, side: THREE.DoubleSide }));
    shade.position.set(lx, 1.76, lz);
    this.scene.add(shade);
    this.disposables.push(shade.geometry, shade.material);
    // A bookshelf on the left wall
    const bz = 0.6, bx = -ROOM.x + 0.2, shelfW = 2.1;
    this.box(bx - 0.06, 1.15, bz, 0.05, 2.3, shelfW, 0x4e2e14, 'wood');
    for (const s of [-1, 1]) this.box(bx + 0.12, 1.15, bz + s * (shelfW / 2 - 0.02), 0.36, 2.3, 0.05, 0x5a3418, 'wood');
    const books = [0x8a1f24, 0x1f4a6a, 0x2a6038, 0x8a6a2a, 0x5a2a6a, 0xc8b89a, 0x2a2a2e];
    for (let r = 0; r < 5; r++) {
      const y = 0.06 + r * 0.46;
      this.box(bx + 0.12, y, bz, 0.36, 0.04, shelfW - 0.06, 0x5a3418, 'wood');
      if (this.low && r % 2) continue;
      let z = bz - shelfW / 2 + 0.08;
      while (z < bz + shelfW / 2 - 0.12) {
        const t = 0.04 + rnd() * 0.05, h = 0.26 + rnd() * 0.12;
        if (rnd() > 0.1) this.box(bx + 0.14, y + 0.02 + h / 2, z + t / 2, 0.22, h, t, books[Math.floor(rnd() * books.length)]);
        z += t + 0.004 + (rnd() < 0.1 ? 0.12 : 0);
      }
    }
    this.box(bx + 0.14, 2.42, bz, 0.26, 0.12, 0.3, 0xb8141c, 'fabric');                    // a present on top
    // Cookies and milk for the visitor, left on the hearth
    const cx = 0.85, cz = -2.6;
    this.cyl(cx + 0.05, 0.15, cz, 0.3, 0.015, 0.3, 0xf2ece0);
    for (const [dx, dz] of [[0.0, 0.02], [0.09, -0.04], [0.1, 0.06]]) this.cyl(cx + dx, 0.17, cz + dz, 0.09, 0.014, 0.09, 0xb8824a, 'fabric');
    this.cyl(cx - 0.17, 0.21, cz + 0.02, 0.07, 0.14, 0.07, 0xf8f6f0);
    // A cat asleep on the rug
    const kx = -1.1, kz = -1.1, CAT = 0xf0a24a, CAT2 = 0xc87a30;
    this.sph(kx, 0.13, kz, 0.56, 0.26, 0.36, CAT, 'fabric', { turn: 0.3 });
    this.sph(kx + 0.27, 0.13, kz + 0.12, 0.22, 0.2, 0.22, CAT, 'fabric');
    for (const s of [-1, 1]) this.cone(kx + 0.27 + s * 0.06, 0.25, kz + 0.12 - s * 0.03, 0.06, 0.08, 0.05, CAT2, 'fabric');
    for (const u of [-0.16, -0.02, 0.12]) this.box(kx + u, 0.25, kz - 0.03 * u, 0.05, 0.015, 0.2, CAT2, 'fabric', { turn: 0.3 });
    for (let i = 0; i < 7; i++) { const a = -0.3 + i * 0.42; this.sph(kx - 0.28 + Math.cos(a + 2.4) * 0.16, 0.05, kz + 0.1 + Math.sin(a + 2.4) * 0.22, 0.08, 0.07, 0.08, i > 4 ? CAT2 : CAT, 'fabric'); }
  }

  buildTree() {
    const { x: tx, z: tz } = TREE, layers = 7, parts = [];
    const coneAt = (k) => ({ bottom: 0.36 + k * 0.33, top: 0.36 + k * 0.33 + 0.88 - k * 0.06, r: 1.08 - k * 0.14 });
    for (let k = 0; k < layers; k++) {
      const { bottom, top, r } = coneAt(k);
      const seg = this.low ? 12 : 20;
      const c = new THREE.ConeGeometry(r, top - bottom, seg, 3, true);
      // A jagged hem and a rough surface, so each layer reads as branches rather than a smooth cone
      const pos = c.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const hem = (pos.getY(i) + (top - bottom) / 2) / (top - bottom);
        const a = Math.atan2(pos.getZ(i), pos.getX(i)), jag = 1 - 0.2 * (1 - hem) * (Math.round((a / (Math.PI * 2)) * seg) % 2 === 0 ? 0 : 1);
        pos.setXYZ(i, pos.getX(i) * jag, pos.getY(i) + (1 - jag) * 0.45, pos.getZ(i) * jag);
      }
      c.computeVertexNormals();
      c.rotateY(k * 0.7);
      c.translate(tx, (bottom + top) / 2, tz);
      parts.push(c);
    }
    const needles = this.needleMaterial();
    for (const g of parts) {
      const m = new THREE.Mesh(g, needles);
      m.castShadow = m.receiveShadow = !this.low;
      this.scene.add(m);
      this.disposables.push(g);
    }
    this.disposables.push(needles, needles.map);
    // A trunk in a wooden tub
    this.cyl(tx, 0.26, tz, 0.26, 0.44, 0.26, 0x4a2e1c, 'bark');
    this.cyl(tx, 0.16, tz, 0.72, 0.32, 0.72, 0x7a2a1c, 'wood');
    for (const y of [0.06, 0.26]) this.cyl(tx, y, tz, 0.74, 0.03, 0.74, 0xb8862a, 'metal');
    this.cyl(tx, 0.03, tz, 2.2, 0.03, 2.2, 0xb8141c, 'fabric');                          // a tree skirt
    this.cyl(tx, 0.05, tz, 1.6, 0.03, 1.6, 0xf2ece0, 'fabric');

    const surface = (k, f, a, push = 0.02) => {
      const { bottom, top, r } = coneAt(k), y = bottom + (top - bottom) * f, rad = r * (1 - f) + push;
      return new THREE.Vector3(tx + Math.cos(a) * rad, y, tz + Math.sin(a) * rad);
    };
    // Baubles in red, gold, silver and blue
    const colors = [0xc8141e, 0xe8b22a, 0xe8eef6, 0x1f5fc8, 0xc8141e, 0xe8b22a, 0x1f8a4a];
    const count = this.low ? 30 : 60;
    const baubles = new THREE.InstancedMesh(new THREE.SphereGeometry(1, this.low ? 8 : 14, this.low ? 6 : 10), new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.5, roughness: 0.2 }), count);
    const m = new THREE.Matrix4(), col = new THREE.Color();
    for (let i = 0; i < count; i++) {
      const k = i % layers, at = surface(k, 0.08 + rnd() * 0.3, i * 2.399, 0.04), s = (0.07 - k * 0.004) * (0.85 + rnd() * 0.4);
      baubles.setMatrixAt(i, m.makeScale(s, s, s).setPosition(at));
      baubles.setColorAt(i, col.setHex(colors[i % colors.length]));
    }
    baubles.castShadow = !this.low;
    this.scene.add(baubles);
    this.disposables.push(baubles.geometry, baubles.material);
    // Candy canes and little wooden stars hung here and there
    for (let i = 0; i < (this.low ? 6 : 14); i++) {
      const k = i % layers, at = surface(k, 0.2 + rnd() * 0.2, i * 1.73 + 0.8, 0.06);
      if (i % 2) { this.cyl(at.x, at.y, at.z, 0.022, 0.13, 0.022, 0xf8f2ea); this.cyl(at.x, at.y + 0.01, at.z, 0.024, 0.03, 0.024, 0xc8141e); this.sph(at.x + 0.02, at.y + 0.07, at.z, 0.05, 0.03, 0.03, 0xc8141e); }
      else this.box(at.x, at.y, at.z, 0.09, 0.09, 0.015, 0xb8824a, 'wood', { tiltZ: Math.PI / 4 });
    }
    // Garland lights winding round it
    const palette = [0xffd890, 0xffd890, 0xff4a3a, 0x4ac8ff, 0x5aff8a, 0xffd890];
    const lights = this.low ? 54 : 110;
    for (let i = 0; i < lights; i++) {
      const u = i / lights, k = Math.min(layers - 1, Math.floor(u * layers)), a = u * Math.PI * 2 * 8.3;
      this.bulbs.add(surface(k, 0.06 + ((u * layers) % 1) * 0.5, a, 0.05), palette[i % palette.length], 0.6);
    }
    // The star
    const shape = new THREE.Shape();
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 + Math.PI / 2, r = i % 2 ? 0.08 : 0.2;
      if (i) shape.lineTo(Math.cos(a) * r, Math.sin(a) * r); else shape.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    const starGeo = new THREE.ExtrudeGeometry(shape, { depth: 0.05, bevelEnabled: true, bevelSize: 0.012, bevelThickness: 0.012, bevelSegments: 1 });
    starGeo.translate(0, 0, -0.025);
    this.starMat = new THREE.MeshStandardMaterial({ color: 0xffd860, emissive: 0xffb820, emissiveIntensity: 1.6, metalness: 0.4, roughness: 0.35 });
    this.star = new THREE.Mesh(starGeo, this.starMat);
    const tip = coneAt(layers - 1).top + 0.1;
    this.star.position.set(tx, tip, tz);
    this.scene.add(this.star);
    const haloMap = haloTexture();
    this.starHalo = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloMap, color: 0xffd070, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.8 }));
    this.starHalo.scale.setScalar(1.15);
    this.starHalo.position.copy(this.star.position);
    this.scene.add(this.starHalo);
    this.disposables.push(starGeo, this.starMat, this.starHalo.material, haloMap);
    this.haloMap = haloMap;
  }

  needleMaterial() {
    const r = seededRandom(31);
    const map = canvasTexture(256, 256, (g, w, h) => {
      g.fillStyle = '#123a22';
      g.fillRect(0, 0, w, h);
      for (let i = 0; i < 3200; i++) {
        const x = r() * w, y = r() * h, len = 6 + r() * 13, a = Math.PI / 2 + (r() - 0.5) * 0.9;
        g.strokeStyle = `hsl(${132 + r() * 24}, ${42 + r() * 28}%, ${12 + r() * 24}%)`;
        g.lineWidth = 1 + r();
        g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len); g.stroke();
      }
    });
    map.wrapS = THREE.RepeatWrapping;
    map.repeat.set(3, 1);
    return new THREE.MeshStandardMaterial({ map, roughness: 0.92, side: THREE.DoubleSide });
  }

  /** Wrapped presents around the tree, just for show (the ones you can open come from giftScene.js). */
  buildPresents() {
    const list = [
      // x and z, width, height, depth, colour, ribbon colour
      [TREE.x - 1.2, TREE.z - 0.32, 0.46, 0.34, 0.4, 0x1f6a3a, 0xf2d46a], [TREE.x + 1.2, TREE.z - 0.2, 0.42, 0.3, 0.42, 0x2a56b8, 0xf2d46a],
      [TREE.x + 0.75, TREE.z + 0.86, 0.34, 0.5, 0.34, 0xe8b22a, 0xc8141e], [TREE.x + 1.05, TREE.z - 1.0, 0.5, 0.4, 0.5, 0xc8141e, 0xffffff],
      [TREE.x - 0.95, TREE.z - 1.0, 0.36, 0.26, 0.36, 0x7a2ab0, 0xffffff],
    ];
    for (const [x, z, w, h, d, paper, ribbon] of list) {
      this.box(x, h / 2 + 0.01, z, w, h, d, paper, 'fabric');
      this.box(x, h / 2 + 0.01, z, w * 0.16, h + 0.01, d + 0.01, ribbon);
      this.box(x, h / 2 + 0.01, z, w + 0.01, h + 0.01, d * 0.16, ribbon);
      for (const s of [-1, 1]) this.sph(x + s * w * 0.13, h + 0.05, z, w * 0.26, 0.09, 0.08, ribbon, null, { tiltZ: s * 0.4 });
    }
  }

  /** Fairy lights along the back wall's crown and looped across the beams. */
  buildStrings() {
    const warm = [0xffc878, 0xffd898, 0xffb860];
    const hang = (a, b, sag, gap) => {
      const n = Math.round(a.distanceTo(b) / (this.low ? gap * 1.6 : gap));
      for (let i = 1; i < n; i++) {
        const u = i / n, p = new THREE.Vector3().lerpVectors(a, b, u);
        p.y -= sag * 4 * u * (1 - u);
        this.bulbs.add(p, warm[i % warm.length], 0.2);
        this.sph(p.x, p.y + 0.02, p.z, 0.012, 0.03, 0.012, 0x101010);
      }
    };
    const y = ROOM.ceil - 0.22, b = ROOM.back + 0.14;
    for (const [x0, x1] of [[-6.4, -4.4], [-4.4, -2.1], [1.5, 4.0], [4.0, 6.4]]) hang(new THREE.Vector3(x0, y, b), new THREE.Vector3(x1, y, b), 0.14, 0.17);
    hang(new THREE.Vector3(-6.4, y, b), new THREE.Vector3(-6.4, y - 0.1, 3), 0.2, 0.22);
    hang(new THREE.Vector3(6.4, y, b), new THREE.Vector3(6.4, y - 0.1, 3), 0.2, 0.22);
  }

  // ---------------------------------------------------------------- the fire

  buildFire() {
    const { x: fx, z: fz } = FIRE;
    this.flames = [];
    const rows = this.low ? [[0, 0.3, 1.25, 1.0, 0]] : [[-0.32, 0.1, 0.86, 0.92, 0.1], [0.3, 0.14, 0.8, 0.84, 0.47], [0, 0.28, 1.2, 1.02, 0.8], [0.04, 0.4, 0.94, 0.76, 0.27]];
    for (const [dx, dz, w, h, seed] of rows) {
      const mat = new THREE.ShaderMaterial({ uniforms: { uTime: { value: 0 }, uSeed: { value: seed } }, vertexShader: FLAME_VERT, fragmentShader: FLAME_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
      const flame = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
      flame.position.set(fx + dx, 0.14 + h / 2, fz + dz);
      this.scene.add(flame);
      this.flames.push(flame);
      this.disposables.push(flame.geometry, mat);
    }
    // A pool of glowing embers under the logs and a warm glow in the opening
    this.emberMat = new THREE.MeshBasicMaterial({ color: 0xff6a18, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
    const embers = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.03, 0.46), this.emberMat);
    embers.position.set(fx, 0.17, fz + 0.3);
    this.scene.add(embers);
    this.glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.haloMap, color: 0xff8030, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.55 }));
    this.glow.scale.set(3.3, 2.5, 1);
    this.glow.position.set(fx, 0.62, fz + 0.72);
    this.scene.add(this.glow);
    this.disposables.push(embers.geometry, this.emberMat, this.glow.material);
    // Sparks rising up the chimney
    const n = this.low ? 18 : 46;
    this.sparks = [];
    const pos = new Float32Array(n * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.sparkPoints = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xffa040, size: 0.028, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.sparkPoints.frustumCulled = false;
    this.scene.add(this.sparkPoints);
    this.disposables.push(geo, this.sparkPoints.material);
    for (let i = 0; i < n; i++) this.sparks.push({ life: Math.random() * 1.2, x: 0, y: 0, z: 0, vx: 0, vy: 0 });
    // Candle flames
    this.candleSprites = this.candles.map((p, i) => {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.haloMap, color: 0xffb860, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
      s.position.copy(p);
      s.userData.phase = i * 1.7;
      this.scene.add(s);
      this.disposables.push(s.material);
      return s;
    });
    // Snow falling past the windows
    for (const [x, y0, z, w] of this.windowFlakes) {
      const count = this.low ? 20 : 46;
      const p = new Float32Array(count * 3), f = new Float32Array(count * 3);
      const r = seededRandom(Math.round(x * 100) + 500);
      for (let i = 0; i < count; i++) { p.set([x + (r() - 0.5) * w, y0 + 0.02, z], i * 3); f.set([r(), r(), 0.09 + r() * 0.12], i * 3); }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(p, 3));
      g.setAttribute('aFlake', new THREE.BufferAttribute(f, 3));
      const mat = this.flakeMat ||= new THREE.ShaderMaterial({ uniforms: { uTime: { value: 0 } }, vertexShader: SNOW_VERT, fragmentShader: SNOW_FRAG, transparent: true, depthWrite: false });
      const pts = new THREE.Points(g, mat);
      pts.frustumCulled = false;
      this.scene.add(pts);
      this.disposables.push(g);
    }
    this.disposables.push(this.flakeMat);
  }

  buildLights() {
    const { x: fx, z: fz } = FIRE;
    this.scene.add(new THREE.HemisphereLight(0xffcfa0, 0x3a2010, 0.5));
    // The fire lights the room and throws long shadows that flicker
    this.fireLight = new THREE.PointLight(0xff8a3a, 20, 13, 1.5);
    this.fireLight.position.set(fx, 0.75, fz + 1.05);
    this.scene.add(this.fireLight);
    if (!this.low) {
      this.fireSpot = new THREE.SpotLight(0xff9a48, 20, 13, 1.2, 0.75, 1.3);
      this.fireSpot.position.set(fx, 0.5, fz + 0.75);
      this.fireSpot.target.position.set(fx + 0.2, 0.2, 3);
      this.fireSpot.castShadow = true;
      this.fireSpot.shadow.mapSize.set(1024, 1024);
      this.fireSpot.shadow.bias = -0.0015;
      this.scene.add(this.fireSpot, this.fireSpot.target);
      const tree = new THREE.PointLight(0xffc070, 7, 6, 1.7);
      tree.position.set(TREE.x - 0.3, 1.6, TREE.z + 1.5);
      this.scene.add(tree);
      this.treeLight = tree;
      const lamp = new THREE.PointLight(0xffb868, 9, 7, 1.6);
      lamp.position.set(...this.lampShade);
      this.scene.add(lamp);
    } else {
      this.fireLight.intensity = 28;
      this.scene.children.find((o) => o.isHemisphereLight).intensity = 0.85;
    }
  }

  // ---------------------------------------------------------------- each frame

  update(dt) {
    const t = (this.time += dt);
    for (const f of this.flames) f.material.uniforms.uTime.value = t;
    // Fire light breathes and jumps a little
    const flick = 0.82 + 0.13 * Math.sin(t * 11.3) * Math.sin(t * 7.1) + 0.1 * Math.sin(t * 23.7) + 0.08 * Math.sin(t * 3.1);
    this.fireLight.intensity = (this.low ? 28 : 20) * flick;
    if (this.fireSpot) {
      this.fireSpot.intensity = 20 * flick;
      this.fireSpot.position.x = FIRE.x + Math.sin(t * 6.1) * 0.05;
    }
    this.glow.material.opacity = 0.42 + flick * 0.16;
    this.emberMat.opacity = 0.65 + 0.3 * Math.sin(t * 2.6);
    // Sparks
    const pos = this.sparkPoints.geometry.attributes.position;
    this.sparks.forEach((s, i) => {
      s.life -= dt;
      if (s.life <= 0) { s.life = 0.5 + Math.random() * 1.1; s.x = FIRE.x + (Math.random() - 0.5) * 0.9; s.y = 0.3; s.z = FIRE.z + 0.2 + Math.random() * 0.3; s.vx = (Math.random() - 0.5) * 0.25; s.vy = 0.5 + Math.random() * 0.8; }
      s.x += (s.vx + Math.sin(t * 5 + i) * 0.1) * dt;
      s.y += s.vy * dt;
      pos.setXYZ(i, s.x, Math.min(s.y, 1.2), s.z);
    });
    pos.needsUpdate = true;
    for (const c of this.candleSprites) c.scale.setScalar(0.17 + 0.04 * Math.sin(t * 9 + c.userData.phase) + 0.02 * Math.sin(t * 17 + c.userData.phase));
    this.flakeMat.uniforms.uTime.value = t;
    this.star.rotation.y = Math.sin(t * 0.5) * 0.35;
    const pulse = 0.5 + 0.5 * Math.sin(t * 1.7);
    this.starMat.emissiveIntensity = 1.3 + pulse * 0.9;
    this.starHalo.material.opacity = 0.6 + pulse * 0.35;
    if (this.treeLight) this.treeLight.intensity = 6.2 + pulse * 1.4;
    this.bulbs.update(dt);
  }

  dispose() {
    for (const d of this.disposables) d?.dispose?.();
    this.disposables = [];
  }
}
