// The crate opening sequence, played in the 3D menu scene (about 4 seconds):
//   1. the crate drops onto the platform with a thud and dust
//   2. it shakes and glows in pulses; the glow climbs the rarity colours (grey, blue, purple,
//      gold) and stops on the colour of the skin you got
//   3. the lid bursts off with a flash and particles in that colour
//   4. the gun rises out, spinning slowly, wearing the new skin
// Legendary pulls get a bigger burst, gold light beams and a fanfare. A click skips ahead.

import * as THREE from 'three';
import { makeGunModel } from './weapons.js';
import { menuAudio } from './menuAudio.js';

const RARITY_ORDER = ['common', 'rare', 'epic', 'legendary'];
const RARITY_COLOR = { common: 0xb0b6bd, rare: 0x4a90e2, epic: 0xb04ae8, legendary: 0xf0a020 };

// Timeline in seconds
const T_LAND = 0.55, T_BURST = 2.75, T_RISE_END = 3.9;

export class CrateSequence {
  /** parent: the THREE scene. result: { weapon, skin, rarity }. onReveal runs when the gun appears. */
  constructor(scene, result, { onReveal } = {}) {
    this.scene = scene;
    this.result = result;
    this.onReveal = onReveal;
    this.t = 0;
    this.done = false;
    this.revealed = false;
    this.landed = false;
    this.burst = false;
    this.pulseStep = -1;
    this.particles = [];
    this.beams = [];
    this.legendary = result.rarity === 'legendary';
    this.finalStep = RARITY_ORDER.indexOf(result.rarity);

    this.group = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x2a3038, roughness: 0.5, metalness: 0.6 });
    this.trimMat = new THREE.MeshStandardMaterial({ color: 0x555a60, emissive: 0x888888, emissiveIntensity: 0.3, roughness: 0.4 });
    this.body = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.8, 0.8), bodyMat);
    this.body.position.y = 0.4;
    this.lid = new THREE.Group();
    const lidMesh = new THREE.Mesh(new THREE.BoxGeometry(1.34, 0.16, 0.84), bodyMat);
    this.lid.add(lidMesh);
    this.lid.position.y = 0.88;
    this.trims = [];
    for (const x of [-0.45, 0.45]) {
      const trim = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.84, 0.86), this.trimMat);
      trim.position.set(x, 0.4, 0);
      this.group.add(trim);
      const lidTrim = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.18, 0.88), this.trimMat);
      lidTrim.position.set(x, 0, 0);
      this.lid.add(lidTrim);
    }
    this.group.add(this.body, this.lid);
    this.group.position.y = 7;
    this.light = new THREE.PointLight(0xffffff, 0, 8, 1.6);
    this.light.position.set(0, 1.2, 0.6);
    this.group.add(this.light);
    scene.add(this.group);

    // The gun that rises out of the crate
    this.gun = makeGunModel(result.weapon, result.skin);
    this.gun.scale.multiplyScalar(1.9);
    this.gunHolder = new THREE.Group();
    this.gunHolder.add(this.gun);
    this.gunHolder.position.set(0, 0.7, 0);
    this.gunHolder.visible = false;
    scene.add(this.gunHolder);
  }

  setGlow(color, intensity) {
    this.trimMat.emissive.setHex(color);
    this.trimMat.color.setHex(color);
    this.trimMat.emissiveIntensity = intensity;
    this.light.color.setHex(color);
    this.light.intensity = intensity * 14;
  }

  spawnParticles(count, color, speed, up = 2) {
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1 });
    for (let i = 0; i < count; i++) {
      const s = 0.05 + Math.random() * 0.1;
      const m = new THREE.Mesh(new THREE.BoxGeometry(s, s, s), mat.clone());
      m.position.set((Math.random() - 0.5) * 1.0, 0.9, (Math.random() - 0.5) * 0.6);
      const a = Math.random() * Math.PI * 2, v = speed * (0.4 + Math.random() * 0.8);
      this.particles.push({ m, v: new THREE.Vector3(Math.cos(a) * v, up * (0.4 + Math.random()), Math.sin(a) * v), life: 1 + Math.random() * 0.8, max: 1.8 });
      this.scene.add(m);
    }
  }

  spawnDust() {
    for (let i = 0; i < 16; i++) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2), new THREE.MeshBasicMaterial({ color: 0x9a9a94, transparent: true, opacity: 0.7 }));
      const a = Math.random() * Math.PI * 2;
      m.position.set(Math.cos(a) * 0.7, 0.1, Math.sin(a) * 0.5);
      this.particles.push({ m, v: new THREE.Vector3(Math.cos(a) * 1.6, 0.4 + Math.random() * 0.5, Math.sin(a) * 1.6), life: 0.9, max: 0.9, grow: true });
      this.scene.add(m);
    }
  }

  /** Jump straight to the reveal. */
  skip() {
    if (this.done) return;
    this.t = Math.max(this.t, T_RISE_END);
    this.landed = this.burst = true;
    this.group.position.y = 0;
    this.lid.visible = false;
    this.lid.position.set(0, 3, 0);
    this.reveal();
  }

  reveal() {
    if (this.revealed) return;
    this.revealed = true;
    this.gunHolder.visible = true;
    this.setGlow(RARITY_COLOR[this.result.rarity], 1.2);
    menuAudio.reveal();
    this.onReveal?.();
  }

  update(dt, camera) {
    this.t += dt;
    const t = this.t, color = RARITY_COLOR[this.result.rarity];

    // 1. drop
    if (t < T_LAND) {
      const k = t / T_LAND;
      this.group.position.y = 7 * (1 - k * k);
    } else {
      this.group.position.y = 0;
      if (!this.landed) {
        this.landed = true;
        menuAudio.thud();
        this.spawnDust();
        this.shake = 0.25;
      }
    }
    // camera thump on landing
    if (this.shake > 0.001) {
      camera.position.y += (Math.random() - 0.5) * this.shake * 0.3;
      this.shake *= Math.exp(-9 * dt);
    }

    // 2. shake and pulse through the rarity colours
    if (t >= T_LAND && t < T_BURST) {
      const span = T_BURST - T_LAND, k = (t - T_LAND) / span;
      const steps = this.finalStep + 1;                       // one pulse per colour up to the result's
      const step = Math.min(steps - 1, Math.floor(k * steps));
      if (step !== this.pulseStep) { this.pulseStep = step; menuAudio.pulse(step); }
      const local = (k * steps) % 1;
      this.setGlow(RARITY_COLOR[RARITY_ORDER[step]], 0.4 + Math.sin(local * Math.PI) * 1.4);
      const amp = 0.015 + k * 0.05;
      this.group.rotation.z = (Math.random() - 0.5) * amp * 2;
      this.group.rotation.x = (Math.random() - 0.5) * amp;
      this.group.position.x = (Math.random() - 0.5) * amp * 0.8;
    } else if (t >= T_BURST) {
      this.group.rotation.set(0, 0, 0);
      this.group.position.x = 0;
    }

    // 3. the lid bursts
    if (t >= T_BURST && !this.burst) {
      this.burst = true;
      menuAudio.burst(this.result.rarity);
      this.setGlow(color, 3);
      this.spawnParticles(this.legendary ? 110 : 45, color, this.legendary ? 6 : 4, this.legendary ? 7 : 5);
      if (this.legendary) {
        menuAudio.legendary();
        for (let i = 0; i < 9; i++) {
          const beam = new THREE.Mesh(new THREE.BoxGeometry(0.1 + Math.random() * 0.12, 9, 0.1), new THREE.MeshBasicMaterial({ color: i % 2 ? 0xffd870 : 0xf0a020, transparent: true, opacity: 0.55, depthWrite: false }));
          beam.position.set(0, 4.8, 0);
          beam.rotation.z = (i / 9 - 0.5) * 1.5;
          beam.rotation.y = i * 0.7;
          this.scene.add(beam);
          this.beams.push(beam);
        }
      }
    }
    if (this.burst && !this.revealed) {
      const k = (t - T_BURST) / (T_RISE_END - T_BURST);
      this.lid.position.y = 0.88 + (t - T_BURST) * 5;
      this.lid.rotation.z = (t - T_BURST) * 3.5;
      this.lid.position.x = (t - T_BURST) * 2.2;
      if (this.lid.position.y > 4) this.lid.visible = false;
      this.setGlow(color, Math.max(1.2, 3 - k * 3));
      // 4. the gun rises, wearing the skin
      this.gunHolder.visible = true;
      this.gunHolder.position.y = 0.7 + Math.min(1, k * 1.3) * 1.0;
      this.gunHolder.scale.setScalar(0.3 + Math.min(1, k * 1.4) * 0.7);
      if (t >= T_RISE_END) this.reveal();
    }
    if (this.gunHolder.visible) {
      this.gunHolder.rotation.y += dt * 0.9;
      if (this.revealed) this.gunHolder.position.y = 1.7 + Math.sin(t * 1.6) * 0.06;
    }
    for (const b of this.beams) b.material.opacity = Math.max(0.12, b.material.opacity - dt * 0.05);

    // particles
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      p.v.y -= (p.grow ? 0 : 6) * dt;
      p.m.position.addScaledVector(p.v, dt);
      p.m.material.opacity = Math.max(0, p.life / p.max);
      if (p.grow) p.m.scale.multiplyScalar(1 + dt * 2.5);
      if (p.life <= 0) { this.scene.remove(p.m); p.m.material.dispose(); this.particles.splice(i, 1); }
    }
    return this.revealed;
  }

  dispose() {
    this.done = true;
    this.scene.remove(this.group, this.gunHolder);
    for (const p of this.particles) this.scene.remove(p.m);
    for (const b of this.beams) this.scene.remove(b);
    this.particles = [];
    this.beams = [];
  }
}
