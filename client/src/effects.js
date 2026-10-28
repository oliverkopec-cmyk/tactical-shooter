// Short-lived visual effects in the world: tracers, bullet holes, impact puffs.

import * as THREE from 'three';

const MAX_DECALS = 150;
const TRACER_LIFE = 0.07;
const PUFF_LIFE = 0.25;

const unitBox = new THREE.BoxGeometry(1, 1, 1);
const tracerMat = new THREE.MeshBasicMaterial({ color: 0xffe9a0, transparent: true, opacity: 0.9, depthWrite: false });
const decalMat = new THREE.MeshBasicMaterial({ color: 0x1a1a1a, polygonOffset: true, polygonOffsetFactor: -2 });
const puffGeo = new THREE.SphereGeometry(1, 8, 6);

export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.live = [];     // { mesh, life, maxLife, kind }
    this.decals = [];
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

  bulletHole(point, normal) {
    const mesh = new THREE.Mesh(unitBox, decalMat);
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
      e.mesh.material.opacity = (e.kind === 'tracer' ? 0.9 : 0.8) * k;
      if (e.kind === 'puff') e.mesh.scale.setScalar(e.mesh.userData.size * (1 + (1 - k) * 1.5));
      if (e.life <= 0) {
        this.scene.remove(e.mesh);
        e.mesh.material.dispose();
        this.live.splice(i, 1);
      }
    }
  }
}
