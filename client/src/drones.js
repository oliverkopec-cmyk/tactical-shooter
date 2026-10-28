// Drone models for everyone in the match. Positions come from server snapshots
// and are smoothed; your own active drone isn't drawn (you're looking through it).

import * as THREE from 'three';

const bodyMat = new THREE.MeshStandardMaterial({ color: 0x2d333b, roughness: 0.5, metalness: 0.5 });
const stripeMat = new THREE.MeshStandardMaterial({ color: 0xe8833a, roughness: 0.6 });
const wheelMat = new THREE.MeshStandardMaterial({ color: 0x15181c, roughness: 0.9 });
const ledMat = new THREE.MeshBasicMaterial({ color: 0xff3030 });
const lensMat = new THREE.MeshStandardMaterial({ color: 0x0a0a10, roughness: 0.1, metalness: 0.8 });

function makeDroneMesh() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.14, 0.46), bodyMat);
  body.position.y = 0.17;
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.03, 0.12), stripeMat);
  stripe.position.set(0, 0.25, 0.04);
  const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.06, 12).rotateX(Math.PI / 2), lensMat);
  lens.position.set(0, 0.19, -0.24);
  const led = new THREE.Mesh(new THREE.SphereGeometry(0.02, 8, 6), ledMat);
  led.position.set(0.1, 0.26, -0.15);
  const wheels = [];
  for (const sx of [-1, 1]) {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.08, 14).rotateZ(Math.PI / 2), wheelMat);
    w.position.set(sx * 0.21, 0.11, 0);
    wheels.push(w);
    g.add(w);
  }
  g.add(body, stripe, lens, led);
  for (const m of g.children) m.castShadow = true;
  g.userData.wheels = wheels;
  g.userData.led = led;
  return g;
}

export class DroneView {
  constructor(scene, effects, audio) {
    this.scene = scene;
    this.effects = effects;
    this.audio = audio;
    this.drones = new Map(); // id -> { mesh, target, prev, spin }
    this.blink = 0;
  }

  sync(list, myId) {
    const seen = new Set();
    for (const d of list) {
      seen.add(d.id);
      let e = this.drones.get(d.id);
      if (!e) {
        const mesh = makeDroneMesh();
        mesh.position.set(d.x, d.y, d.z);
        mesh.rotation.y = d.yaw;
        this.scene.add(mesh);
        e = { mesh, target: d, spin: 0 };
        this.drones.set(d.id, e);
      }
      e.target = d;
      e.hidden = d.o === myId && !!d.a;
    }
    for (const [id, e] of this.drones) {
      if (!seen.has(id)) { this.scene.remove(e.mesh); this.drones.delete(id); }
    }
  }

  update(dt) {
    this.blink += dt;
    const k = 1 - Math.exp(-16 * dt);
    for (const e of this.drones.values()) {
      const t = e.target, m = e.mesh;
      const dx = t.x - m.position.x, dz = t.z - m.position.z;
      m.position.x += dx * k;
      m.position.y += (t.y - m.position.y) * k;
      m.position.z += dz * k;
      // Face the way it's rolling, or the camera direction when stopped
      const speed = Math.hypot(t.vx, t.vz);
      let yaw = t.yaw;
      if (speed > 0.3) yaw = Math.atan2(-t.vx, -t.vz);
      let dy = (yaw - m.rotation.y) % (Math.PI * 2);
      if (dy > Math.PI) dy -= Math.PI * 2;
      if (dy < -Math.PI) dy += Math.PI * 2;
      m.rotation.y += dy * k;
      e.spin += speed * dt * 9;
      for (const w of m.userData.wheels) w.rotation.x = e.spin;
      m.userData.led.visible = this.blink % 0.8 < 0.4;
      m.visible = !e.hidden;
    }
  }

  destroyed({ id, pos }) {
    const e = this.drones.get(id);
    if (e) { this.scene.remove(e.mesh); this.drones.delete(id); }
    this.effects.debris(pos, 0x2d333b, 8);
    this.effects.puff(pos, 0xffa040, 0.25);
    this.audio.clank(pos);
  }

  clear() {
    for (const e of this.drones.values()) this.scene.remove(e.mesh);
    this.drones.clear();
  }
}
