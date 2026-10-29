// Visuals for operator gadgets: shields, barbed wire, jammers, hidden cameras
// (defenders only, the server never sends them to attackers), claymores,
// thrown grenades and smoke clouds.
// Shields also become solid boxes in the shared World so prediction and
// raycasts agree with the server.

import * as THREE from 'three';

const shieldMat = new THREE.MeshStandardMaterial({
  color: 0x6fb8d8, transparent: true, opacity: 0.55, roughness: 0.2, metalness: 0.4, emissive: 0x1a4a66, emissiveIntensity: 0.6,
});
const wireMat = new THREE.MeshStandardMaterial({ color: 0x2a2d31, roughness: 0.6, metalness: 0.7 });
const spikeMat = new THREE.MeshStandardMaterial({ color: 0xc9ccd1, roughness: 0.4, metalness: 0.8 });
const darkMat = new THREE.MeshStandardMaterial({ color: 0x1b1e23, roughness: 0.5, metalness: 0.5 });
const greenLed = new THREE.MeshBasicMaterial({ color: 0x4dff88 });
const redLed = new THREE.MeshBasicMaterial({ color: 0xff2a2a });
const camBodyMat = new THREE.MeshStandardMaterial({ color: 0xd9dce0, roughness: 0.45, metalness: 0.3 });
const woodMats = [0x8a5a2b, 0x7a4e24, 0x96663a].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.9 }));
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

export class GadgetView {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    this.items = new Map();      // "kind:id" -> { kind, group, rec }
    this.grenades = new Map();   // id -> { mesh, target }
    this.smokes = [];            // { group, age, life, size }
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
      // Wooden planks over a doorway or window, one box per breakable panel
      group = new THREE.Group();
      group.userData.meshes = new Map();
      for (const p of rec.panels) {
        const sx = p.max[0] - p.min[0], sy = p.max[1] - p.min[1], sz = p.max[2] - p.min[2];
        const m = new THREE.Mesh(new THREE.BoxGeometry(sx * 0.97, sy * 0.94, sz), woodMats[p.i % woodMats.length]);
        m.position.set(p.min[0] + sx / 2, p.min[1] + sy / 2, p.min[2] + sz / 2);
        m.castShadow = true;
        group.add(m);
        group.userData.meshes.set(p.i, m);
        this.world.addBox({ id: `bar-${rec.id}-${p.i}`, kind: 'barricade', barricadeId: rec.id, panelIndex: p.i, min: p.min, max: p.max });
      }
    } else if (rec.kind === 'claymore') {
      group = makeClaymore();
      group.position.set(...rec.pos);
      group.lookAt(rec.pos[0] + rec.dir[0], rec.pos[1], rec.pos[2] + rec.dir[2]);
    } else if (rec.kind === 'camera') {
      group = makeCamera();
      group.position.set(...rec.pos);
      group.lookAt(rec.pos[0] + rec.dir[0], rec.pos[1] + rec.dir[1], rec.pos[2] + rec.dir[2]);
    } else return;
    group.traverse((o) => { if (o.isMesh) o.castShadow = rec.kind !== 'shield'; });
    this.scene.add(group);
    this.items.set(key, { kind: rec.kind, group, rec });
  }

  remove(kind, id) {
    const key = `${kind}:${id}`;
    const it = this.items.get(key);
    if (!it) return;
    if (kind === 'shield') this.world.removeBox(`shield-${id}`);
    if (kind === 'barricade') for (const i of it.group.userData.meshes.keys()) this.world.removeBox(`bar-${id}-${i}`);
    this.scene.remove(it.group);
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
    for (const it of this.items.values()) this.scene.remove(it.group);
    this.items.clear();
    for (const g of this.grenades.values()) this.scene.remove(g.mesh);
    this.grenades.clear();
    for (const s of this.smokes) this.scene.remove(s.group);
    this.smokes = [];
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
    for (let i = this.smokes.length - 1; i >= 0; i--) {
      const s = this.smokes[i];
      s.age += dt;
      if (s.age >= s.life) { this.scene.remove(s.group); this.smokes.splice(i, 1); continue; }
      const grow = Math.min(1, s.age / 0.9), fade = Math.min(1, (s.life - s.age) / 3);
      s.group.scale.setScalar(0.25 + 0.75 * (1 - (1 - grow) ** 2));
      for (const ball of s.group.children) ball.material.opacity = 0.93 * fade;
    }
    const on = this.t % 1.2 < 0.25;
    for (const it of this.items.values()) {
      const led = it.group.userData?.led;
      if (led) led.visible = on;
    }
  }
}
