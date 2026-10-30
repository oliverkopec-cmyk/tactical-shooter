// Visuals for operator gadgets: shields, barbed wire, jammers, hidden cameras
// (defenders only, the server never sends them to attackers), claymores,
// thrown grenades and smoke clouds.
// Shields also become solid boxes in the shared World so prediction and
// raycasts agree with the server.

import * as THREE from 'three';
import { claymoreLines, UTIL_STATS } from '../../shared/utilities.js';
import { barricadePlanks } from '../../shared/barricade.js';
import { BARRICADE } from '../../shared/constants.js';

const shieldMat = new THREE.MeshStandardMaterial({
  color: 0x6fb8d8, transparent: true, opacity: 0.55, roughness: 0.2, metalness: 0.4, emissive: 0x1a4a66, emissiveIntensity: 0.6,
});
const wireMat = new THREE.MeshStandardMaterial({ color: 0x2a2d31, roughness: 0.6, metalness: 0.7 });
const spikeMat = new THREE.MeshStandardMaterial({ color: 0xc9ccd1, roughness: 0.4, metalness: 0.8 });
const darkMat = new THREE.MeshStandardMaterial({ color: 0x1b1e23, roughness: 0.5, metalness: 0.5 });
const greenLed = new THREE.MeshBasicMaterial({ color: 0x4dff88 });
const redLed = new THREE.MeshBasicMaterial({ color: 0xff2a2a });
const camBodyMat = new THREE.MeshStandardMaterial({ color: 0xd9dce0, roughness: 0.45, metalness: 0.3 });
// Green painted planks with two yellow straps and a yellow cross, like a prepared window panel
const woodMats = [0x3f7a2e, 0x387028, 0x468533].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.85 }));
const strapMat = new THREE.MeshStandardMaterial({ color: 0xd9c42a, roughness: 0.7 });
let crossMat = null;
function getCrossMat() {
  if (crossMat) return crossMat;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.strokeStyle = '#e6d32a';
  g.lineWidth = 20;
  g.lineCap = 'round';
  g.beginPath(); g.moveTo(16, 16); g.lineTo(112, 112); g.moveTo(112, 16); g.lineTo(16, 112); g.stroke();
  crossMat = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false });
  return crossMat;
}
const grenadeMat = new THREE.MeshStandardMaterial({ color: 0xe8e8ff, emissive: 0x9999ff, emissiveIntensity: 0.8, roughness: 0.3 });
// One look per thrown grenade type, so you can tell what is flying at you
const GRENADE_LOOK = { stun: null, flash: null, frag: 0x3f5a3a, impact: 0xd2502f, smoke: 0x9aa0a6 };
const grenadeMats = {};
function grenadeMaterial(kind) {
  const color = GRENADE_LOOK[kind];
  if (!color) return grenadeMat;
  return (grenadeMats[kind] ||= new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.3 }));
}
const claymoreMat = new THREE.MeshStandardMaterial({ color: 0x4a5a3a, roughness: 0.7 });
const smokeGeo = new THREE.SphereGeometry(1, 12, 9);
const wireGeo = new THREE.BoxGeometry(1, 1, 1);

function makeWire(half) {
  const g = new THREE.Group();
  const size = half * 2;
  // A few criss-crossing coils of wire with spikes along them
  const rng = (i) => ((Math.sin(i * 91.7 + half) * 43758.5453) % 1 + 1) % 1;
  for (let i = 0; i < 9; i++) {
    const wire = new THREE.Mesh(new THREE.BoxGeometry(size * 0.95, 0.018, 0.018), wireMat);
    wire.position.set(0, 0.05 + rng(i) * 0.3, (rng(i + 20) - 0.5) * size * 0.9);
    wire.rotation.y = (rng(i + 40) - 0.5) * 0.7;
    g.add(wire);
  }
  for (let i = 0; i < 26; i++) {
    const spike = new THREE.Mesh(new THREE.ConeGeometry(0.018, 0.1, 5), spikeMat);
    spike.position.set((rng(i + 60) - 0.5) * size * 0.9, 0.08 + rng(i + 80) * 0.3, (rng(i + 100) - 0.5) * size * 0.9);
    spike.rotation.set((rng(i + 120) - 0.5) * 2, 0, (rng(i + 140) - 0.5) * 2);
    g.add(spike);
  }
  const posts = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
  for (const [sx, sz] of posts) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.5, 6), darkMat);
    post.position.set(sx * half * 0.9, 0.25, sz * half * 0.9);
    g.add(post);
  }
  return g;
}

