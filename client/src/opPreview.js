// The operator standing and slowly turning in the loadout screen's details panel (Stage F):
// the same body the other players see, holding their primary with your skin and charm. It has its
// own small renderer that exists only while the screen is open, then is thrown away.

import * as THREE from 'three';
import { RemotePlayer } from './avatars.js';
import { OPERATORS } from '../../shared/operators.js';
import { TEAM_COLORS } from '../../shared/constants.js';

export class OpPreview {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.scene = new THREE.Scene();
    this.scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x202530, 1.3));
    const key = new THREE.DirectionalLight(0xfff1dc, 2.4);
    key.position.set(2, 3, 3);
    this.scene.add(key);
    this.rim = new THREE.DirectionalLight(0xffffff, 1.6);
    this.rim.position.set(-2, 2.5, -3);
    this.scene.add(this.rim);
    // A dark disc with a glowing ring to stand on
    this.ringMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7 });
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.62, 0.68, 48).rotateX(-Math.PI / 2), this.ringMat);
    ring.position.y = 0.012;
    const disc = new THREE.Mesh(new THREE.CircleGeometry(0.7, 48).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x151a21, roughness: 0.6, metalness: 0.4 }));
    this.scene.add(disc, ring);
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.1, 20);
    this.camera.position.set(0, 1.25, 4.1);
    this.camera.lookAt(0, 0.95, 0);
    this.angle = 0.5;
    this.look = null;
    this.avatar = null;
    this.running = false;
  }

  /** look: { team, operatorId, weaponId, skinId, charmId } */
  setLook(look) {
    const key = JSON.stringify(look);
    if (key === this.lookKey) return;
    this.lookKey = key;
    if (!this.avatar || this.avatar.team !== look.team) {
      this.avatar?.dispose();
      this.avatar = new RemotePlayer(this.scene, { id: 'preview', name: '', team: look.team, skins: {} }, true);
      this.avatar.label.visible = false;
      this.avatar.marker.visible = false;
    }
    this.avatar.setOperator(look.operatorId);
    this.avatar.skins = { [look.weaponId]: look.skinId };
    this.avatar.charms = { [look.weaponId]: look.charmId };
    this.avatar.attachments = look.attachments ? { [look.weaponId]: look.attachments } : {};
    this.avatar.weaponId = null;   // rebuild the gun with this skin and charm
    if (this.avatar.shield) { this.avatar.shieldMount.clear(); this.avatar.shield = null; }
    this.avatar.setWeapon(look.weaponId);
    this.ringMat.color.setHex(OPERATORS[look.operatorId]?.color ?? TEAM_COLORS[look.team]);
  }

  start() {
    if (this.running) return;
    this.running = true;
    let last = performance.now();
    const loop = (t) => {
      if (!this.running) return;
      const dt = Math.min(0.05, (t - last) / 1000);
      last = t;
      this.frame(t, dt);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  frame(t, dt) {
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (!w || !h) return;
    if (this.canvas.width !== Math.round(w * this.renderer.getPixelRatio())) {
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }
    this.angle += dt * 0.45;
    if (this.avatar) {
      this.avatar.push(t, { x: 0, y: 0, z: 0, yaw: this.angle, pitch: 0, crouch: 0, prone: 0, lean: 0, vx: 0, vy: 0, vz: 0, onGround: true, alive: true });
      this.avatar.update(t, dt);
    }
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.running = false;
    this.avatar?.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}
