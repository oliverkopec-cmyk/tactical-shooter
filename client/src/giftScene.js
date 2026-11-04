// Gifts in the main menu: a wrapped present for each unopened gift, on the platform in front of
// your operator, bouncing a little and glowing (in the shifting Exclusive colours when it holds an
// exclusive skin). Clicking one plays the unwrapping: the bow pops off, the lid flies away, confetti
// bursts out and what was inside rises from the box.

import * as THREE from 'three';
import { RARITIES } from '../../shared/skins.js';
import { makeGunModel } from './weapons.js';
import { makeCharmModel } from './charmModels.js';
import { menuAudio } from './menuAudio.js';
import { PRESENT_SPOTS } from './menuChristmas.js';

const PAPER = [0xd8323a, 0x2a7ae2, 0x2fb36a, 0x9a4ae8, 0xf0a020, 0x20b8c8];
const RIBBON = [0xf2d46a, 0xffffff, 0xf2d46a, 0xffe0f0, 0xffffff, 0xf2d46a];
// Where boxes sit: four spots on the platform in front of the operator; more gifts stack on top
const SPOTS = [[-0.62, 0.95], [0.62, 0.95], [-1.12, 0.35], [1.12, 0.35]];
const SIZE = 0.38;
const XMAS_PAPER = [0xc8141e, 0x1f7a44, 0xc8141e, 0xe8b22a, 0x1f7a44, 0xf0ece4];
const XMAS_RIBBON = [0xf2d46a, 0xf2d46a, 0xffffff, 0xc8141e, 0xffffff, 0xc8141e];
const XMAS_SHOWN = 8;   // Christmas presents under the tree at once; more appear as these are opened

/** A soft round glow texture for the halo behind each box. */
let haloTexture = null;
function halo() {
  if (haloTexture) return haloTexture;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,0.9)');
  grad.addColorStop(0.4, 'rgba(255,255,255,0.35)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  haloTexture = new THREE.CanvasTexture(c);
  return haloTexture;
}

/** The shifting white-gold-rainbow of Exclusive things, at time t. */
export function exclusiveColor(t, out = new THREE.Color()) {
  const k = 0.5 + 0.5 * Math.sin(t * 0.9);
  out.setHSL((t * 0.08) % 1, 0.55 + 0.35 * k, 0.72);
  return out.lerp(new THREE.Color(0xfff0c0), 0.35 * (1 - k));
}