function makeJammer() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.2, 0.12), darkMat);
  const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.25, 6), spikeMat);
  ant.position.set(0.09, 0.2, 0);
  const led = new THREE.Mesh(new THREE.SphereGeometry(0.02, 8, 6), greenLed);
  led.position.set(-0.08, 0.05, 0.065);
  g.add(body, ant, led);
  g.userData.led = led;
  return g;
}

/** A small security camera: light housing, black lens, a blinking red light so it can be spotted. */
function makeCamera() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.12, 0.22), camBodyMat);
  const mount = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.05), darkMat);
  mount.position.z = -0.13;
  const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.05, 12).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x050508, metalness: 0.9, roughness: 0.1 }));
  lens.position.z = 0.13;
  const led = new THREE.Mesh(new THREE.SphereGeometry(0.022, 8, 6), redLed);
  led.position.set(0.055, 0.075, 0.08);
  g.add(body, mount, lens, led);
  g.userData.led = led;
  return g;
}

/** A claymore: a curved olive-drab plate on two legs with a red light. It faces +z. */
function makeClaymore() {
  const g = new THREE.Group();
  const plate = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.13, 0.045), claymoreMat);
  plate.position.set(0, 0.1, 0);
  for (const sx of [-0.09, 0.09]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.08, 5), darkMat);
    leg.position.set(sx, 0.04, -0.01);
    g.add(leg);
  }
  const face = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.09, 0.012), new THREE.MeshStandardMaterial({ color: 0x20261a, roughness: 0.9 }));
  face.position.set(0, 0.1, 0.028);
  const led = new THREE.Mesh(new THREE.SphereGeometry(0.014, 8, 6), redLed);
  led.position.set(0.1, 0.17, 0.02);
  g.add(plate, face, led);
  g.userData.led = led;
  return g;
}

/** A shock trap: a dark pad with a glowing cyan ring. */
function makeShockPad() {
  const g = new THREE.Group();
  const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.45, 0.05, 20), darkMat);
  const ringMat = new THREE.MeshBasicMaterial({ color: 0x39f0ff });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.018, 6, 24).rotateX(Math.PI / 2), ringMat);
  ring.position.y = 0.04;
  g.add(pad, ring);
  g.userData.led = ring;
  return g;
}

/** A healing field: a soft green disc and ring on the floor. */
function makeHealField(radius) {
  const g = new THREE.Group();
  const disc = new THREE.Mesh(new THREE.CircleGeometry(radius, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x6fdc7a, transparent: true, opacity: 0.16, depthWrite: false }));
  const ring = new THREE.Mesh(new THREE.RingGeometry(radius - 0.1, radius, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x6fdc7a, transparent: true, opacity: 0.6, depthWrite: false }));
  disc.position.y = ring.position.y = 0.05;
  g.add(disc, ring);
  return g;
}

