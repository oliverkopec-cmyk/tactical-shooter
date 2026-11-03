// First-person weapon view model: simple box guns drawn in their own pass so
// they never clip into walls, with bob, recoil kick, reload dip and muzzle flash.

import * as THREE from 'three';
import { WEAPONS } from '../../shared/weapons.js';
import { FEEL } from '../../shared/constants.js';
import { makeGunModel, animateGun } from './gunModels.js';
import { attachCharm } from './charmModels.js';
import { Hands } from './hands.js';
import { gunTuning } from '../../shared/gunConfig.js';

const DEG = Math.PI / 180;
const seg01 = (x) => { const t = Math.max(0, Math.min(1, x)); return t * t * (3 - 2 * t); };

export const REST = new THREE.Vector3(0.15, -0.09, -0.5);   // raised and a little further away than before so the hands show (Stage 2H)
const ADS_Z = -0.4;     // aiming: the gun comes to the middle with its sights on the line of sight, this far ahead
export const VIEW = { fov: 60 };   // the view model camera's field of view (exported so it can be tuned live)
// Aegis's shield in first person, as [x, y, z, yaw]: drawn, it fills most of the view with its viewport
// (SHIELD_PORT_Y up the shield) right on the line of sight; with the pistol out it is held to the left
// (further out while aiming); sprinting swings it aside
const SHIELD_PORT_Y = 0.37;
const SHIELD_POSE = {
  front: [0, -SHIELD_PORT_Y, -0.5, 0],
  side: [-0.44, -0.5, -0.7, 0.45],
  sideAim: [-0.64, -0.64, -0.66, 0.62],
  aside: [-0.86, -0.68, -0.6, 1.05],
};
const SIDEARM_IN = 0.12;   // with the shield at its side, the pistol is held this much closer to it

export { makeGunModel, animateGun };

// ---- muzzle flash and casings (Stage 2G), drawn in code