class GiftBox {
  constructor(gift, index) {
    this.gift = gift;
    this.phase = (gift.id * 1.7) % 6.28;
    const k = gift.id % PAPER.length;
    const s = SIZE * (0.9 + ((gift.id * 7) % 5) * 0.04);
    this.size = s;
    this.group = new THREE.Group();
    const paper = gift.christmas ? XMAS_PAPER[k] : PAPER[k], ribbon = gift.christmas ? XMAS_RIBBON[k] : RIBBON[k];
    this.paper = new THREE.MeshStandardMaterial({ color: gift.exclusive ? 0xf6f0e0 : paper, roughness: 0.45, metalness: gift.exclusive ? 0.6 : 0.1, emissive: 0x000000 });
    this.ribbon = new THREE.MeshStandardMaterial({ color: gift.exclusive ? 0xffd86a : ribbon, roughness: 0.3, metalness: 0.5, emissive: gift.exclusive ? 0xffc040 : ribbon, emissiveIntensity: 0.25 });
    this.body = new THREE.Mesh(new THREE.BoxGeometry(s, s * 0.82, s), this.paper);
    this.body.position.y = s * 0.41;
    this.body.castShadow = true;
    this.lid = new THREE.Group();
    const lidMesh = new THREE.Mesh(new THREE.BoxGeometry(s * 1.08, s * 0.16, s * 1.08), this.paper);
    lidMesh.castShadow = true;
    this.lid.add(lidMesh);
    this.lid.position.y = s * 0.82 + s * 0.06;
    // Ribbons round the box and across the lid, and a bow on top
    const band = 0.13 * s;
    this.straps = new THREE.Group();
    this.straps.add(new THREE.Mesh(new THREE.BoxGeometry(band, s * 0.84, s * 1.02), this.ribbon), new THREE.Mesh(new THREE.BoxGeometry(s * 1.02, s * 0.84, band), this.ribbon));
    this.straps.position.y = s * 0.41;
    this.lid.add(new THREE.Mesh(new THREE.BoxGeometry(band, s * 0.18, s * 1.1), this.ribbon), new THREE.Mesh(new THREE.BoxGeometry(s * 1.1, s * 0.18, band), this.ribbon));
    this.bow = new THREE.Group();
    for (const side of [-1, 1]) {
      const loop = new THREE.Mesh(new THREE.TorusGeometry(s * 0.14, s * 0.035, 8, 16), this.ribbon);
      loop.position.set(side * s * 0.13, s * 0.1, 0);
      loop.rotation.set(0, Math.PI / 2, side * 0.5);
      this.bow.add(loop);
    }
    this.bow.add(new THREE.Mesh(new THREE.SphereGeometry(s * 0.06, 10, 8), this.ribbon));
    this.bow.position.y = s * 0.08;
    this.lid.add(this.bow);
    this.halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: halo(), color: gift.exclusive ? 0xffe7a0 : ribbon, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.55 }));
    this.halo.scale.setScalar(s * 3.2);
    this.halo.position.y = s * 0.5;
    this.halo.renderOrder = -1;
    this.group.add(this.halo, this.body, this.straps, this.lid);
    this.group.rotation.y = ((gift.id * 37) % 60 - 30) * Math.PI / 180;
    this.group.userData.gift = gift.id;
    this.place(index);
  }

  /** Spot on the platform; the fifth gift onwards sits on top of the first ones. */
  place(index) {
    const spots = this.gift.christmas ? PRESENT_SPOTS : SPOTS;
    const [x, z] = spots[index % spots.length];
    this.base = new THREE.Vector3(x, Math.floor(index / spots.length) * SIZE * 1.02 - (this.gift.christmas ? 0.1 : 0), z);
    this.group.position.copy(this.base);
  }

  update(t, hover) {
    // A little hop every couple of seconds, squashing as it lands
    const hop = Math.max(0, Math.sin(t * 2.4 + this.phase));
    const lift = hop * hop * 0.07;
    this.group.position.y = this.base.y + lift;
    const squash = 1 - (1 - hop) * 0.04;
    this.group.scale.set(1 + (1 - squash), squash, 1 + (1 - squash)).multiplyScalar(hover ? 1.08 : 1);
    const pulse = 0.5 + 0.5 * Math.sin(t * 3 + this.phase);
    if (this.gift.exclusive) {
      const c = exclusiveColor(t + this.phase);
      this.halo.material.color.copy(c);
      this.ribbon.emissive.copy(c);
      this.paper.emissive.copy(c).multiplyScalar(0.12 + 0.1 * pulse);
    }
    this.ribbon.emissiveIntensity = 0.25 + 0.5 * pulse + (hover ? 0.4 : 0);
    this.halo.material.opacity = 0.35 + 0.35 * pulse + (hover ? 0.2 : 0);
  }

  dispose(scene) {
    scene.remove(this.group);
    this.group.traverse((o) => { if (o.isMesh) o.geometry.dispose(); });
  }
}

/** All the presents on the platform. */
export class GiftPile {
  constructor(scene) {
    this.scene = scene;
    this.boxes = new Map();   // gift id -> GiftBox
    this.hover = null;
  }

  /** The gifts waiting to be opened: [{ id, title, exclusive }]. Boxes are added and removed to match. */
  set(list, skipId = null) {
    const keep = new Set(list.map((g) => g.id));
    for (const [id, box] of this.boxes) if (!keep.has(id)) { box.dispose(this.scene); this.boxes.delete(id); }
    const lay = (gifts) => gifts.forEach((g, i) => {
      let box = this.boxes.get(g.id);
      if (!box) { box = new GiftBox(g, i); this.boxes.set(g.id, box); this.scene.add(box.group); }
      else box.place(i);
    });
    const waiting = list.filter((g) => g.id !== skipId);
    lay(waiting.filter((g) => !g.christmas));
    const presents = waiting.filter((g) => g.christmas);    // around the tree, oldest first
    for (const g of presents.slice(XMAS_SHOWN)) { const box = this.boxes.get(g.id); if (box) { box.dispose(this.scene); this.boxes.delete(g.id); } }
    lay(presents.slice(0, XMAS_SHOWN));
  }

