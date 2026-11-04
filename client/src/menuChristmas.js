// The Christmas decorations in the main menu (Stage M), built in code on top of the rooftop: a decorated tree with
// glowing lights and a star, wrapped presents around it, warm string lights behind the operator, snow on the roof,
// the platform and everything on the roof, and falling snow. Instanced and merged, so it costs about a dozen draw
// calls; `low` (the Low graphics setting) has less snow, no extra lights and no shadows.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** Where the tree stands, and where unopened presents wait around it (giftScene.js). */
export const TREE = { x: 2.35, z: -0.95 };
export const PRESENT_SPOTS = [[2.0, 0.2], [2.5, 0.5], [1.8, -0.55], [2.9, -0.05], [2.05, 0.8], [2.8, 0.75], [2.45, -0.2], [1.72, 0.72]];

const TREE_SCALE = 0.8;
const TREE_HEIGHT = 2.6;   // to the star, as drawn
const rnd = (() => { let a = 2512; return () => { a = (a * 1103515245 + 12345) >>> 0; return a / 4294967296; }; })();

function canvasTexture(w, h, fn) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  fn(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Green needles with a dusting of snow that gets heavier towards the top of each layer. */
function needleTexture() {
  const t = canvasTexture(256, 256, (g, w, h) => {
    g.fillStyle = '#123a22';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 2600; i++) {
      const x = rnd() * w, y = rnd() * h, len = 6 + rnd() * 12, a = Math.PI / 2 + (rnd() - 0.5) * 0.9;
      g.strokeStyle = `hsl(${135 + rnd() * 22}, ${42 + rnd() * 25}%, ${13 + rnd() * 20}%)`;
      g.lineWidth = 1 + rnd();
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len); g.stroke();
    }
    for (let i = 0; i < 330; i++) {
      const y = h * rnd() ** 1.9, r = 1 + rnd() * 3.6;     // canvas y 0 is the top of the texture, which is the tip of the cone
      g.fillStyle = `rgba(240,247,255,${0.45 + rnd() * 0.5})`;
      g.beginPath(); g.arc(rnd() * w, y, r, 0, Math.PI * 2); g.fill();
    }
  });
  t.wrapS = THREE.RepeatWrapping;
  t.repeat.set(2, 1);
  return t;
}

/** Soft blotches of snow, all over, or only round the edge so the middle stays clear. */
function snowTexture(w, h, blobs, keepMiddleClear) {
  return canvasTexture(w, h, (g) => {
    for (let i = 0; i < blobs; i++) {
      const x = rnd() * w, y = rnd() * h;
      const dx = (x - w / 2) / (w / 2), dy = (y - h / 2) / (h / 2), edge = Math.hypot(dx, dy);
      if (keepMiddleClear && (edge < 0.74 || edge > 1)) continue;
      const r = (w / 22) * (0.5 + rnd() * 1.3);
      const grad = g.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, 'rgba(244,249,255,0.95)');
      grad.addColorStop(0.65, 'rgba(244,249,255,0.72)');
      grad.addColorStop(1, 'rgba(244,249,255,0)');
      g.fillStyle = grad;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    }
  });
}

function haloTexture() {
  return canvasTexture(64, 64, (g) => {
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.25, 'rgba(255,255,255,0.5)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
  });
}

const SNOW_VERT = /* glsl */ `
uniform float uTime, uHeight;
attribute vec4 aFlake;    // x, start height, z, speed
attribute float aSize;
varying float vA;
void main() {
  float y = mod(aFlake.y - uTime * aFlake.w, 12.0) - 0.4;
  float sway = uTime * (0.4 + aFlake.w) + aFlake.x * 7.0;
  vec3 p = vec3(aFlake.x + sin(sway) * 0.22 + y * 0.03, y, aFlake.z + cos(sway * 0.8) * 0.16);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vA = smoothstep(-0.4, 0.0, y);
  gl_PointSize = min(aSize * projectionMatrix[1][1] * uHeight * 0.5 / -mv.z, uHeight * 0.011);
  gl_Position = projectionMatrix * mv;
}`;
const SNOW_FRAG = /* glsl */ `
varying float vA;
void main() {
  float d = length(gl_PointCoord - 0.5);
  if (d > 0.5) discard;
  gl_FragColor = vec4(0.94, 0.97, 1.0, smoothstep(0.5, 0.15, d) * 0.9 * vA);
}`;