export class GadgetView {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    this.items = new Map();      // "kind:id" -> { kind, group, rec }
    this.grenades = new Map();   // id -> { mesh, target }
    this.smokes = [];            // { group, age, life, size }
    this.fires = [];             // Cinder's fire patches: { group, age, life, flames }
    this.t = 0;
  }

  add(rec) {
    const key = `${rec.kind}:${rec.id}`;
    if (this.items.has(key)) return;
    let group;
    if (rec.kind === 'shield') {
      const sx = rec.max[0] - rec.min[0], sy = rec.max[1] - rec.min[1], sz = rec.max[2] - rec.min[2];
      group = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), shieldMat);
      group.position.set(rec.min[0] + sx / 2, rec.min[1] + sy / 2, rec.min[2] + sz / 2);
      this.world.addBox({ id: `shield-${rec.id}`, kind: 'shield', min: rec.min, max: rec.max });
    } else if (rec.kind === 'wire') {
      group = makeWire(rec.half);
      group.position.set(rec.x, rec.y, rec.z);
    } else if (rec.kind === 'jammer') {
      group = makeJammer();
      group.position.set(...rec.pos);
    } else if (rec.kind === 'barricade') {
      // Wooden planks over a doorway or window; the server sends which planks still stand
      group = new THREE.Group();
      group.userData.meshes = new Map();
      const opening = this.world.map.openings.find((o) => o.id === rec.openingId);
      const standing = new Set(rec.planks);
      for (const p of opening ? barricadePlanks(opening) : []) {
        if (!standing.has(p.i)) continue;
        const sx = p.max[0] - p.min[0], sy = p.max[1] - p.min[1], sz = p.max[2] - p.min[2];
        const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), woodMats[p.i % woodMats.length]);
        m.position.set(p.min[0] + sx / 2, p.min[1] + sy / 2, p.min[2] + sz / 2);
        m.castShadow = true;
        group.add(m);
        group.userData.meshes.set(p.i, m);
        this.world.addBox({ id: `bar-${rec.id}-${p.i}`, kind: 'barricade', barricadeId: rec.id, panelIndex: p.i, min: p.min, max: p.max });
      }
      if (opening) group.add(group.userData.deco = barricadeDecor(opening, standing.size === 6));
    } else if (rec.kind === 'claymore') {
      group = makeClaymore();
      group.position.set(...rec.pos);
      group.lookAt(rec.pos[0] + rec.dir[0], rec.pos[1], rec.pos[2] + rec.dir[2]);
    } else if (rec.kind === 'shock') {
      group = makeShockPad();
      group.position.set(...rec.pos);
    } else if (rec.kind === 'heal') {
      group = makeHealField(3);
      group.position.set(...rec.pos);
    } else if (rec.kind === 'sensor') {
      group = makeClaymore();
      group.scale.setScalar(0.7);
      group.position.set(...rec.pos);
      group.lookAt(rec.pos[0] + rec.dir[0], rec.pos[1], rec.pos[2] + rec.dir[2]);
    } else if (rec.kind === 'camera') {
      group = makeCamera();
      group.position.set(...rec.pos);
      group.lookAt(rec.pos[0] + rec.dir[0], rec.pos[1] + rec.dir[1], rec.pos[2] + rec.dir[2]);
    } else return;
    group.traverse((o) => { if (o.isMesh) o.castShadow = rec.kind !== 'shield'; });
    this.scene.add(group);
    const item = { kind: rec.kind, group, rec };
    if (rec.kind === 'claymore' || rec.kind === 'sensor') {
      // Three faint laser tripwires, shown once it is armed (alarm sensors: at once, in green). Each one is cut short by the first thing in its way.
      item.born = performance.now();
      item.armMs = rec.kind === 'claymore' ? UTIL_STATS.claymore.arm * 1000 : 0;
      item.lines = [0, 1, 2].map(() => {
        const m = new THREE.Mesh(wireGeo, new THREE.MeshBasicMaterial({ color: rec.kind === 'sensor' ? 0x4dff88 : 0xff3030, transparent: true, opacity: 0.4, depthWrite: false }));
        m.visible = false;
        this.scene.add(m);
        return m;
      });
    }
    this.items.set(key, item);
  }

  remove(kind, id) {
    const key = `${kind}:${id}`;
    const it = this.items.get(key);
    if (!it) return;
    if (kind === 'shield') this.world.removeBox(`shield-${id}`);
    if (kind === 'barricade') for (const i of it.group.userData.meshes.keys()) this.world.removeBox(`bar-${id}-${i}`);
    this.scene.remove(it.group);
    for (const m of it.lines || []) { this.scene.remove(m); m.material.dispose(); }
    this.items.delete(key);
  }

  /** Planks knocked out of a barricade: returns their centres (for debris). */
  breakPanels(id, ids) {
    const it = this.items.get(`barricade:${id}`);
    if (!it) return [];
    const centers = [];
    for (const i of ids) {
      const m = it.group.userData.meshes.get(i);
      if (!m) continue;
      centers.push([m.position.x, m.position.y, m.position.z]);
      it.group.remove(m);
      it.group.userData.meshes.delete(i);
      this.world.removeBox(`bar-${id}-${i}`);
    }
    if (it.group.userData.deco) it.group.userData.deco.visible = false;   // straps and cross go once the panel is damaged
    return centers;
  }

  hasBarricade(openingId) {
    for (const it of this.items.values()) if (it.kind === 'barricade' && it.rec.openingId === openingId) return true;
    return false;
  }

  /** Hide the housing of the camera being watched (the feed starts inside it). */
  watchCamera(id) {
    for (const it of this.items.values()) if (it.kind === 'camera') it.group.visible = it.rec.id !== id;
  }

  cameras() {
    return [...this.items.values()].filter((i) => i.kind === 'camera').map((i) => i.rec);
  }

  clear() {
    for (const it of this.items.values()) {
      this.scene.remove(it.group);
      for (const m of it.lines || []) this.scene.remove(m);
    }
    this.items.clear();
    for (const g of this.grenades.values()) this.scene.remove(g.mesh);
    this.grenades.clear();
    for (const s of this.smokes) this.scene.remove(s.group);
    this.smokes = [];
    for (const f of this.fires) this.scene.remove(f.group);
    this.fires = [];
  }

  /** Cinder's fire canister landed: flickering flames over the burning area for `ms`. */
  addFire({ id, pos, ms, radius }) {
    const group = new THREE.Group();
    group.position.set(pos[0], pos[1], pos[2]);
    const flames = [];
    let seed = id * 7919 + 13;
    const rand = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
    for (let i = 0; i < 16; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: i % 3 === 0 ? 0xffd24a : 0xff6a1a, transparent: true, opacity: 0.85 });
      const f = new THREE.Mesh(wireGeo, mat);
      const a = rand() * Math.PI * 2, d = Math.sqrt(rand()) * radius * 0.9;
      f.position.set(Math.cos(a) * d, 0.2, Math.sin(a) * d);
      f.userData = { phase: rand() * 6.28, base: 0.4 + rand() * 0.5 };
      group.add(f);
      flames.push(f);
    }
    const light = new THREE.PointLight(0xff7a1a, 6, radius * 3, 1.6);
    light.position.y = 0.8;
    group.add(light);
    this.scene.add(group);
    this.fires.push({ group, age: 0, life: ms / 1000, flames, light });
  }

  /** A smoke grenade went off: a cloud of overlapping soft balls that grows, hangs, then thins out. */
  addSmoke({ id, pos, ms, radius }) {
    const group = new THREE.Group();
    group.position.set(pos[0], pos[1], pos[2]);
    let seed = id * 9301 + 49297;
    const rand = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
    for (let i = 0; i < 22; i++) {
      const shade = 0xa4 + Math.floor(rand() * 0x20);   // light greys, slightly blue
      const mat = new THREE.MeshBasicMaterial({ color: (shade << 16) | (shade << 8) | (shade + 6), transparent: true, opacity: 0.93, depthWrite: true, fog: false });
      const ball = new THREE.Mesh(smokeGeo, mat);
      const r = radius * (0.32 + rand() * 0.3);
      ball.scale.setScalar(r);
      const a = rand() * Math.PI * 2, d = rand() * radius * 0.55;
      ball.position.set(Math.cos(a) * d, r * 0.25 + rand() * radius * 0.45, Math.sin(a) * d);
      group.add(ball);
    }
    this.scene.add(group);
    this.smokes.push({ group, age: 0, life: ms / 1000 });
  }

  syncGrenades(list) {
    const seen = new Set();
    for (const g of list) {
      seen.add(g.id);
      let e = this.grenades.get(g.id);
      if (!e) {
        const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.075, 10, 8), grenadeMaterial(g.k));
        mesh.position.set(g.x, g.y, g.z);
        this.scene.add(mesh);
        e = { mesh, target: g };
        this.grenades.set(g.id, e);
      }
      e.target = g;
    }
    for (const [id, e] of this.grenades) {
      if (!seen.has(id)) { this.scene.remove(e.mesh); this.grenades.delete(id); }
    }
  }

  update(dt) {
    this.t += dt;
    const k = 1 - Math.exp(-25 * dt);
    for (const e of this.grenades.values()) {
      e.mesh.position.x += (e.target.x - e.mesh.position.x) * k;
      e.mesh.position.y += (e.target.y - e.mesh.position.y) * k;
      e.mesh.position.z += (e.target.z - e.mesh.position.z) * k;
    }
    for (let i = this.fires.length - 1; i >= 0; i--) {
      const f = this.fires[i];
      f.age += dt;
      if (f.age >= f.life) { this.scene.remove(f.group); this.fires.splice(i, 1); continue; }
      const fade = Math.min(1, (f.life - f.age) / 1.5);
      for (const fl of f.flames) {
        const h = fl.userData.base * (0.7 + 0.5 * Math.sin(this.t * 9 + fl.userData.phase)) * fade;
        fl.scale.set(0.3, Math.max(0.05, h), 0.3);
        fl.position.y = h / 2;
      }
      f.light.intensity = 6 * fade * (0.8 + 0.2 * Math.sin(this.t * 12));
    }
    for (let i = this.smokes.length - 1; i >= 0; i--) {
      const s = this.smokes[i];
      s.age += dt;
      if (s.age >= s.life) { this.scene.remove(s.group); this.smokes.splice(i, 1); continue; }
      const grow = Math.min(1, s.age / 0.9), fade = Math.min(1, (s.life - s.age) / 3);
      s.group.scale.setScalar(0.25 + 0.75 * (1 - (1 - grow) ** 2));
      for (const ball of s.group.children) ball.material.opacity = 0.93 * fade;
    }
    // Claymore tripwires: recomputed every frame so they stop where walls, props, shields or barricades are
    for (const it of this.items.values()) {
      if (!it.lines) continue;
      const armed = performance.now() - it.born >= it.armMs;
      const lines = armed ? claymoreLines(this.world, it.rec.pos, it.rec.dir) : null;
      const pulse = 0.32 + 0.1 * Math.sin(this.t * 6);
      it.lines.forEach((mesh, i) => {
        mesh.visible = !!lines;
        if (!lines) return;
        const { from, to, len } = lines[i];
        mesh.visible = len > 0.05;
        mesh.position.set((from[0] + to[0]) / 2, from[1], (from[2] + to[2]) / 2);
        mesh.scale.set(0.012, 0.012, len);
        mesh.lookAt(to[0], to[1], to[2]);
        mesh.material.opacity = pulse;
      });
    }
    const on = this.t % 1.2 < 0.25;
    for (const it of this.items.values()) {
      const led = it.group.userData?.led;
      if (led) led.visible = on;
    }
  }
}