  /** Take a box out of the pile to unwrap it (the pile doesn't redraw it any more). */
  take(id) {
    const box = this.boxes.get(id);
    this.boxes.delete(id);
    return box;
  }

  setVisible(on) { for (const b of this.boxes.values()) b.group.visible = on; }

  /** The gift id under the pointer (normalised device coordinates), or null. */
  pick(ndc, camera) {
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, camera);
    const hits = ray.intersectObjects([...this.boxes.values()].filter((b) => b.group.visible).map((b) => b.group), true);
    for (const h of hits) {
      let o = h.object;
      while (o && o.userData.gift === undefined) o = o.parent;
      if (o && !h.object.isSprite) return o.userData.gift;
    }
    return null;
  }

  update(t) { for (const [id, b] of this.boxes) b.update(t, id === this.hover); }
}

// ---------------------------------------------------------------- unwrapping

const T_POP = 0.35, T_LID = 0.6, T_RISE = 1.0, T_SHOW = 2.2;
const CONFETTI = 140;

/**
 * Unwrap one box. result: what the server says was inside ({ skin, crate, charm, money, ... }).
 * showGun: the gun to show a gifted skin on. onReveal runs once the item is up.
 */
export class GiftOpening {
  constructor(scene, box, result, { showGun, onReveal }) {
    this.scene = scene;
    this.box = box;
    this.result = result;
    this.onReveal = onReveal;
    this.t = 0;
    this.revealed = false;
    this.done = false;
    this.lidVel = new THREE.Vector3((Math.random() - 0.5) * 2.2, 4.2, 1.6);
    this.lidSpin = new THREE.Vector3(4 + Math.random() * 3, Math.random() * 4, 2 + Math.random() * 3);
    this.bowVel = new THREE.Vector3((Math.random() - 0.5) * 1.5, 3.2, 2.4);
    this.exclusive = result.skin?.rarity === 'exclusive';
    const rar = result.skin?.rarity || result.crate?.rarity || result.charm?.rarity || 'common';
    this.color = new THREE.Color(this.exclusive ? 0xffe7a0 : (result.skin || result.crate || result.charm) ? RARITIES[rar].color : 0xf2d46a);

    // Move the box to the middle of the platform, in front of the operator, for the show
    box.group.position.set(0, 0, 1.05);
    box.base = box.group.position.clone();
    box.group.rotation.y = 0;
    box.group.scale.setScalar(1.25);

    // What rises out of the box
    this.item = new THREE.Group();
    const skinShown = result.skin?.id || (result.crate?.kind === 'gun' ? result.crate.skin : null);
    const gunShown = result.crate?.kind === 'gun' ? result.crate.weapon : showGun;
    const charmShown = result.charm?.id || (result.crate?.kind === 'charm' ? result.crate.charm : null);
    if (skinShown) {
      const gun = makeGunModel(gunShown, skinShown);
      gun.scale.multiplyScalar(1.5 * gun.userData.display);
      this.item.add(gun);
    } else if (charmShown) {
      const charm = makeCharmModel(charmShown);
      charm.scale.setScalar(20);
      charm.position.y = 0.2;
      this.item.add(charm);
    } else {
      // Money: a spinning gold coin
      const coin = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.05, 32).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xf2c230, metalness: 1, roughness: 0.25, emissive: 0x7a5a10, emissiveIntensity: 0.4 }));
      this.item.add(coin);
    }
    this.item.position.set(0, 0.3, 1.05);
    this.item.visible = false;
    scene.add(this.item);
    this.light = new THREE.PointLight(this.color, 0, 5, 1.6);
    this.light.position.set(0, 0.9, 1.4);
    scene.add(this.light);

    // Confetti: one instanced mesh of little paper squares
    const mat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, transparent: true });
    this.confetti = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.035, 0.022), mat, CONFETTI);
    this.confetti.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const colors = [0xff3a5a, 0x3ab0ff, 0x6aff7a, 0xffd23a, 0xd06aff, 0xffffff];
    this.bits = [];
    for (let i = 0; i < CONFETTI; i++) {
      this.confetti.setColorAt(i, new THREE.Color(this.exclusive ? new THREE.Color().setHSL(i / CONFETTI, 0.8, 0.65) : colors[i % colors.length]));
      const a = Math.random() * Math.PI * 2, v = 0.8 + Math.random() * 2.2;
      this.bits.push({ p: new THREE.Vector3(0, 0.6, 1.05), v: new THREE.Vector3(Math.cos(a) * v, 2.5 + Math.random() * 3, Math.sin(a) * v * 0.6 + 0.6), r: new THREE.Euler(Math.random() * 6, Math.random() * 6, 0), s: new THREE.Vector3(3 + Math.random() * 6, 2 + Math.random() * 5, 0) });
    }
    this.confetti.visible = false;
    this.confetti.frustumCulled = false;
    scene.add(this.confetti);
    this.m = new THREE.Matrix4();
    this.q = new THREE.Quaternion();
  }

  /** Jump to the end. */
  skip() {
    if (this.t < T_RISE) { this.t = T_RISE; this.pop(); this.burst(); }
    this.t = Math.max(this.t, T_SHOW);
  }

  pop() {
    if (this.popped) return;
    this.popped = true;
    menuAudio.pop();
  }

  burst() {
    if (this.burstDone) return;
    this.burstDone = true;
    this.confetti.visible = true;
    this.item.visible = true;
    menuAudio.giftBurst(this.exclusive);
  }

  update(dt, time) {
    if (this.done) return;
    this.t += dt;
    const t = this.t, box = this.box;
    box.update(time, false);
    // The bow pops off first
    if (t > T_POP) {
      this.pop();
      this.bowVel.y -= 9 * dt;
      box.bow.position.addScaledVector(this.bowVel, dt);
      box.bow.rotation.z += dt * 8;
      box.bow.scale.setScalar(Math.max(0, 1 - (t - T_POP) * 0.8));
      for (const s of box.straps.children) s.scale.y = Math.max(0.01, 1 - (t - T_POP) * 3);
    }
    // Then the lid flies off and the confetti bursts out
    if (t > T_LID) {
      this.burst();
      this.lidVel.y -= 9 * dt;
      box.lid.position.addScaledVector(this.lidVel, dt);
      box.lid.rotation.x += this.lidSpin.x * dt; box.lid.rotation.y += this.lidSpin.y * dt; box.lid.rotation.z += this.lidSpin.z * dt;
      if (t > T_LID + 1.2) box.lid.visible = false;
      for (let i = 0; i < this.bits.length; i++) {
        const b = this.bits[i];
        b.v.y -= 4.5 * dt;
        b.v.multiplyScalar(1 - 1.2 * dt);   // air resistance: they flutter down
        b.p.addScaledVector(b.v, dt);
        b.r.x += b.s.x * dt; b.r.y += b.s.y * dt;
        if (b.p.y < 0.01) { b.p.y = 0.01; b.v.set(0, 0, 0); }
        this.m.compose(b.p, this.q.setFromEuler(b.r), new THREE.Vector3(1, 1, 1));
        this.confetti.setMatrixAt(i, this.m);
      }
      this.confetti.instanceMatrix.needsUpdate = true;
      this.confetti.material.opacity = Math.max(0, Math.min(1, 6 - (t - T_LID) * 0.9));
    }
    // What's inside rises out and turns slowly
    if (t > T_LID) {
      const k = Math.min(1, (t - T_LID) / (T_RISE - T_LID + 0.6));
      const ease = 1 - (1 - k) ** 3;
      this.item.position.y = 0.3 + ease * 0.95 + Math.sin(time * 1.4) * 0.03 * ease;
      this.item.rotation.y = time * 0.8;
      const pulse = this.exclusive ? exclusiveColor(time) : this.color;
      this.light.color.copy(pulse);
      this.light.intensity = 6 * ease;
      box.group.scale.setScalar(1.25 * (1 - Math.max(0, (t - T_SHOW - 0.4) * 1.5)) || 0.0001);
      if (box.group.scale.x < 0.02) box.group.visible = false;
    }
    if (t > T_SHOW && !this.revealed) { this.revealed = true; this.onReveal?.(); }
  }

  dispose() {
    this.done = true;
    this.box.dispose(this.scene);
    this.scene.remove(this.item, this.light, this.confetti);
    this.confetti.geometry.dispose();
  }
}
