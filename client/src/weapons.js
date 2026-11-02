// First-person weapon view model: simple box guns drawn in their own pass so
// they never clip into walls, with bob, recoil kick, reload dip and muzzle flash.

import * as THREE from 'three';
import { WEAPONS } from '../../shared/weapons.js';
import { makeGunModel, animateGun } from './gunModels.js';
import { attachCharm } from './charmModels.js';

const REST = new THREE.Vector3(0.2, -0.2, -0.42);
const ADS_Z = -0.4;     // aiming: the gun comes to the middle with its sights on the line of sight, this far ahead
const VM_FOV = 62;

export { makeGunModel, animateGun };

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
    this.camera = new THREE.PerspectiveCamera(VM_FOV, 1, 0.01, 10);
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
    this.weaponKey = null;
    this.gun = null;
    this.kick = 0;
    this.raise = 0;
    this.swingT = 0;
    this.flashTime = 0;
    this.bobPhase = 0;
    this.visible = true;
  }

  setWeapon(id, skinId = null, charmId = null) {
    const key = `${id}|${skinId || ''}|${charmId || ''}`;
    if (key === this.weaponKey) return;
    const previous = this.weaponKey && this.weaponId !== id ? this.weaponId : null;   // only a different gun gets the draw animation
    this.weaponKey = key;
    this.weaponId = id;
    if (this.gun) this.holder.remove(this.gun);
    if (previous) this.raise = 1;   // drawing a gun: lift it into view
    this.gun = makeGunModel(id, skinId);
    attachCharm(this.gun, charmId);
    this.gun.position.set(...this.gun.userData.hold);
    this.holder.add(this.gun);
    this.gun.userData.muzzle.add(this.flash);
  }

  setAspect(aspect) {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  fire(weaponId) {
    const recoil = WEAPONS[weaponId]?.recoilPitch ?? 0.012;
    this.kick = Math.min(1.5, this.kick + Math.max(0.35, recoil * 40));
    this.flashTime = 0.045;
    this.flash.rotation.z = Math.random() * Math.PI;
    this.gun?.userData.charm?.push((Math.random() - 0.5) * 0.8, 2.2);   // recoil flicks the charm
  }

  /** Melee strike: the gun is thrust forward and across. */
  melee() {
    this.swingT = 0.0001;
  }

  /** ctx: { speed, sprinting, crouch, reloadFrac (0..1 or -1), lean, ads (0..1), hidden } */
  update(dt, ctx) {
    const ads = ctx.ads || 0, hip = 1 - ads * ads * (3 - 2 * ads);   // eased: 1 at the hip, 0 fully aimed
    this.hidden = !!ctx.hidden;                                       // looking through a scope: no gun in view
    this.kick = Math.max(0, this.kick - dt * 9);
    this.raise = Math.max(0, this.raise - dt * 4.5);
    this.flashTime -= dt;
    this.flash.visible = this.flashTime > 0;
    this.flashLight.intensity = this.flashTime > 0 ? 3 : 0;

    const speed = Math.min(1.6, ctx.speed / 4) * (0.25 + 0.75 * hip);   // the sights bob much less
    this.bobPhase += dt * (6 + speed * 6) * (speed > 0.05 ? 1 : 0.3);
    const bobX = Math.sin(this.bobPhase) * 0.012 * speed;
    const bobY = Math.abs(Math.cos(this.bobPhase)) * 0.014 * speed;

    let dip = this.raise * this.raise * 0.3, tilt = this.raise * 0.5;
    if (ctx.reloadFrac >= 0) {
      const s = Math.sin(Math.min(1, ctx.reloadFrac) * Math.PI);
      dip += s * 0.16; tilt += s * 0.7;
    }
    const sprint = ctx.sprinting ? 1 : 0;

    const aimY = -((this.gun?.userData.sightY ?? 0.04) + (this.gun?.userData.hold[1] ?? 0));
    this.holder.position.set(
      REST.x * hip + bobX - sprint * 0.06,
      REST.y * hip + aimY * (1 - hip) - bobY - dip - sprint * 0.04,
      REST.z * hip + ADS_Z * (1 - hip) + this.kick * (0.03 + 0.03 * hip),
    );
    let swing = 0;
    if (this.swingT > 0) {
      this.swingT += dt / 0.3;
      if (this.swingT >= 1) this.swingT = 0; else swing = Math.sin(this.swingT * Math.PI);
    }
    this.holder.position.z -= 0.28 * swing;
    this.holder.position.x -= 0.18 * swing;
    this.holder.rotation.set(this.kick * (0.04 + 0.05 * hip) - tilt * 0.3 - swing * 0.25, sprint * 0.6 + swing * 0.7, tilt + ctx.lean * 0.2 * hip + sprint * 0.25 + swing * 0.5);
    const fov = VM_FOV - 14 * (1 - hip);
    if (Math.abs(this.camera.fov - fov) > 0.01) { this.camera.fov = fov; this.camera.updateProjectionMatrix(); }

    if (this.gun) {
      // Looking through a red dot: the lens clears and the back plate of the housing goes, so you see through it
      const dot = this.gun.userData.parts['lens.dot']?.[0];
      if (dot) {
        const through = ads > 0.5;
        dot.material.opacity = through ? 0.05 : 0.75;
        const plate = this.gun.userData.parts['optic.hood']?.[0];
        if (plate) plate.visible = !through;
      }
      animateGun(this.gun, { kick: this.kick, reloadFrac: ctx.reloadFrac });
      this.gun.userData.charm?.update(dt, this.holder.position);
      this.gun.userData.muzzle.getWorldPosition(this.flashLight.position);
    }
  }

  render(renderer) {
    if (!this.visible || !this.gun || this.hidden) return;
    renderer.autoClear = false;
    renderer.clearDepth();
    renderer.render(this.scene, this.camera);
    renderer.autoClear = true;
  }
}