/** Two yellow straps and a cross on both faces of a barricade panel. */
function barricadeDecor(o, intact) {
  const g = new THREE.Group();
  g.visible = intact;
  const bottom = o.y0 + (o.window ? 0 : BARRICADE.gap), h = o.y1 - bottom, w = o.to - o.from;
  const cx = (o.from + o.to) / 2, cy = bottom + h / 2, t = BARRICADE.thickness / 2 + 0.01;
  const flat = o.axis === 'x';                       // wall runs along x: faces point along z
  const put = (mesh, along, y, face) => {
    mesh.position.set(flat ? along : o.fixed + face * t, y, flat ? o.fixed + face * t : along);
    mesh.rotation.y = flat ? (face < 0 ? Math.PI : 0) : face * Math.PI / 2;
    g.add(mesh);
  };
  for (const face of [-1, 1]) {
    for (const f of [0.12, 0.88]) {
      const strap = new THREE.Mesh(new THREE.PlaneGeometry(Math.min(0.12, w * 0.08), h), strapMat);
      put(strap, o.from + w * f, cy, face);
    }
    const size = Math.min(w * 0.6, h * 0.85);
    const cross = new THREE.Mesh(new THREE.PlaneGeometry(size, size), getCrossMat());
    put(cross, cx, cy, face);
  }
  return g;
}
