// Short-lived visual effects in the world: tracers, bullet holes, impact puffs.

import * as THREE from 'three';

const MAX_DECALS = 150;
const TRACER_LIFE = 0.07;
const PUFF_LIFE = 0.25;

const unitBox = new THREE.BoxGeometry(1, 1, 1);
const tracerMat = new THREE.MeshBasicMaterial({ color: 0xffe9a0, transparent: true, opacity: 0.9, depthWrite: false });
const puffGeo = new THREE.SphereGeometry(1, 8, 6);
const DEBRIS_LIFE = 1.3;
const SPARK_LIFE = 0.5;
const sparkMat = new THREE.MeshBasicMaterial({ color: 0xffe08a, transparent: true });
const MAX_DEBRIS = 300;

// ---- bullet impacts (Stage 2G): a hole drawn in code for each kind of surface, and what flies off it

function decalTexture(surface) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.translate(32, 32);
  const blob = (r, color, jag = 0.25) => {
    g.fillStyle = color;
    g.beginPath();
    for (let i = 0; i <= 14; i++) { const a = (i / 14) * Math.PI * 2, rr = r * (1 - jag + Math.random() * jag * 2); g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); }
    g.fill();
  };
  const rays = (n, len, color, width) => {
    g.strokeStyle = color; g.lineWidth = width;
    for (let i = 0; i < n; i++) { const a = Math.random() * Math.PI * 2, l = len * (0.5 + Math.random() * 0.5); g.beginPath(); g.moveTo(Math.cos(a) * 4, Math.sin(a) * 4); g.lineTo(Math.cos(a) * l, Math.sin(a) * l); g.stroke(); }
  };
  if (surface === 'wood') {
    blob(17, 'rgba(196,150,96,0.85)', 0.45);            // torn light wood around it
    rays(9, 28, 'rgba(214,170,110,0.9)', 2.5);           // splinters
    blob(8, 'rgba(40,24,12,0.95)');
    blob(4.5, 'rgba(8,5,3,1)', 0.1);
  } else if (surface === 'metal') {
    const ring = g.createRadialGradient(0, 0, 4, 0, 0, 16);
    ring.addColorStop(0, 'rgba(230,232,236,0.95)'); ring.addColorStop(0.5, 'rgba(150,152,158,0.6)'); ring.addColorStop(1, 'rgba(60,60,60,0)');
    g.fillStyle = ring; g.fillRect(-32, -32, 64, 64);     // bright scraped dent
    blob(5, 'rgba(30,30,32,0.95)', 0.1);
  } else if (surface === 'glass') {
    rays(14, 31, 'rgba(235,248,255,0.85)', 1.2);         // cracks spreading out
    g.strokeStyle = 'rgba(235,248,255,0.6)'; g.lineWidth = 1;
    for (const r of [8, 15, 23]) { g.beginPath(); for (let i = 0; i <= 10; i++) { const a = (i / 10) * Math.PI * 2; g.lineTo(Math.cos(a) * r * (0.85 + Math.random() * 0.3), Math.sin(a) * r * (0.85 + Math.random() * 0.3)); } g.stroke(); }
    blob(3.5, 'rgba(255,255,255,0.95)', 0.2);
  } else {
    const dust = g.createRadialGradient(0, 0, 4, 0, 0, 24);
    dust.addColorStop(0, 'rgba(60,58,55,0.8)'); dust.addColorStop(0.45, 'rgba(120,116,110,0.55)'); dust.addColorStop(1, 'rgba(160,156,150,0)');
    g.fillStyle = dust; g.fillRect(-32, -32, 64, 64);     // a chipped crater with dust around it
    blob(10, 'rgba(95,92,88,0.9)', 0.4);
    blob(5, 'rgba(18,17,16,1)', 0.25);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const decalGeo = new THREE.PlaneGeometry(1, 1);
const decalMat = (surface) => new THREE.MeshLambertMaterial({ map: decalTexture(surface), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });
const IMPACT = {
  wood: { size: 0.09, dust: 0xb08a5a, puff: 0.08, chips: 4, chipColor: 0x9a6a38, splinter: true, sparks: 0 },
  metal: { size: 0.07, dust: 0x9aa0a8, puff: 0.04, chips: 0, chipColor: 0, sparks: 7 },
  concrete: { size: 0.1, dust: 0xb8b4aa, puff: 0.13, chips: 3, chipColor: 0x8c8a84, sparks: 0 },
  glass: { size: 0.16, dust: 0xe8f6ff, puff: 0.05, chips: 6, chipColor: 0xbfe4f5, sparks: 0 },
};
let decalMats = null;   // made on first use (they need a canvas)

function smokeTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d'), grad = g.createRadialGradient(32, 32, 2, 32, 32, 30);
  grad.addColorStop(0, 'rgba(255,255,255,0.8)'); grad.addColorStop(0.5, 'rgba(255,255,255,0.3)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}
let smokeTex = null;
const casingGeo = new THREE.CylinderGeometry(1, 1, 1, 8).rotateX(Math.PI / 2);
const casingMats = { brass: new THREE.MeshStandardMaterial({ color: 0xd9a441, roughness: 0.35, metalness: 0.8 }), shell: new THREE.MeshStandardMaterial({ color: 0xa8241c, roughness: 0.5 }) };

export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.live = [];     // { mesh, life, maxLife, kind, vel? }
    this.decals = [];   // meshes; userData.panelId when stuck to a destructible panel
    this.debrisCount = 0;
  }

  tracer(from, to) {
    const a = new THREE.Vector3(...from), b = new THREE.Vector3(...to);
    const len = a.distanceTo(b);
    if (len < 0.5) return;
    const mesh = new THREE.Mesh(unitBox, tracerMat.clone());
    mesh.scale.set(0.015, 0.015, len);
    mesh.position.copy(a).add(b).multiplyScalar(0.5);
    mesh.lookAt(b);
    this.add(mesh, TRACER_LIFE, 'tracer');
  }

  /**
   * A bullet hit a wall: a hole drawn for what it hit (surfaceOf() in shared/gunConfig.js), turned at random, and
   * what flies off it: wood throws splinters and tan dust, metal sparks, concrete grey dust and chips, glass shards.
   */
  bulletHole(point, normal, panelId = null, surface = 'concrete') {
    const look = IMPACT[surface] || IMPACT.concrete;
    decalMats ||= Object.fromEntries(Object.keys(IMPACT).map((s) => [s, decalMat(s)]));
    const mesh = new THREE.Mesh(decalGeo, decalMats[surface] || decalMats.concrete);
    mesh.userData.panelId = panelId;
    mesh.position.set(point[0] + normal[0] * 0.004, point[1] + normal[1] * 0.004, point[2] + normal[2] * 0.004);
    mesh.lookAt(point[0] + normal[0], point[1] + normal[1], point[2] + normal[2]);
    mesh.rotateZ(Math.random() * Math.PI * 2);
    mesh.scale.setScalar(look.size * (0.85 + Math.random() * 0.3));
    this.scene.add(mesh);
    this.decals.push(mesh);
    if (this.decals.length > MAX_DECALS) this.scene.remove(this.decals.shift());
    const out = [point[0] + normal[0] * 0.05, point[1] + normal[1] * 0.05, point[2] + normal[2] * 0.05];
    this.puff(out, look.dust, look.puff, surface === 'concrete' ? 0.55 : PUFF_LIFE);
    const away = [-normal[0], -normal[1], -normal[2]];
    if (look.chips) this.debris(out, look.chipColor, look.chips, away, look.splinter ? 'splinter' : surface === 'glass' ? 'shard' : 'chip');
    if (look.sparks) { this.sparks(out, look.sparks, false); this.puff(out, 0xffe2a0, 0.035, 0.06); }
  }

  /** A shell casing thrown out of a gun at `from`, to the `right` of the shooter (a short tumbling arc, then gone). */
  casing(from, right, kind = 'rifle') {
    if (kind === 'none' || this.debrisCount >= MAX_DEBRIS) return;
    const shell = kind === 'shell';
    const mesh = new THREE.Mesh(casingGeo, shell ? casingMats.shell : casingMats.brass);
    mesh.scale.set(shell ? 0.01 : 0.0055, shell ? 0.01 : 0.0055, shell ? 0.05 : kind === 'rifle' ? 0.036 : 0.02);
    mesh.position.set(...from);
    const vel = new THREE.Vector3(right[0] * (1.4 + Math.random()), 1.2 + Math.random(), right[2] * (1.4 + Math.random()));
    this.debrisCount++;
    this.scene.add(mesh);
    this.live.push({ mesh, life: 0.8, maxLife: 0.8, kind: 'casing', vel, shared: true });
  }

  /** Smoke drifting from a muzzle after shooting: a few soft puffs that rise, spread and fade. */
  muzzleSmoke(pos, amount = 1) {
    if (amount <= 0 || Math.random() > 0.35 * amount + 0.1) return;
    smokeTex ||= smokeTexture();
    const mat = new THREE.SpriteMaterial({ map: smokeTex, color: 0xb8b8b8, transparent: true, opacity: 0.22 * Math.min(1.5, amount), depthWrite: false });
    const s = new THREE.Sprite(mat);
    s.position.set(pos[0] + (Math.random() - 0.5) * 0.05, pos[1], pos[2] + (Math.random() - 0.5) * 0.05);
    s.userData.size = 0.12 + Math.random() * 0.08;
    s.userData.alpha = mat.opacity;
    s.scale.setScalar(s.userData.size);
    this.scene.add(s);
    this.live.push({ mesh: s, life: 1.1, maxLife: 1.1, kind: 'smoke', vel: new THREE.Vector3((Math.random() - 0.5) * 0.15, 0.25 + Math.random() * 0.15, (Math.random() - 0.5) * 0.15) });
  }

  puff(point, color, size, life = PUFF_LIFE) {
    const mesh = new THREE.Mesh(puffGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, depthWrite: false }));
    mesh.position.set(...point);
    mesh.scale.setScalar(size);
    mesh.userData.size = size;
    this.add(mesh, life, 'puff');
  }

  /** A flat ring that spreads out to `radius` on the floor (seismic pulse, EMP). */
  ring(center, radius, color, life = 0.7) {
    const mesh = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 48), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide }));
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(center[0], center[1] + 0.08, center[2]);
    mesh.userData.size = radius;
    mesh.scale.setScalar(0.2);
    this.add(mesh, life, 'ring');
  }

  removeDecalsOnPanels(ids) {
    const gone = new Set(ids);
    this.decals = this.decals.filter((d) => {
      if (d.userData.panelId === null || !gone.has(d.userData.panelId)) return true;
      this.scene.remove(d);
      return false;
    });
  }

  /** Chunks flying off a broken panel. `push` biases them along a direction. */
  debris(center, color, count = 4, push = null, shape = 'chunk') {
    for (let i = 0; i < count && this.debrisCount < MAX_DEBRIS; i++) {
      const small = shape !== 'chunk', s = small ? 0.012 + Math.random() * 0.02 : 0.06 + Math.random() * 0.12;
      const mesh = new THREE.Mesh(unitBox, new THREE.MeshStandardMaterial({ color, roughness: shape === 'shard' ? 0.1 : 0.9, metalness: shape === 'shard' ? 0.6 : 0, transparent: true, opacity: shape === 'shard' ? 0.7 : 1 }));
      if (shape === 'splinter') mesh.scale.set(s * 0.4, s * 0.4, s * 3.5);           // long thin wood splinters
      else if (shape === 'shard') mesh.scale.set(s * 1.4, s * 0.15, s);               // flat glass shards
      else mesh.scale.set(s, s * (0.5 + Math.random()), s);
      mesh.position.set(center[0] + (Math.random() - 0.5) * 0.4, center[1] + (Math.random() - 0.5) * 0.4, center[2] + (Math.random() - 0.5) * 0.4);
      mesh.rotation.set(Math.random() * 3, Math.random() * 3, 0);
      const k = push ? (small ? 2.5 : 5) : 2;
      const vel = new THREE.Vector3(
        (Math.random() - 0.5) * 3 + (push ? -push[0] * k * Math.random() : 0),
        Math.random() * 2.5,
        (Math.random() - 0.5) * 3 + (push ? -push[2] * k * Math.random() : 0),
      );
      this.debrisCount++;
      this.scene.add(mesh);
      this.live.push({ mesh, life: DEBRIS_LIFE, maxLife: DEBRIS_LIFE, kind: 'debris', vel });
    }
  }

  /** A burst of bright sparks that fall and fade (a gadget hit by a bullet), with a short flash of light. */
  sparks(center, count = 8, light = true) {
    for (let i = 0; i < count && this.debrisCount < MAX_DEBRIS; i++) {
      const mesh = new THREE.Mesh(unitBox, sparkMat.clone());
      mesh.material.color.setHex(Math.random() < 0.4 ? 0xffffff : Math.random() < 0.5 ? 0xffc23a : 0x8fd8ff);
      mesh.scale.set(0.012, 0.012, 0.05 + Math.random() * 0.05);
      mesh.position.set(...center);
      const vel = new THREE.Vector3((Math.random() - 0.5) * 5, 1 + Math.random() * 3, (Math.random() - 0.5) * 5);
      mesh.lookAt(mesh.position.clone().add(vel));
      this.debrisCount++;
      this.scene.add(mesh);
      this.live.push({ mesh, life: SPARK_LIFE * (0.5 + Math.random() * 0.5), maxLife: SPARK_LIFE, kind: 'spark', vel });
    }
    if (!light) return;     // (bullet impacts: no point light, they come too fast)
    const lamp = new THREE.PointLight(0x9fd8ff, 30, 4, 1.5);
    lamp.position.set(...center);
    this.scene.add(lamp);
    this.live.push({ mesh: lamp, life: 0.12, maxLife: 0.12, kind: 'light' });
  }

  /**
   * A jagged electric arc (or a thin dart trail, with a small `jag`) from one point to another:
   * a few short glowing segments that flicker out (shock drones, shock wires, stims, interceptors).
   */
  arc(from, to, color = 0x9fd8ff, jag = 0.35) {
    const a = new THREE.Vector3(...from), b = new THREE.Vector3(...to);
    const len = a.distanceTo(b);
    if (len < 0.05) return;
    const n = Math.max(2, Math.min(10, Math.round(len / 0.5)));
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, depthWrite: false });
    let prev = a.clone();
    for (let i = 1; i <= n; i++) {
      const p = a.clone().lerp(b, i / n);
      if (i < n) p.add(new THREE.Vector3((Math.random() - 0.5) * jag, (Math.random() - 0.5) * jag, (Math.random() - 0.5) * jag));
      const seg = new THREE.Mesh(unitBox, mat.clone());
      seg.scale.set(0.02, 0.02, prev.distanceTo(p));
      seg.position.copy(prev).add(p).multiplyScalar(0.5);
      seg.lookAt(p);
      this.add(seg, 0.12 + Math.random() * 0.06, 'tracer');
      prev = p;
    }
    mat.dispose();
    const light = new THREE.PointLight(color, 30, 4, 1.5);
    light.position.copy(b);
    this.scene.add(light);
    this.live.push({ mesh: light, life: 0.1, maxLife: 0.1, kind: 'light' });
  }

  explosion(pos, scale = 1) {
    const fire = new THREE.Mesh(puffGeo, new THREE.MeshBasicMaterial({ color: 0xffb347, transparent: true, opacity: 0.9, depthWrite: false }));
    fire.position.set(...pos);
    fire.scale.setScalar(0.6 * scale);
    fire.userData.size = 0.9 * scale;
    this.add(fire, 0.35, 'puff');
    const smoke = new THREE.Mesh(puffGeo, new THREE.MeshBasicMaterial({ color: 0x8a8a8a, transparent: true, opacity: 0.8, depthWrite: false }));
    smoke.position.set(...pos);
    smoke.userData.size = 1.2 * scale;
    this.add(smoke, 1.1, 'puff');
    const light = new THREE.PointLight(0xffa040, 30, 12, 1.5);
    light.position.set(...pos);
    this.scene.add(light);
    this.live.push({ mesh: light, life: 0.25, maxLife: 0.25, kind: 'light' });
  }

  /** White burst for a stun grenade. */
  flash(pos) {
    const burst = new THREE.Mesh(puffGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, depthWrite: false }));
    burst.position.set(...pos);
    burst.userData.size = 1.6;
    burst.scale.setScalar(0.8);
    this.add(burst, 0.35, 'puff');
    const light = new THREE.PointLight(0xffffff, 60, 16, 1.4);
    light.position.set(...pos);
    this.scene.add(light);
    this.live.push({ mesh: light, life: 0.3, maxLife: 0.3, kind: 'light' });
  }

  blood(point) {
    this.puff(point, 0xc0262b, 0.12);
  }

  add(mesh, life, kind) {
    this.scene.add(mesh);
    this.live.push({ mesh, life, maxLife: life, kind });
  }

  clearDecals() {
    for (const d of this.decals) this.scene.remove(d);
    this.decals.length = 0;
  }

  update(dt) {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const e = this.live[i];
      e.life -= dt;
      const k = Math.max(0, e.life / e.maxLife);
      if (e.kind === 'light') {
        e.mesh.intensity = 30 * k;
      } else if (e.kind === 'spark') {
        e.vel.y -= 9 * dt;
        e.mesh.position.addScaledVector(e.vel, dt);
        e.mesh.material.opacity = k;
      } else if (e.kind === 'casing') {
        e.vel.y -= 12 * dt;
        e.mesh.position.addScaledVector(e.vel, dt);
        e.mesh.rotation.x += dt * 18; e.mesh.rotation.y += dt * 9;
      } else if (e.kind === 'smoke') {
        e.mesh.position.addScaledVector(e.vel, dt);
        e.mesh.scale.setScalar(e.mesh.userData.size * (1 + (1 - k) * 3));
        e.mesh.material.opacity = e.mesh.userData.alpha * k;
      } else if (e.kind === 'debris') {
        e.vel.y -= 14 * dt;
        e.mesh.position.addScaledVector(e.vel, dt);
        e.mesh.rotation.x += dt * 6;
        e.mesh.material.opacity = Math.min(1, k * 3);
      } else {
        e.mesh.material.opacity = (e.kind === 'tracer' ? 0.9 : 0.8) * k;
        if (e.kind === 'puff') e.mesh.scale.setScalar(e.mesh.userData.size * (1 + (1 - k) * 1.5));
        else if (e.kind === 'ring') e.mesh.scale.setScalar(0.2 + e.mesh.userData.size * (1 - k));
      }
      if (e.life <= 0) {
        this.scene.remove(e.mesh);
        if (e.kind === 'debris' || e.kind === 'spark' || e.kind === 'casing') this.debrisCount--;
        if (e.mesh.material && !e.shared) e.mesh.material.dispose();
        this.live.splice(i, 1);
      }
    }
  }
}
