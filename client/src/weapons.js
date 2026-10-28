// First-person weapon view model: simple box guns drawn in their own pass so
// they never clip into walls, with bob, recoil kick, reload dip and muzzle flash.

import * as THREE from 'three';
import { WEAPONS } from '../../shared/weapons.js';

const REST = new THREE.Vector3(0.2, -0.2, -0.42);

function part(geo, color, x, y, z) {
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.35 }));
  m.position.set(x, y, z);
  return m;
}
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const barrel = (r, len) => new THREE.CylinderGeometry(r, r, len, 10).rotateX(Math.PI / 2);

/** Build a gun model pointing down -z. Shared with remote avatars (scaled down). */
export function makeGunModel(id) {
  const w = WEAPONS[id] || WEAPONS.rifle;
  const g = new THREE.Group();
  const muzzle = new THREE.Object3D();
  if (id === 'smg') {
    g.add(part(box(0.07, 0.1, 0.34), w.color, 0, 0, 0));
    g.add(part(barrel(0.016, 0.14), 0x1b1d20, 0, 0.015, -0.24));
    g.add(part(box(0.045, 0.2, 0.05), w.accent, 0, -0.14, -0.06));
    g.add(part(box(0.05, 0.05, 0.16), w.accent, 0, 0.0, 0.24));
    g.add(part(box(0.03, 0.03, 0.06), 0x111111, 0, 0.065, -0.05));
    muzzle.position.set(0, 0.015, -0.32);
  } else if (id === 'shotgun') {
    g.add(part(box(0.075, 0.085, 0.42), w.color, 0, 0, 0));
    g.add(part(barrel(0.024, 0.42), 0x1b1d20, 0, 0.02, -0.4));
    g.add(part(box(0.06, 0.05, 0.2), w.accent, 0, -0.045, -0.34));
    g.add(part(box(0.06, 0.1, 0.22), w.accent, 0, -0.03, 0.29));
    muzzle.position.set(0, 0.02, -0.62);
  } else {
    g.add(part(box(0.07, 0.095, 0.5), w.color, 0, 0, 0));
    g.add(part(barrel(0.014, 0.26), 0x1b1d20, 0, 0.015, -0.37));
    g.add(part(box(0.05, 0.16, 0.07), w.accent, 0, -0.12, -0.08));
    g.add(part(box(0.06, 0.08, 0.2), w.accent, 0, -0.01, 0.33));
    g.add(part(box(0.035, 0.045, 0.12), 0x111111, 0, 0.07, -0.02));
    muzzle.position.set(0, 0.015, -0.5);
  }
  g.add(muzzle);
  g.userData.muzzle = muzzle;
  return g;
}

function makeFlash() {
  const mat = new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.95, depthWrite: false });
  const flash = new THREE.Group();
  const a = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.16), mat);
  const b = a.clone(); b.rotation.y = Math.PI / 2;
  const c = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 0.12), mat); c.rotation.x = Math.PI / 2;
  flash.add(a, b, c);
  flash.visible = false;
  return flash;
}

export class ViewModel {
  constructor() {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, 1, 0.01, 10);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.6));
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(1, 2, 1);
    this.scene.add(key);

    this.holder = new THREE.Group();
    this.holder.position.copy(REST);
    this.scene.add(this.holder);
    this.flash = makeFlash();
    this.flashLight = new THREE.PointLight(0xffc060, 0, 2);
    this.scene.add(this.flashLight);

    this.weaponId = null;
    this.gun = null;
    this.kick = 0;
    this.flashTime = 0;
    this.bobPhase = 0;
    this.visible = true;
  }

  setWeapon(id) {
    if (id === this.weaponId) return;
    this.weaponId = id;
    if (this.gun) this.holder.remove(this.gun);
    this.gun = makeGunModel(id);
    this.holder.add(this.gun);
    this.gun.userData.muzzle.add(this.flash);
  }

  setAspect(aspect) {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  fire(weaponId) {
    this.kick = Math.min(1.5, this.kick + (weaponId === 'shotgun' ? 1.4 : 0.6));
    this.flashTime = 0.045;
    this.flash.rotation.z = Math.random() * Math.PI;
  }

  /** ctx: { speed, sprinting, crouch, reloadFrac (0..1 or -1), lean } */
  update(dt, ctx) {
    this.kick = Math.max(0, this.kick - dt * 9);
    this.flashTime -= dt;
    this.flash.visible = this.flashTime > 0;
    this.flashLight.intensity = this.flashTime > 0 ? 3 : 0;

    const speed = Math.min(1.6, ctx.speed / 4);
    this.bobPhase += dt * (6 + speed * 6) * (speed > 0.05 ? 1 : 0.3);
    const bobX = Math.sin(this.bobPhase) * 0.012 * speed;
    const bobY = Math.abs(Math.cos(this.bobPhase)) * 0.014 * speed;

    let dip = 0, tilt = 0;
    if (ctx.reloadFrac >= 0) {
      const s = Math.sin(Math.min(1, ctx.reloadFrac) * Math.PI);
      dip = s * 0.16; tilt = s * 0.7;
    }
    const sprint = ctx.sprinting ? 1 : 0;

    this.holder.position.set(
      REST.x + bobX - sprint * 0.06,
      REST.y - bobY - dip - sprint * 0.04,
      REST.z + this.kick * 0.06,
    );
    this.holder.rotation.set(this.kick * 0.09 - tilt * 0.3, sprint * 0.6, tilt + ctx.lean * 0.2 + sprint * 0.25);

    if (this.gun) {
      this.gun.userData.muzzle.getWorldPosition(this.flashLight.position);
    }
  }

  render(renderer) {
    if (!this.visible || !this.gun) return;
    renderer.autoClear = false;
    renderer.clearDepth();
    renderer.render(this.scene, this.camera);
    renderer.autoClear = true;
  }
}
