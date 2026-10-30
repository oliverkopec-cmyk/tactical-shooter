// The defuser in the world: a case on the floor with a tall yellow beacon (only attackers are told where it
// lies), and the planted device with a blinking light. Everything comes from the server's `df` snapshot field.

import * as THREE from 'three';

const darkMat = new THREE.MeshStandardMaterial({ color: 0x202428, roughness: 0.5, metalness: 0.5 });
const stripMat = new THREE.MeshStandardMaterial({ color: 0xd9a12a, roughness: 0.6 });

function makeDevice() {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.16, 0.3), darkMat));
  const strip = new THREE.Mesh(new THREE.BoxGeometry(0.47, 0.03, 0.06), stripMat);
  strip.position.set(0, 0.04, 0.1);
  g.add(strip);
  const screen = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.005, 0.08), new THREE.MeshBasicMaterial({ color: 0x33ff88 }));
  screen.position.set(-0.1, 0.083, -0.04);
  g.add(screen);
  const led = new THREE.Mesh(new THREE.SphereGeometry(0.03, 10, 8), new THREE.MeshBasicMaterial({ color: 0xff2a2a }));
  led.position.set(0.14, 0.1, -0.05);
  g.add(led);
  g.userData.led = led;
  return g;
}

export class DefuserView {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.device = makeDevice();
    this.device.visible = false;
    this.case = makeDevice();                       // the carried case looks like the device, in grey
    this.case.scale.setScalar(0.9);
    this.case.userData.led.material.color.setHex(0xffd23c);
    this.beacon = new THREE.Mesh(
      new THREE.CylinderGeometry(0.07, 0.07, 6, 10, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xffd23c, transparent: true, opacity: 0.5, depthTest: false, depthWrite: false }),
    );
    this.beacon.renderOrder = 18;
    this.case.visible = false;
    this.beacon.visible = false;
    this.group.add(this.device, this.case, this.beacon);
    this.t = 0;
    this.left = null;           // ms until it goes off, once planted
    this.planted = false;
  }

  /** df: { c, d, p } from the snapshot (or null outside the Defuser mode). */
  set(df) {
    this.planted = !!df?.p;
    this.left = df?.p ? df.p.left : null;
    if (df?.p) { this.device.position.set(df.p.pos[0], df.p.pos[1] + 0.09, df.p.pos[2]); }
    this.device.visible = this.planted;
    const d = df?.d;
    this.case.visible = !!d;
    this.beacon.visible = !!d;
    if (d) {
      this.case.position.set(d[0], d[1] + 0.09, d[2]);
      this.beacon.position.set(d[0], d[1] + 3, d[2]);
    }
  }

  clear() { this.set(null); }

  update(dt) {
    this.t += dt;
    if (this.left !== null) this.left = Math.max(0, this.left - dt * 1000);
    // The light blinks faster as the time runs out
    const rate = this.planted ? 1.5 + 8 * (1 - Math.min(1, (this.left ?? 0) / 45000)) : 0;
    this.device.userData.led.visible = this.planted && Math.sin(this.t * rate * Math.PI * 2) > -0.2;
    this.case.rotation.y += dt * 1.2;
  }

  dispose() {
    this.scene.remove(this.group);
  }
}
