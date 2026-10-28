// Short-lived visual effects in the world: tracers, bullet holes, impact puffs.

import * as THREE from 'three';

const MAX_DECALS = 150;
const TRACER_LIFE = 0.07;
const PUFF_LIFE = 0.25;

const unitBox = new THREE.BoxGeometry(1, 1, 1);
const tracerMat = new THREE.MeshBasicMaterial({ color: 0xffe9a0, transparent: true, opacity: 0.9, depthWrite: false });
const decalMat = new THREE.MeshBasicMaterial({ color: 0x1a1a1a, polygonOffset: true, polygonOffsetFactor: -2 });
const puffGeo = new THREE.SphereGeometry(1, 8, 6);
const DEBRIS_LIFE = 1.3;
const MAX_DEBRIS = 300;

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

  bulletHole(point, normal, panelId = null) {
    const mesh = new THREE.Mesh(unitBox, decalMat);
    mesh.userData.panelId = panelId;
    mesh.scale.set(normal[0] ? 0.01 : 0.07, normal[1] ? 0.01 : 0.07, normal[2] ? 0.01 : 0.07);
    mesh.position.set(point[0] + normal[0] * 0.006, point[1] + normal[1] * 0.006, point[2] + normal[2] * 0.006);
    this.scene.add(mesh);
    this.decals.push(mesh);
    if (this.decals.length > MAX_DECALS) this.scene.remove(this.decals.shift());
    this.puff(point, 0xcfc6b0, 0.06);
  }

  puff(point, color, size) {
    const mesh = new THREE.Mesh(puffGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, depthWrite: false }));
    mesh.position.set(...point);
    mesh.scale.setScalar(size);
    mesh.userData.size = size;
    this.add(mesh, PUFF_LIFE, 'puff');
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
  debris(center, color, count = 4, push = null) {
    for (let i = 0; i < count && this.debrisCount < MAX_DEBRIS; i++) {
      const s = 0.06 + Math.random() * 0.12;
      const mesh = new THREE.Mesh(unitBox, new THREE.MeshStandardMaterial({ color, roughness: 0.9, transparent: true }));
      mesh.scale.set(s, s * (0.5 + Math.random()), s);
      mesh.position.set(center[0] + (Math.random() - 0.5) * 0.4, center[1] + (Math.random() - 0.5) * 0.4, center[2] + (Math.random() - 0.5) * 0.4);
      mesh.rotation.set(Math.random() * 3, Math.random() * 3, 0);
      const k = push ? 5 : 2;
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

  explosion(pos) {
    const fire = new THREE.Mesh(puffGeo, new THREE.MeshBasicMaterial({ color: 0xffb347, transparent: true, opacity: 0.9, depthWrite: false }));
    fire.position.set(...pos);
    fire.scale.setScalar(0.6);
    fire.userData.size = 0.9;
    this.add(fire, 0.35, 'puff');
    const smoke = new THREE.Mesh(puffGeo, new THREE.MeshBasicMaterial({ color: 0x8a8a8a, transparent: true, opacity: 0.8, depthWrite: false }));
    smoke.position.set(...pos);
    smoke.userData.size = 1.2;
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
      } else if (e.kind === 'debris') {
        e.vel.y -= 14 * dt;
        e.mesh.position.addScaledVector(e.vel, dt);
        e.mesh.rotation.x += dt * 6;
        e.mesh.material.opacity = Math.min(1, k * 3);
      } else {
        e.mesh.material.opacity = (e.kind === 'tracer' ? 0.9 : 0.8) * k;
        if (e.kind === 'puff') e.mesh.scale.setScalar(e.mesh.userData.size * (1 + (1 - k) * 1.5));
      }
      if (e.life <= 0) {
        this.scene.remove(e.mesh);
        if (e.kind === 'debris') this.debrisCount--;
        if (e.mesh.material) e.mesh.material.dispose();
        this.live.splice(i, 1);
      }
    }
  }
}