/** A soft star burst for the front of the flash, and a flame streak for its sides (white, tinted per gun). */
function flashTexture(kind) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.translate(64, 64);
  g.globalCompositeOperation = 'lighter';
  if (kind === 'star') {
    for (let i = 0; i < 9; i++) {
      g.save();
      g.rotate((i / 9) * Math.PI * 2 + (i % 2) * 0.2);
      const len = i % 2 ? 40 : 62, grad = g.createLinearGradient(0, 0, len, 0);
      grad.addColorStop(0, 'rgba(255,255,255,0.95)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grad;
      g.beginPath(); g.moveTo(0, -7); g.lineTo(len, 0); g.lineTo(0, 7); g.fill();
      g.restore();
    }
    const core = g.createRadialGradient(0, 0, 0, 0, 0, 30);
    core.addColorStop(0, 'rgba(255,255,255,1)'); core.addColorStop(0.4, 'rgba(255,255,255,0.7)'); core.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = core; g.fillRect(-64, -64, 128, 128);
  } else {
    for (let k = 0; k < 3; k++) {
      const grad = g.createLinearGradient(0, 60, 0, -64);
      grad.addColorStop(0, 'rgba(255,255,255,0.9)'); grad.addColorStop(0.5, 'rgba(255,255,255,0.45)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grad;
      const w = 22 - k * 6;
      g.beginPath(); g.moveTo(-w, 60); g.quadraticCurveTo(-w * 0.4, -10, (k - 1) * 6, -64); g.quadraticCurveTo(w * 0.4, -10, w, 60); g.fill();
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeFlash() {
  const mat = (map) => new THREE.MeshBasicMaterial({ map, color: 0xffc46b, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  const starMat = mat(flashTexture('star')), sideMat = mat(flashTexture('streak'));
  const flash = new THREE.Group();
  // Faces you, down the barrel, a little in front of the muzzle; drawn over the gun so the glow isn't hidden behind it
  starMat.depthTest = false;
  const front = new THREE.Mesh(new THREE.PlaneGeometry(0.28, 0.28), starMat);
  front.position.z = -0.05;
  front.renderOrder = 10;
  const sideGeo = new THREE.PlaneGeometry(0.13, 0.34).rotateX(-Math.PI / 2).translate(0, 0, -0.16);
  const s1 = new THREE.Mesh(sideGeo, sideMat), s2 = new THREE.Mesh(sideGeo, sideMat);
  s2.rotation.z = Math.PI / 2;
  flash.add(front, s1, s2);
  flash.userData.mats = [starMat, sideMat];
  flash.visible = false;
  return flash;
}

const casingGeo = new THREE.CylinderGeometry(1, 1, 1, 10).rotateX(Math.PI / 2);
const brass = new THREE.MeshStandardMaterial({ color: 0xd9a441, roughness: 0.3, metalness: 0.85 });
const shellRed = new THREE.MeshStandardMaterial({ color: 0xa8241c, roughness: 0.5, metalness: 0.1 });

function makeCasing(kind) {
  const g = new THREE.Group();
  if (kind === 'shell') {
    const hull = new THREE.Mesh(casingGeo, shellRed); hull.scale.set(0.0095, 0.0095, 0.05);
    const head = new THREE.Mesh(casingGeo, brass); head.scale.set(0.0102, 0.0102, 0.012); head.position.z = 0.022;
    g.add(hull, head);
  } else {
    const rifle = kind === 'rifle';
    const body = new THREE.Mesh(casingGeo, brass); body.scale.set(rifle ? 0.0055 : 0.005, rifle ? 0.0055 : 0.005, rifle ? 0.036 : 0.02);
    g.add(body);
  }
  return g;
}

/** Nothing in the hands (a shield is drawn): a group with what the code expects of a gun model. */
function emptyHands() {
  const g = new THREE.Group();
  const muzzle = new THREE.Object3D();
  g.add(muzzle);
  g.userData = { muzzle, hold: [0, 0, 0], sightY: 0.04, parts: {}, anim: {} };
  return g;
}

/** What your hands hold while placing something (Stage 27): a small dark case with a green light. */
function makePlaceItem() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.08, 0.11), new THREE.MeshStandardMaterial({ color: 0x2a2f36, roughness: 0.5, metalness: 0.5 }));
  const lid = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.012, 0.12), new THREE.MeshStandardMaterial({ color: 0x4a5058, roughness: 0.4, metalness: 0.7 }));
  lid.position.y = 0.046;
  const led = new THREE.Mesh(new THREE.SphereGeometry(0.008, 8, 6), new THREE.MeshBasicMaterial({ color: 0x4dff88 }));
  led.position.set(0.05, 0.03, -0.056);
  g.add(body, lid, led);
  g.scale.setScalar(0.7);
  g.visible = false;
  return g;
}

export class ViewModel {
  constructor() {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(VIEW.fov, 1, 0.01, 10);
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

    this.hands = new Hands(this.scene);   // arms and gloved hands (Stage 2H)
    this.placeItem = makePlaceItem();
    this.scene.add(this.placeItem);
    this.throwT = -1;    // 0..1 while a grenade is being thrown (the hands take it, wind up and throw), else -1
    this.throwColor = 0x4a5a3a;
    this.placeAmt = 0;   // 0 = gun up ... 1 = gun lowered and the item in the hands (placing)

    this.weaponId = null;
    this.weaponKey = null;
    this.gun = null;
    this.kick = 0;                        // 0..1: drives the bolt / slide / pump moving on a shot
    // The gun's recoil spring: back (m), up, side and roll (rad), each with a velocity. Settings per gun in shared/gunConfig.js
    this.spring = { back: 0, up: 0, side: 0, roll: 0, vBack: 0, vUp: 0, vSide: 0, vRoll: 0, k: 160, c: 15 };
    this.casings = [];                    // shell casings flying out of the gun
    this.casingsOn = true;                // off on Low graphics
    this.ads = 0;
    this.raise = 0;
    this.swingT = 0;
    this.flashTime = 0;
    this.bobPhase = 0;
    this.sway = { x: 0, y: 0 };   // how far the gun trails behind the mouse (rad)
    this.visible = true;
  }

  /**
   * sideShield: { id, skin, charm } when the other weapon is a ballistic shield (Aegis with the pistol
   * out): it stays in view, held to the side. A drawn shield is all there is in the hands.
   */
  setWeapon(id, skinId = null, charmId = null, sideShield = null) {
    const shield = !!WEAPONS[id]?.shield;
    const sh = shield ? { id, skin: skinId, charm: charmId } : sideShield;
    const shieldKey = sh ? `${sh.id}|${sh.skin || ''}|${sh.charm || ''}` : '';
    const key = `${id}|${skinId || ''}|${charmId || ''}|${shieldKey}`;
    if (key === this.weaponKey) return;
    const previous = this.weaponKey && this.weaponId !== id ? this.weaponId : null;   // only a different gun gets the draw animation
    this.weaponKey = key;
    this.weaponId = id;
    if (this.gun) this.holder.remove(this.gun);
    if (previous) this.raise = 1;   // drawing a gun: lift it into view
    // The shield keeps its own holder (and where it is) when you switch between it and the pistol
    if (shieldKey !== this.shieldKey) {
      if (this.shield) { this.scene.remove(this.shieldHolder); this.shield = null; }
      this.shieldKey = shieldKey;
      if (sh) {
        this.shield = makeGunModel(sh.id, sh.skin);
        attachCharm(this.shield, sh.charm);
        this.shieldHolder ||= new THREE.Group();
        this.shieldHolder.clear();
        this.shieldHolder.add(this.shield);
        this.shieldPose = (shield ? SHIELD_POSE.front : SHIELD_POSE.side).slice();
        this.scene.add(this.shieldHolder);
      }
    }
    this.gun = shield ? emptyHands() : makeGunModel(id, skinId);
    if (!shield) attachCharm(this.gun, charmId);
    this.gun.position.set(...this.gun.userData.hold);
    this.holder.add(this.gun);
    this.gun.userData.muzzle.add(this.flash);
    this.hands.setGun(shield ? null : this.gun, WEAPONS[id]?.model);
  }

  /** Sleeves in the team's colour and cuffs in the operator's. */
  setOutfit(teamColor, opColor) { this.hands.setOutfit(teamColor, opColor); }

  setAspect(aspect) {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  /**
   * A shot: the gun is thrown back and tipped up by its own kick and springs back (stiffness and damping per gun,
   * so a pistol snaps up and back while a shotgun shoves hard and settles), the flash bursts and a casing flies out.
   */
  fire(weaponId) {
    const rc = gunTuning(weaponId).recoil, sp = this.spring;
    const aimed = 1 - this.ads * 0.55, w = Math.sqrt(rc.gunSpring) * 1.5, rnd = () => Math.random() * 2 - 1;
    sp.k = rc.gunSpring; sp.c = rc.gunDamping;
    sp.vBack += rc.gunBack * w * aimed;
    sp.vUp += rc.gunUp * DEG * w * aimed * (0.85 + Math.random() * 0.3);
    sp.vSide += rc.gunSide * DEG * w * rnd() * aimed;
    sp.vRoll += rc.gunRoll * DEG * w * rnd();
    this.kick = 1;
    this.flashTime = 0.04 + Math.random() * 0.015;
    this.flash.rotation.z = Math.random() * Math.PI * 2;
    this.flash.scale.set(rc.flash * (0.8 + Math.random() * 0.4), rc.flash * (0.8 + Math.random() * 0.4), rc.flash * (0.7 + Math.random() * 0.6));
    for (const m of this.flash.userData.mats) m.color.setHex(rc.flashColor);
    this.flashLight.color.setHex(rc.flashColor);
    this.gun?.userData.charm?.push(rnd() * 0.8, 1.5 + rc.gunBack * 30);   // recoil flicks the charm
    this.eject(rc.casing);
  }

  /** Throw a casing out of the right side of the gun; it flies up and right, tumbling, and drops out of view. */
  eject(kind) {
    if (!this.gun || !this.casingsOn || kind === 'none' || this.casings.length > 16) return;
    const m = this.gun.userData.muzzle.position;
    const at = new THREE.Vector3(0.02, (this.gun.userData.sightY || 0.04) * 0.35, Math.min(-0.04, m.z * 0.3));
    this.gun.localToWorld(at);                      // view model scene space (it doesn't move when you turn)
    const mesh = makeCasing(kind);
    mesh.position.copy(at);
    mesh.rotation.set(Math.random(), Math.random() * 3, 0);
    this.scene.add(mesh);
    const shell = kind === 'shell';
    this.casings.push({
      mesh, life: 0.75,
      vel: new THREE.Vector3(0.7 + Math.random() * 0.5, 0.7 + Math.random() * 0.45, 0.15 + Math.random() * 0.3).multiplyScalar(shell ? 0.8 : 1),
      spin: new THREE.Vector3(8 + Math.random() * 14, Math.random() * 10, 6 + Math.random() * 10),
    });
  }

  /** Throwing a utility (frag, impact, flash or smoke): the gun drops to the left hand, the right takes a grenade, winds up and throws. */
  throwUtility(kind) {
    if (this.throwT >= 0) return;
    this.throwT = 0;
    this.throwColor = { frag: 0x4a5a3a, impact: 0x6a6f78, flash: 0xd8d8e8, smoke: 0x8a8f96 }[kind] ?? 0x4a5a3a;
  }

  /** Melee strike: the gun is thrust forward and across. */
  melee() {
    this.swingT = 0.0001;
  }

  /**
   * ctx: { speed, sprinting, crouch, reloadFrac (0..1 or -1), lean, ads (0..1), hidden, cover (shieldCover() with a shield up),
   *        stepPhase / stepAmp (the camera's footstep bob, so the gun moves in step), turnX / turnY (mouse turn rate, rad/s) }
   */
  update(dt, ctx) {
    const ads = ctx.ads || 0, hip = 1 - ads * ads * (3 - 2 * ads);   // eased: 1 at the hip, 0 fully aimed
    this.hidden = !!ctx.hidden;                                       // looking through a scope: no gun in view
    this.ads = ctx.ads || 0;
    this.kick = Math.max(0, this.kick - dt * 14);
    // The recoil spring (a few small steps so stiff guns stay stable)
    const sp = this.spring;
    for (let n = 0, h = Math.min(dt, 0.05) / 4; n < 4; n++) {
      sp.vBack += (-sp.k * sp.back - sp.c * sp.vBack) * h; sp.back += sp.vBack * h;
      sp.vUp += (-sp.k * sp.up - sp.c * sp.vUp) * h; sp.up += sp.vUp * h;
      sp.vSide += (-sp.k * sp.side - sp.c * sp.vSide) * h; sp.side += sp.vSide * h;
      sp.vRoll += (-sp.k * sp.roll - sp.c * sp.vRoll) * h; sp.roll += sp.vRoll * h;
    }
    for (let i = this.casings.length - 1; i >= 0; i--) {
      const c = this.casings[i];
      c.life -= dt;
      c.vel.y -= 5 * dt;
      c.mesh.position.addScaledVector(c.vel, dt);
      c.mesh.rotation.x += c.spin.x * dt; c.mesh.rotation.y += c.spin.y * dt; c.mesh.rotation.z += c.spin.z * dt;
      if (c.life <= 0) { this.scene.remove(c.mesh); this.casings.splice(i, 1); }
    }
    this.raise = Math.max(0, this.raise - dt * 4.5);
    this.flashTime -= dt;
    this.flash.visible = this.flashTime > 0;
    this.flashLight.intensity = this.flashTime > 0 ? 6 : 0;

    // Footsteps: the gun moves in step with the camera bob (and breathes gently when standing still)
    const still = 0.25 + 0.75 * hip;                                     // the sights move much less
    const step = (ctx.stepAmp ?? 0) / FEEL.bobWalk * FEEL.swayStep * still;
    this.bobPhase += dt * 1.6;
    const phase = ctx.stepPhase ?? 0;
    const bobX = Math.sin(phase) * 0.012 * step + Math.sin(this.bobPhase) * 0.002 * still;
    const bobY = Math.abs(Math.sin(phase)) * 0.014 * step + Math.sin(this.bobPhase * 2) * 0.0015 * still;
    // Sway: the gun trails a little behind the mouse and catches up (less while aiming)
    const lag = FEEL.swayLag * (1 - (1 - FEEL.swayAim) * ads), cap = FEEL.swayMax;
    const tx = Math.max(-cap, Math.min(cap, -(ctx.turnX || 0) * lag)), ty = Math.max(-cap, Math.min(cap, -(ctx.turnY || 0) * lag));
    const k = Math.min(1, dt * FEEL.swayReturn);
    this.sway.x += (tx - this.sway.x) * k; this.sway.y += (ty - this.sway.y) * k;

    // Placing (Stage 27): the gun drops out of view and the hands lower the item into place
    const place = ctx.place;
    this.placeAmt += ((place ? 1 : 0) - this.placeAmt) * Math.min(1, dt * 10);
    let throwAmt = 0;
    if (this.throwT >= 0) {
      this.throwT += dt / 0.6;
      if (this.throwT >= 1) this.throwT = -1; else throwAmt = Math.min(seg01(this.throwT / 0.2), 1 - seg01((this.throwT - 0.8) / 0.2));
    }
    let dip = this.raise * this.raise * 0.3 + this.placeAmt * 0.45 + throwAmt * 0.16, tilt = this.raise * 0.5 + this.placeAmt * 0.4 + throwAmt * 0.3;
    this.placeItem.visible = this.placeAmt > 0.05;
    if (this.placeItem.visible) {
      const f = place ? place.frac : 1, e = f * f * (3 - 2 * f), floor = place?.pose === 'floor';
      // From the chest down to the floor (kneeling), or out and up against the wall
      const end = floor ? [0, -0.42, -0.5] : [0, -0.06, -0.55];
      const start = [0.06, -0.32 + (1 - this.placeAmt) * -0.3, -0.45];
      this.placeItem.position.set(...start.map((v, i) => v + (end[i] - v) * e));
      this.placeItem.rotation.set(floor ? 0.25 + e * 0.3 : -e * (Math.PI / 2 - 0.15), 0.12, 0);
    }
    if (ctx.reloadFrac >= 0) {
      const s = Math.sin(Math.min(1, ctx.reloadFrac) * Math.PI);
      dip += s * 0.05; tilt += s * 0.45;   // the gun tips over to show the magazine well; the hands work it
    }
    const sprint = ctx.sprinting ? 1 : 0;

    const aimY = -((this.gun?.userData.sightY ?? 0.04) + (this.gun?.userData.hold[1] ?? 0));
    const sideIn = this.shield && !WEAPONS[this.weaponId]?.shield ? SIDEARM_IN : 0;
    this.holder.position.set(
      (REST.x - sideIn) * hip + bobX - sprint * 0.06 + this.sway.x * 0.25,
      REST.y * hip + aimY * (1 - hip) - bobY - dip - sprint * 0.04 + this.sway.y * 0.25,
      REST.z * hip + ADS_Z * (1 - hip) + sp.back,
    );
    this.holder.position.y += sp.up * 0.06;          // the muzzle rises: the whole gun lifts a little as it tips
    let swing = 0;
    if (this.swingT > 0) {
      this.swingT += dt / 0.3;
      if (this.swingT >= 1) this.swingT = 0; else swing = Math.sin(this.swingT * Math.PI);
    }
    this.holder.position.z -= 0.28 * swing;
    this.holder.position.x -= 0.18 * swing;
    this.holder.rotation.set(
      sp.up - tilt * 0.3 - swing * 0.25 + this.sway.y,
      sprint * 0.6 + swing * 0.7 - this.sway.x + sp.side,
      tilt + ctx.lean * 0.2 * hip + sprint * 0.25 + swing * 0.5 + this.sway.x * 0.6 + sp.roll,
    );
    const fov = VIEW.fov - 14 * (1 - hip);
    if (Math.abs(this.camera.fov - fov) > 0.01) { this.camera.fov = fov; this.camera.updateProjectionMatrix(); }

    if (this.shield) {
      // The shield eases between in front (drawn), at the side (pistol out, further while aiming) and
      // swung aside (sprinting), and moves with the steps; in front it moves less, so the viewport stays steady
      const drawn = !!WEAPONS[this.weaponId]?.shield;
      const want = !ctx.cover ? SHIELD_POSE.aside : drawn ? SHIELD_POSE.front : ads > 0.5 ? SHIELD_POSE.sideAim : SHIELD_POSE.side;
      const k2 = Math.min(1, dt * 9);
      for (let i = 0; i < 4; i++) this.shieldPose[i] += (want[i] - this.shieldPose[i]) * k2;
      const [x, y, z, yaw] = this.shieldPose;
      const m = drawn ? 0.3 : 0.6;
      this.shieldHolder.position.set(x + bobX * m + this.sway.x * 0.15 * m, y - bobY * m - this.raise * 0.4 + this.sway.y * 0.15 * m, z - 0.2 * swing);
      this.shieldHolder.rotation.set(this.sway.y * 0.5 * m - swing * 0.15, yaw - this.sway.x * 0.5 * m + swing * 0.3, (drawn ? 0 : 0.04) + ctx.lean * 0.12);
      this.shield.userData.charm?.update(dt, this.shieldHolder.position);
    }
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
    this.holder.updateMatrixWorld(true);
    this.hands.update(dt, { reload: ctx.reloadFrac, swing, kick: this.kick, hidden: this.hidden, throwT: this.throwT, throwColor: this.throwColor, placeItem: this.placeItem, placeAmt: this.placeAmt });
  }

  render(renderer) {
    if (!this.visible || !this.gun || this.hidden) return;
    renderer.autoClear = false;
    renderer.clearDepth();
    renderer.render(this.scene, this.camera);
    renderer.autoClear = true;
  }
}