export class ChristmasDecor {
  constructor(scene, { low = false } = {}) {
    this.scene = scene;
    this.low = low;
    this.group = new THREE.Group();
    this.disposables = [];
    this.time = 0;
    this.lightTick = 0;
    this.bulbs = [];         // { pos, color, phase, tree }: every little light, on the tree and on the strings
    scene.add(this.group);
    this.buildGroundSnow();
    this.buildSnowOnThings();
    this.buildTree();
    this.buildPresents();
    this.buildStrings();
    this.buildBulbs();
    this.buildSnowfall();
  }

  add(obj, { shadow = false, receive = true } = {}) {
    obj.traverse((o) => {
      if (o.isMesh) { o.castShadow = shadow && !this.low; o.receiveShadow = receive && !this.low; }
      if (o.geometry) this.disposables.push(o.geometry);
      if (o.material) this.disposables.push(o.material, o.material.map);
    });
    this.group.add(obj);
    return obj;
  }

  /** Snow lying on the roof and in drifts round the edge of the platform. */
  buildGroundSnow() {
    const roof = new THREE.Mesh(new THREE.PlaneGeometry(40, 16), new THREE.MeshStandardMaterial({ map: snowTexture(1024, 410, this.low ? 900 : 1700, false), transparent: true, roughness: 0.9, depthWrite: false }));
    roof.rotation.x = -Math.PI / 2;
    roof.position.set(0, -0.095, 1);
    this.add(roof);
    const pad = new THREE.Mesh(new THREE.CircleGeometry(1.69, 48), new THREE.MeshStandardMaterial({ map: snowTexture(512, 512, 420, true), transparent: true, roughness: 0.9, depthWrite: false }));
    pad.rotation.x = -Math.PI / 2;
    pad.position.y = 0.0012;
    this.add(pad);
  }

