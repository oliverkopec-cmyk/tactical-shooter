// First-person weapon view model: simple box guns drawn in their own pass so
// they never clip into walls, with bob, recoil kick, reload dip and muzzle flash.

import * as THREE from 'three';
import { WEAPONS } from '../../shared/weapons.js';
import { SKINS } from '../../shared/skins.js';

const REST = new THREE.Vector3(0.2, -0.2, -0.42);

function part(geo, color, x, y, z) {
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.35 }));
  m.position.set(x, y, z);
  m.userData.base = color;   // which of the gun's own colours this part uses (skins swap them)
  return m;
}
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const barrel = (r, len) => new THREE.CylinderGeometry(r, r, len, 10).rotateX(Math.PI / 2);

/** Small deterministic random numbers so a skin's pattern looks the same everywhere. */
function seeded(text) {
  let a = 0;
  for (let i = 0; i < text.length; i++) a = (a * 31 + text.charCodeAt(i)) >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/**
 * Recolour a gun with a skin: swap its two colours, change how shiny and glowing it is,
 * and draw the pattern as thin marks on the receiver (the first, biggest part).
 */
function applySkin(g, w, skin, skinId) {
  g.traverse((o) => {
    if (!o.isMesh) return;
    const m = o.material;
    if (o.userData.base === w.color) m.color.setHex(skin.body);
    else if (o.userData.base === w.accent) m.color.setHex(skin.accent);
    else { m.metalness = Math.min(1, 0.4 + skin.metal * 0.5); return; }     // barrels and small dark parts stay dark
    m.metalness = 0.2 + skin.metal * 0.75;
    m.roughness = 0.65 - skin.metal * 0.4;
    if (skin.glow > 0) { m.emissive.setHex(o.userData.base === w.color ? skin.body : skin.accent); m.emissiveIntensity = skin.glow * 0.5; }
  });
  const body = g.children[0];
  const geo = body?.geometry?.parameters;
  if (!geo || skin.pattern === 'solid') return;
  const { width: bw, height: bh, depth: bd } = geo;
  const rand = seeded(skinId);
  const markMat = () => new THREE.MeshStandardMaterial({
    color: skin.mark, emissive: skin.mark, emissiveIntensity: 0.25 + skin.glow * 1.3, roughness: 0.5, metalness: 0.3,
  });
  const mark = (sx, sy, sz, x, y, z) => {
    const m = new THREE.Mesh(box(sx, sy, sz), markMat());
    m.position.set(body.position.x + x, body.position.y + y, body.position.z + z);
    g.add(m);
  };
  const e = 0.0015;                       // marks sit just outside the surface
  const sides = [-1, 1];
  if (skin.pattern === 'stripes') {
    for (const f of [-0.3, 0, 0.3]) mark(bw + e * 2, bh + e * 2, bd * 0.05, 0, 0, f * bd);
  } else if (skin.pattern === 'camo') {
    for (let i = 0; i < 9; i++) {
      const sz = bd * (0.1 + rand() * 0.16), sy = bh * (0.2 + rand() * 0.35);
      const side = sides[i % 2], z = (rand() - 0.5) * bd * 0.85, y = (rand() - 0.5) * bh * 0.5;
      mark(e * 2, sy, sz, side * (bw / 2 + e), y, z);
    }
    for (let i = 0; i < 3; i++) mark(bw * (0.3 + rand() * 0.4), e * 2, bd * (0.1 + rand() * 0.15), (rand() - 0.5) * bw * 0.4, bh / 2 + e, (rand() - 0.5) * bd * 0.8);
  } else if (skin.pattern === 'circuit') {
    for (const side of sides) {
      mark(e * 2, bh * 0.06, bd * 0.86, side * (bw / 2 + e), bh * 0.22, 0);
      mark(e * 2, bh * 0.06, bd * 0.55, side * (bw / 2 + e), -bh * 0.22, bd * 0.12);
      for (let i = 0; i < 5; i++) mark(e * 2, bh * 0.4, bd * 0.03, side * (bw / 2 + e), 0, (-0.4 + i * 0.2) * bd);
    }
    mark(bw * 0.1, e * 2, bd * 0.9, 0, bh / 2 + e, 0);
  } else if (skin.pattern === 'flames') {
    for (const side of sides) {
      for (let i = 0; i < 9; i++) {
        const hgt = bh * (0.25 + rand() * 0.6);
        mark(e * 2, hgt, bd * 0.07, side * (bw / 2 + e), -bh / 2 + hgt / 2, (-0.46 + i * 0.115) * bd);
      }
    }
  } else if (skin.pattern === 'void') {
    for (let i = 0; i < 14; i++) {
      const side = sides[i % 2];
      mark(e * 2, bh * 0.07, bh * 0.07, side * (bw / 2 + e), (rand() - 0.5) * bh * 0.7, (rand() - 0.5) * bd * 0.9);
    }
    mark(bw * 0.08, e * 2, bd * 0.95, 0, bh / 2 + e, 0);
    mark(e * 2, bh * 0.05, bd * 0.95, bw / 2 + e, 0, 0);
    mark(e * 2, bh * 0.05, bd * 0.95, -(bw / 2 + e), 0, 0);
  }
}

/** Build a gun model pointing down -z. Shared with remote avatars (scaled down). skinId: optional, from shared/skins.js. */
export function makeGunModel(id, skinId = null) {
  const w = WEAPONS[id] || WEAPONS.rifle;
  const g = new THREE.Group();
  const muzzle = new THREE.Object3D();
  const dark = 0x1b1d20;
  switch (w.model) {
    case 'smg':
      g.add(part(box(0.07, 0.1, 0.34), w.color, 0, 0, 0));
      g.add(part(barrel(0.016, 0.14), dark, 0, 0.015, -0.24));
      g.add(part(box(0.045, 0.2, 0.05), w.accent, 0, -0.14, -0.06));
      g.add(part(box(0.05, 0.05, 0.16), w.accent, 0, 0.0, 0.24));
      g.add(part(box(0.03, 0.03, 0.06), 0x111111, 0, 0.065, -0.05));
      muzzle.position.set(0, 0.015, -0.32);
      break;
    case 'shotgun':
      g.add(part(box(0.075, 0.085, 0.42), w.color, 0, 0, 0));
      g.add(part(barrel(0.024, 0.42), dark, 0, 0.02, -0.4));
      g.add(part(box(0.06, 0.05, 0.2), w.accent, 0, -0.045, -0.34));
      g.add(part(box(0.06, 0.1, 0.22), w.accent, 0, -0.03, 0.29));
      muzzle.position.set(0, 0.02, -0.62);
      break;
    case 'lmg':
      g.add(part(box(0.09, 0.11, 0.56), w.color, 0, 0, 0));
      g.add(part(barrel(0.018, 0.3), dark, 0, 0.02, -0.42));
      g.add(part(box(0.16, 0.14, 0.14), w.accent, 0, -0.13, 0.02));          // drum magazine
      g.add(part(box(0.05, 0.1, 0.05), w.accent, 0, -0.1, -0.2));            // foregrip
      g.add(part(box(0.06, 0.1, 0.22), w.color, 0, -0.01, 0.36));
      g.add(part(box(0.1, 0.03, 0.05), 0x111111, 0, 0.075, -0.1));          // carry handle
      muzzle.position.set(0, 0.02, -0.58);
      break;
    case 'dmr':
      g.add(part(box(0.06, 0.09, 0.56), w.color, 0, 0, 0));
      g.add(part(barrel(0.013, 0.36), dark, 0, 0.015, -0.44));
      g.add(part(box(0.045, 0.15, 0.06), w.accent, 0, -0.11, -0.04));
      g.add(part(box(0.055, 0.1, 0.24), w.accent, 0, -0.015, 0.36));
      g.add(part(barrel(0.026, 0.2), 0x111111, 0, 0.1, -0.02));              // scope
      muzzle.position.set(0, 0.015, -0.62);
      break;
    case 'pistol':
      g.add(part(box(0.045, 0.06, 0.2), w.color, 0, 0.03, -0.02));           // slide
      g.add(part(box(0.04, 0.11, 0.055), w.accent, 0, -0.045, 0.06));        // grip
      g.add(part(box(0.035, 0.03, 0.1), dark, 0, -0.005, -0.02));
      muzzle.position.set(0, 0.04, -0.12);
      break;
    case 'revolver':
      g.add(part(box(0.045, 0.07, 0.16), w.color, 0, 0.03, 0.0));
      g.add(part(barrel(0.035, 0.07), dark, 0, 0.03, 0.0));                  // cylinder
      g.add(part(barrel(0.014, 0.2), w.color, 0, 0.05, -0.17));
      g.add(part(box(0.04, 0.12, 0.06), w.accent, 0, -0.05, 0.08));
      muzzle.position.set(0, 0.05, -0.28);
      break;
    case 'machinePistol':
      g.add(part(box(0.05, 0.07, 0.24), w.color, 0, 0.03, -0.03));
      g.add(part(box(0.04, 0.11, 0.055), w.accent, 0, -0.05, 0.06));
      g.add(part(box(0.03, 0.16, 0.04), dark, 0, -0.09, -0.04));              // long magazine
      g.add(part(barrel(0.013, 0.1), dark, 0, 0.04, -0.2));
      muzzle.position.set(0, 0.04, -0.26);
      break;
    default:   // rifle
      g.add(part(box(0.07, 0.095, 0.5), w.color, 0, 0, 0));
      g.add(part(barrel(0.014, 0.26), dark, 0, 0.015, -0.37));
      g.add(part(box(0.05, 0.16, 0.07), w.accent, 0, -0.12, -0.08));
      g.add(part(box(0.06, 0.08, 0.2), w.accent, 0, -0.01, 0.33));
      g.add(part(box(0.035, 0.045, 0.12), 0x111111, 0, 0.07, -0.02));
      muzzle.position.set(0, 0.015, -0.5);
  }
  g.add(muzzle);
  g.userData.muzzle = muzzle;
  if (skinId && SKINS[skinId]) applySkin(g, w, SKINS[skinId], skinId);
  if (w.scale !== 1) g.scale.setScalar(w.scale);
  // Pistols are short: the view model moves them forward and up so they sit in view
  g.userData.hold = ['pistol', 'revolver', 'machinePistol'].includes(w.model) ? [0, 0.03, -0.1] : [0, 0, 0];
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
    this.weaponKey = null;
    this.gun = null;
    this.kick = 0;
    this.raise = 0;
    this.swingT = 0;
    this.flashTime = 0;
    this.bobPhase = 0;
    this.visible = true;
  }

  setWeapon(id, skinId = null) {
    const key = `${id}|${skinId || ''}`;
    if (key === this.weaponKey) return;
    const previous = this.weaponKey && this.weaponId !== id ? this.weaponId : null;   // only a different gun gets the draw animation
    this.weaponKey = key;
    this.weaponId = id;
    if (this.gun) this.holder.remove(this.gun);
    if (previous) this.raise = 1;   // drawing a gun: lift it into view
    this.gun = makeGunModel(id, skinId);
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
  }

  /** Melee strike: the gun is thrust forward and across. */
  melee() {
    this.swingT = 0.0001;
  }

  /** ctx: { speed, sprinting, crouch, reloadFrac (0..1 or -1), lean } */
  update(dt, ctx) {
    this.kick = Math.max(0, this.kick - dt * 9);
    this.raise = Math.max(0, this.raise - dt * 4.5);
    this.flashTime -= dt;
    this.flash.visible = this.flashTime > 0;
    this.flashLight.intensity = this.flashTime > 0 ? 3 : 0;

    const speed = Math.min(1.6, ctx.speed / 4);
    this.bobPhase += dt * (6 + speed * 6) * (speed > 0.05 ? 1 : 0.3);
    const bobX = Math.sin(this.bobPhase) * 0.012 * speed;
    const bobY = Math.abs(Math.cos(this.bobPhase)) * 0.014 * speed;

    let dip = this.raise * this.raise * 0.3, tilt = this.raise * 0.5;
    if (ctx.reloadFrac >= 0) {
      const s = Math.sin(Math.min(1, ctx.reloadFrac) * Math.PI);
      dip += s * 0.16; tilt += s * 0.7;
    }
    const sprint = ctx.sprinting ? 1 : 0;

    this.holder.position.set(
      REST.x + bobX - sprint * 0.06,
      REST.y - bobY - dip - sprint * 0.04,
      REST.z + this.kick * 0.06,
    );
    let swing = 0;
    if (this.swingT > 0) {
      this.swingT += dt / 0.3;
      if (this.swingT >= 1) this.swingT = 0; else swing = Math.sin(this.swingT * Math.PI);
    }
    this.holder.position.z -= 0.28 * swing;
    this.holder.position.x -= 0.18 * swing;
    this.holder.rotation.set(this.kick * 0.09 - tilt * 0.3 - swing * 0.25, sprint * 0.6 + swing * 0.7, tilt + ctx.lean * 0.2 + sprint * 0.25 + swing * 0.5);

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
