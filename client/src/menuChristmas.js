// The rooftop at Christmas (Stage M): snow on the roof, the platform and everything on the roof, falling snow and warm
// string lights behind the operator. The tree and the presents are in the Christmas room (christmasRoom.js). Instanced
// and merged, so it costs only a few draw calls; `low` (the Low graphics setting) has less snow and no extra light.

import * as THREE from 'three';

/** Small repeatable random numbers. */
export const seededRandom = (seed) => { let a = seed >>> 0; return () => { a = (a * 1103515245 + 12345) >>> 0; return a / 4294967296; }; };
const rnd = seededRandom(2512);

export function canvasTexture(w, h, fn) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  fn(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
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

export function haloTexture() {
  return canvasTexture(64, 64, (g) => {
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.25, 'rgba(255,255,255,0.5)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
  });
}

/** Lots of little lights: a bright bead and a soft halo each, which twinkle. Add them all, then build() once. */
export class TwinklingBulbs {
  constructor({ low = false } = {}) {
    this.low = low;
    this.list = [];
    this.time = 0;
    this.tick = 0;
  }

  /** depth: how much it twinkles (0 steady, 1 goes right down). */
  add(pos, hex, depth = 0.3) {
    this.list.push({ pos: pos.clone(), color: new THREE.Color(hex), phase: rnd() * 6.28, speed: 0.6 + rnd() * 2.4, depth });
  }

  build() {
    const n = this.list.length, group = new THREE.Group();
    this.beads = new THREE.InstancedMesh(new THREE.SphereGeometry(0.021, 6, 5), new THREE.MeshBasicMaterial({ color: 0xffffff }), n);
    this.haloColors = new Float32Array(n * 3);
    const pos = new Float32Array(n * 3), m = new THREE.Matrix4();
    this.list.forEach((b, i) => {
      this.beads.setMatrixAt(i, m.makeTranslation(b.pos.x, b.pos.y, b.pos.z));
      this.beads.setColorAt(i, b.color);
      pos.set([b.pos.x, b.pos.y, b.pos.z], i * 3);
    });
    this.beads.frustumCulled = false;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.haloColors, 3));
    this.map = haloTexture();
    this.halos = new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.34, map: this.map, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true }));
    this.halos.frustumCulled = false;
    group.add(this.beads, this.halos);
    this.twinkle();
    return group;
  }

  twinkle() {
    const col = new THREE.Color();
    this.list.forEach((b, i) => {
      const k = 1 - b.depth + b.depth * (0.5 + 0.5 * Math.sin(this.time * b.speed + b.phase));
      col.copy(b.color).multiplyScalar(k);
      this.haloColors.set([col.r * 0.8, col.g * 0.8, col.b * 0.8], i * 3);
      this.beads.setColorAt(i, col.copy(b.color).multiplyScalar(0.55 + 0.75 * k));
    });
    this.halos.geometry.attributes.color.needsUpdate = true;
    this.beads.instanceColor.needsUpdate = true;
  }

  /** They change slowly: no need to touch them every frame. */
  update(dt) {
    this.time += dt;
    this.tick += dt;
    if (this.tick > (this.low ? 0.12 : 0.05)) { this.tick = 0; this.twinkle(); }
  }

  dispose() {
    this.beads?.geometry.dispose(); this.beads?.material.dispose(); this.beads?.dispose();
    this.halos?.geometry.dispose(); this.halos?.material.dispose(); this.map?.dispose();
  }
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
    this.bulbs = new TwinklingBulbs({ low });
    scene.add(this.group);
    this.buildGroundSnow();
    this.buildSnowOnThings();
    this.buildStrings();
    this.group.add(this.bulbs.build());
    this.disposables.push(this.bulbs);
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
        this.bulbs.add(here.clone().setY(here.y - 0.035), warm[i % warm.length], 0.22);
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
    this.bulbs.update(dt);
  }

  dispose() {
    this.scene.remove(this.group);
    for (const d of this.disposables) d?.dispose?.();
  }
}