  /** Snow on top of the parapets, air-conditioning units, stair hut and crates, and drifts against the walls. */
  buildSnowOnThings() {
    const caps = [
      // x, y, z, width, height, depth, turn
      [0, 1.02, -7, 40.1, 0.1, 0.47, 0], [-20, 1.02, 1, 16, 0.1, 0.47, Math.PI / 2], [20, 1.02, 1, 16, 0.1, 0.47, Math.PI / 2],
      [-4.4, 1.05, -4.6, 1.72, 0.09, 1.12, 0.2], [4.8, 1.05, -5.3, 1.72, 0.09, 1.12, -0.15], [-10, 1.05, -2, 1.72, 0.09, 1.12, 0],
      [-7.6, 2.64, -2.6, 2.46, 0.16, 2.46, 0.35],
      [5.8, 1.15, -1, 0.74, 0.08, 0.74, 0.1],
    ];
    const box = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0xeef4fb, roughness: 0.95 }), caps.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), p = new THREE.Vector3(), s = new THREE.Vector3();
    caps.forEach(([x, y, z, w, h, d, r], i) => box.setMatrixAt(i, m.compose(p.set(x, y, z), q.setFromAxisAngle(up, r), s.set(w, h, d))));
    this.add(box);
    const n = this.low ? 16 : 34;
    const drifts = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 12, 8), new THREE.MeshStandardMaterial({ color: 0xe8eff8, roughness: 0.95 }), n);
    for (let i = 0; i < n; i++) {
      const along = i < n * 0.7;
      const a = Math.PI * (1.05 + rnd() * 0.9);           // the rest curve round the back half of the platform
      const x = along ? -13 + (i / (n * 0.7)) * 26 : Math.cos(a) * (2.05 + rnd() * 0.3);
      const z = along ? -6.65 + rnd() * 0.2 : Math.sin(a) * (2.05 + rnd() * 0.3);
      drifts.setMatrixAt(i, m.compose(p.set(x, -0.1, z), q.identity(), along ? s.set(0.5 + rnd() * 1.1, 0.1 + rnd() * 0.16, 0.3 + rnd() * 0.3) : s.set(0.3 + rnd() * 0.4, 0.05 + rnd() * 0.07, 0.2 + rnd() * 0.2)));
    }
    this.add(drifts);
  }

  buildTree() {
    const g = new THREE.Group();
    g.position.set(TREE.x, -0.1, TREE.z);
    g.scale.setScalar(TREE_SCALE);
    this.add(g);
    const layers = 6, parts = [];
    const coneAt = (k) => ({ bottom: 0.42 + k * 0.42, top: 0.42 + k * 0.42 + 1.05 - k * 0.09, r: 1.08 - k * 0.165 });
    for (let k = 0; k < layers; k++) {
      const { bottom, top, r } = coneAt(k);
      const c = new THREE.ConeGeometry(r, top - bottom, 18, 2, true);
      // Jagged hem: every other point of the bottom edge is pulled in and up, so it reads as branches
      const pos = c.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        if (pos.getY(i) < -(top - bottom) / 2 + 0.001) {
          const a = Math.atan2(pos.getZ(i), pos.getX(i)), jag = Math.round((a / (Math.PI * 2)) * 18) % 2 === 0 ? 1 : 0.8;
          pos.setXYZ(i, pos.getX(i) * jag, pos.getY(i) + (1 - jag) * 0.5, pos.getZ(i) * jag);
        }
      }
      c.computeVertexNormals();
      c.rotateY(k * 0.7);
      c.translate(0, (bottom + top) / 2, 0);
      parts.push(c);
    }
    const body = new THREE.Mesh(mergeGeometries(parts), new THREE.MeshStandardMaterial({ map: needleTexture(), roughness: 0.92, side: THREE.DoubleSide }));
    for (const c of parts) c.dispose();
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.15, 0.55, 10), new THREE.MeshStandardMaterial({ color: 0x4a2e1c, roughness: 0.95 }));
    trunk.position.y = 0.27;
    const mound = new THREE.Mesh(new THREE.SphereGeometry(1.15, 18, 8), new THREE.MeshStandardMaterial({ color: 0xf0f5fb, roughness: 0.95 }));
    mound.scale.y = 0.13;
    mound.position.y = 0.01;
    const add = (o, opts) => { this.add(o, opts); g.add(o); };
    add(body, { shadow: true });
    add(trunk, { shadow: true });
    add(mound);

    // A point on the tree's surface at a height, on the side facing the angle
    const surface = (k, f, a, push = 0.02) => {
      const { bottom, top, r } = coneAt(k);
      const y = bottom + (top - bottom) * f, rad = r * (1 - f) + push;
      return new THREE.Vector3(Math.cos(a) * rad, y, Math.sin(a) * rad);
    };

    // Baubles
    const colors = [0xc8141e, 0xe8b22a, 0xe8eef6, 0x1f5fc8, 0xc8141e, 0xe8b22a];
    const count = this.low ? 26 : 44;
    const baubles = new THREE.InstancedMesh(new THREE.SphereGeometry(1, this.low ? 8 : 14, this.low ? 6 : 10), new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.45, roughness: 0.22 }), count);
    const m = new THREE.Matrix4(), col = new THREE.Color();
    for (let i = 0; i < count; i++) {
      const k = i % layers, a = i * 2.399, f = 0.12 + rnd() * 0.28;
      const at = surface(k, f, a, 0.045), s = (0.07 - k * 0.005) * (0.85 + rnd() * 0.4);
      baubles.setMatrixAt(i, m.makeScale(s, s, s).setPosition(at));
      baubles.setColorAt(i, col.setHex(colors[i % colors.length]));
    }
    add(baubles);

    // Garland lights winding round the tree
    const palette = [0xffd890, 0xffd890, 0xff4a3a, 0x4ac8ff, 0x5aff8a, 0xffd890];
    const lights = this.low ? 44 : 78;
    for (let i = 0; i < lights; i++) {
      const u = i / lights, k = Math.min(layers - 1, Math.floor(u * layers)), a = u * Math.PI * 2 * 7.3;
      const at = surface(k, 0.08 + ((u * layers) % 1) * 0.5, a, 0.05);
      at.multiplyScalar(TREE_SCALE).add(g.position);
      this.bulbs.push({ pos: at, color: new THREE.Color(palette[i % palette.length]), phase: rnd() * 6.28, speed: 1.4 + rnd() * 2.2, depth: 0.55 });
    }

    // The star on top, with a soft halo
    const shape = new THREE.Shape();
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 + Math.PI / 2, r = i % 2 ? 0.075 : 0.19;
      if (i) shape.lineTo(Math.cos(a) * r, Math.sin(a) * r); else shape.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    const starGeo = new THREE.ExtrudeGeometry(shape, { depth: 0.05, bevelEnabled: true, bevelSize: 0.012, bevelThickness: 0.012, bevelSegments: 1 });
    starGeo.translate(0, 0, -0.025);
    this.starMat = new THREE.MeshStandardMaterial({ color: 0xffd860, emissive: 0xffb820, emissiveIntensity: 1.6, metalness: 0.4, roughness: 0.35 });
    this.star = new THREE.Mesh(starGeo, this.starMat);
    const tipY = coneAt(layers - 1).top;
    this.star.position.y = tipY + 0.1;
    add(this.star);
    this.starHalo = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTexture(), color: 0xffd070, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.8 }));
    this.starHalo.scale.setScalar(1.1);
    this.starHalo.position.y = tipY + 0.1;
    add(this.starHalo);
    if (!this.low) {
      this.treeLight = new THREE.PointLight(0xffc070, 3.2, 5, 1.7);
      this.treeLight.position.set(0.5, 1.5, 1.1);
      g.add(this.treeLight);
    }
  }

  /** Wrapped presents around the tree, just for show (the ones you can open come from giftScene.js). */
  buildPresents() {
    const list = [
      // x and z from the tree, size, height, colour, ribbon colour
      [0.95, -0.6, 0.42, 0.34, 0x1f6a3a, 0xf2d46a], [-0.15, -1.0, 0.5, 0.3, 0xc8141e, 0xffffff], [0.35, -0.95, 0.3, 0.42, 0x2a56b8, 0xf2d46a],
      [-1.0, -0.65, 0.34, 0.26, 0xe8b22a, 0xc8141e], [1.2, 0.05, 0.26, 0.22, 0xf0ece4, 0xc8141e], [-0.6, -1.0, 0.26, 0.2, 0x7a2ab0, 0xffffff],
    ];
    const boxes = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.45 }), list.length);
    const straps = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35, metalness: 0.3 }), list.length * 2);
    const bows = new THREE.InstancedMesh(new THREE.TorusGeometry(1, 0.28, 6, 12), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35, metalness: 0.3 }), list.length * 2);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), col = new THREE.Color();
    list.forEach(([dx, dz, size, h, paper, ribbon], i) => {
      const turn = i * 0.7, x = TREE.x + dx, z = TREE.z + dz, y = h / 2 - 0.09;
      q.setFromAxisAngle(up, turn);
      boxes.setMatrixAt(i, m.compose(p.set(x, y, z), q, s.set(size, h, size)));
      boxes.setColorAt(i, col.setHex(paper));
      straps.setMatrixAt(i * 2, m.compose(p.set(x, y, z), q, s.set(size * 0.16, h + 0.012, size + 0.012)));
      straps.setMatrixAt(i * 2 + 1, m.compose(p.set(x, y, z), q, s.set(size + 0.012, h + 0.012, size * 0.16)));
      straps.setColorAt(i * 2, col.setHex(ribbon));
      straps.setColorAt(i * 2 + 1, col);
      for (const side of [-1, 1]) {
        const k = i * 2 + (side + 1) / 2, loop = size * 0.15;
        const qq = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, turn + Math.PI / 2, side * 0.6));
        const off = new THREE.Vector3(side * loop, 0, 0).applyQuaternion(q);
        bows.setMatrixAt(k, m.compose(p.set(x + off.x, h - 0.09 + loop * 0.5, z + off.z), qq, s.setScalar(loop)));
        bows.setColorAt(k, col.setHex(ribbon));
      }
    });
    this.add(boxes, { shadow: true });
    this.add(straps);
    this.add(bows);
  }

  /** Warm string lights hung between the stair hut, two thin poles and the mast, and clipped along the parapet. */
  buildStrings() {
    const dark = new THREE.MeshStandardMaterial({ color: 0x1c1f24, roughness: 0.7 });
    const pole = new THREE.CylinderGeometry(0.035, 0.05, 3.0, 6);
    const poles = new THREE.InstancedMesh(pole, dark, 2);
    const m = new THREE.Matrix4();
    poles.setMatrixAt(0, m.makeTranslation(-1.6, 1.4, -6.55));
    poles.setMatrixAt(1, m.makeTranslation(3.0, 1.4, -6.55));
    this.add(poles, { receive: false });

    const spans = [
      [[-6.5, 2.4, -1.55], [-1.6, 2.86, -6.55], 0.5],
      [[-1.6, 2.86, -6.55], [3.0, 2.86, -6.55], 0.5],
      [[3.0, 2.86, -6.55], [6.6, 3.2, -6.4], 0.4],
      [[3.0, 2.86, -6.55], [TREE.x + 0.05, TREE_HEIGHT - 0.2, TREE.z - 0.1], 0.35],
      [[-13, 1.1, -6.8], [-6.5, 1.1, -6.8], 0.12], [[-6.5, 1.1, -6.8], [0, 1.1, -6.8], 0.12], [[0, 1.1, -6.8], [6.5, 1.1, -6.8], 0.12], [[6.5, 1.1, -6.8], [13, 1.1, -6.8], 0.12],
    ];
    const warm = [0xffc878, 0xffd898, 0xffb860];
    const wire = [];
    const a = new THREE.Vector3(), b = new THREE.Vector3(), here = new THREE.Vector3();
    for (const [from, to, sag] of spans) {
      a.set(...from); b.set(...to);
      const len = a.distanceTo(b), dots = Math.round(len / (this.low ? 0.75 : 0.42)), segs = Math.max(8, Math.round(len * 2));
      const point = (u, out) => out.lerpVectors(a, b, u).setY(a.y + (b.y - a.y) * u - sag * 4 * u * (1 - u));
      for (let i = 0; i < segs; i++) {
        wire.push(...point(i / segs, here).toArray(), ...point((i + 1) / segs, here).toArray());
      }
      for (let i = 1; i < dots; i++) {
        point(i / dots, here);
        this.bulbs.push({ pos: here.clone().setY(here.y - 0.035), color: new THREE.Color(warm[i % warm.length]), phase: rnd() * 6.28, speed: 0.5 + rnd() * 0.8, depth: 0.22 });
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(wire, 3));
    this.add(new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0x14161a })));
    if (!this.low) {
      const glow = new THREE.PointLight(0xffc070, 2.4, 9, 1.6);
      glow.position.set(0.6, 2.4, -4.4);
      this.group.add(glow);
    }
  }

  /** Every bulb: a small bright bead and a soft halo around it, which twinkle. */
  buildBulbs() {
    const n = this.bulbs.length;
    this.beads = new THREE.InstancedMesh(new THREE.SphereGeometry(0.021, 6, 5), new THREE.MeshBasicMaterial({ color: 0xffffff }), n);
    this.haloColors = new Float32Array(n * 3);
    const pos = new Float32Array(n * 3), m = new THREE.Matrix4();
    this.bulbs.forEach((b, i) => {
      this.beads.setMatrixAt(i, m.makeTranslation(b.pos.x, b.pos.y, b.pos.z));
      this.beads.setColorAt(i, b.color);
      pos.set([b.pos.x, b.pos.y, b.pos.z], i * 3);
    });
    this.beads.frustumCulled = false;
    this.add(this.beads, { receive: false });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.haloColors, 3));
    this.halos = new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.34, map: haloTexture(), vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true }));
    this.halos.frustumCulled = false;
    this.add(this.halos);
    this.twinkle();
  }

  twinkle() {
    const col = new THREE.Color();
    this.bulbs.forEach((b, i) => {
      const k = 1 - b.depth + b.depth * (0.5 + 0.5 * Math.sin(this.time * b.speed + b.phase));
      col.copy(b.color).multiplyScalar(k);
      this.haloColors.set([col.r * 0.8, col.g * 0.8, col.b * 0.8], i * 3);
      this.beads.setColorAt(i, col.copy(b.color).multiplyScalar(0.55 + 0.75 * k));
    });
    this.halos.geometry.attributes.color.needsUpdate = true;
    this.beads.instanceColor.needsUpdate = true;
  }

  /** Falling snow in a box around the operator and the camera. */
  buildSnowfall() {
    const n = this.low ? 500 : 1800;
    const flake = new Float32Array(n * 4), size = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      flake.set([(rnd() - 0.5) * 24, rnd() * 12, -14 + rnd() * 18.5, 0.55 + rnd() * 0.7], i * 4);
      size[i] = 0.018 + rnd() * rnd() * 0.05;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    geo.setAttribute('aFlake', new THREE.BufferAttribute(flake, 4));
    geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    this.snowMat = new THREE.ShaderMaterial({ uniforms: { uTime: { value: 0 }, uHeight: { value: 800 } }, vertexShader: SNOW_VERT, fragmentShader: SNOW_FRAG, transparent: true, depthWrite: false });
    const snow = new THREE.Points(geo, this.snowMat);
    snow.frustumCulled = false;
    snow.renderOrder = 5;
    this.add(snow);
  }

  /** One frame. `height`: the height of the picture in real pixels, so flakes stay the right size. */
  update(dt, height) {
    const t = (this.time += dt);
    this.snowMat.uniforms.uTime.value = t;
    this.snowMat.uniforms.uHeight.value = height;
    this.star.rotation.y = Math.sin(t * 0.5) * 0.35;
    const pulse = 0.5 + 0.5 * Math.sin(t * 1.7);
    this.starMat.emissiveIntensity = 1.3 + pulse * 0.9;
    this.starHalo.material.opacity = 0.6 + pulse * 0.35;
    if (this.treeLight) this.treeLight.intensity = 2.8 + pulse * 0.7;
    // The bulbs change slowly: no need to touch them every frame
    this.lightTick += dt;
    if (this.lightTick > (this.low ? 0.12 : 0.05)) { this.lightTick = 0; this.twinkle(); }
  }

  dispose() {
    this.scene.remove(this.group);
    for (const d of this.disposables) d?.dispose?.();
  }
}
