// The 3D scene behind the main menu: your operator standing on a lit platform
// holding their gun (with its skin), and in the Operators tab a big slowly
// turning copy of the gun to show the skin off. Drag to turn the operator.

import * as THREE from 'three';
import { TEAM_COLORS } from '../../shared/constants.js';
import { OPERATORS } from '../../shared/operators.js';
import { RemotePlayer } from './avatars.js';
import { makeGunModel } from './weapons.js';

const CAMERA = { y: 1.6, z: 6.8, lookY: 1.15 };

export class MenuScene {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0b0f15);
    this.scene.fog = new THREE.Fog(0x0b0f15, 7, 16);
    this.camera = new THREE.PerspectiveCamera(32, 1, 0.1, 40);

    this.scene.add(new THREE.HemisphereLight(0xb8ccff, 0x141a22, 1.1));
    const key = new THREE.DirectionalLight(0xfff0dd, 2.2);
    key.position.set(2.5, 4, 3.5);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.left = -3; key.shadow.camera.right = 3; key.shadow.camera.top = 3; key.shadow.camera.bottom = -2;
    this.scene.add(key);
    this.rim = new THREE.DirectionalLight(0xffffff, 2.4);
    this.rim.position.set(-3, 2.5, -3);
    this.scene.add(this.rim);

    // Platform with a glowing ring, and a dark backdrop
    const floor = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 1.8, 0.1, 48), new THREE.MeshStandardMaterial({ color: 0x151b24, roughness: 0.6, metalness: 0.5 }));
    floor.position.y = -0.05;
    floor.receiveShadow = true;
    this.ringMat = new THREE.MeshBasicMaterial({ color: 0xe8833a });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.72, 0.02, 8, 64), this.ringMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.002;
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(30, 12), new THREE.MeshStandardMaterial({ color: 0x0f141b, roughness: 1 }));
    wall.position.set(0, 4, -5);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshStandardMaterial({ color: 0x0c1016, roughness: 1 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.1;
    this.scene.add(floor, ring, wall, ground);

    this.avatar = null;
    this.avatarTeam = null;
    this.showcase = null;
    this.showcaseKey = '';
    this.mode = 'play';
    this.look = { team: 'attack', operatorId: 'recruit_atk', weaponId: 'rifle', skinId: null };
    this.userYaw = 0;
    this.targetX = 0;
    this.x = 0;
    this.time = 0;
    this.running = false;
    this.dragging = false;

    canvas.addEventListener('pointerdown', (e) => { this.dragging = true; this.lastX = e.clientX; canvas.setPointerCapture?.(e.pointerId); });
    canvas.addEventListener('pointermove', (e) => { if (this.dragging) { this.userYaw += (e.clientX - this.lastX) * 0.012; this.lastX = e.clientX; } });
    const release = () => { this.dragging = false; };
    canvas.addEventListener('pointerup', release);
    canvas.addEventListener('pointercancel', release);
    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // Keep the whole platform in view on tall or narrow screens
    this.camera.position.set(0, CAMERA.y, CAMERA.z * Math.max(1, 1.5 / this.camera.aspect));
    this.camera.lookAt(0, CAMERA.lookY, 0);
    this.camera.updateProjectionMatrix();
  }

  /**
   * 'play': the operator stands in the middle. 'operators': they step left to make room for the gun showcase.
   * 'shop': just the big gun, to look at a skin before buying it.
   */
  setMode(mode) {
    this.mode = mode;
    this.targetX = mode === 'operators' ? -0.8 : 0;
    this.applyShowcaseLayout();
  }

  applyShowcaseLayout() {
    if (!this.showcase) return;
    const shop = this.mode === 'shop';
    this.showcase.visible = this.mode === 'operators' || shop;
    this.showcase.position.x = shop ? 0.2 : 0.3;
    this.showcase.scale.setScalar(shop ? 1.35 : 1);
  }

  /** What to show: { team, operatorId, weaponId, skinId } */
  setLook(look) {
    this.look = { ...this.look, ...look };
    const { team, operatorId, weaponId, skinId } = this.look;
    if (!this.avatar || this.avatarTeam !== team) this.buildAvatar(team);
    this.avatar.setOperator(operatorId);
    this.avatar.skins = { [weaponId]: skinId };
    this.avatar.weaponId = null;                 // force the gun to be rebuilt with the new skin
    this.avatar.setWeapon(weaponId);
    const color = OPERATORS[operatorId]?.color ?? TEAM_COLORS[team];
    this.ringMat.color.setHex(color);
    this.rim.color.setHex(color);

    const key = `${weaponId}|${skinId || ''}`;
    if (key !== this.showcaseKey) {
      this.showcaseKey = key;
      if (this.showcase) this.scene.remove(this.showcase);
      const holder = new THREE.Group();
      const gun = makeGunModel(weaponId, skinId);
      gun.userData.hold && gun.position.set(0, 0, 0);
      gun.scale.multiplyScalar(1.45);
      gun.traverse((o) => { if (o.isMesh) o.castShadow = true; });
      holder.add(gun);
      holder.position.set(0.3, 1.2, 0);
      this.scene.add(holder);
      this.showcase = holder;
      this.applyShowcaseLayout();
    }
  }

  buildAvatar(team) {
    if (this.avatar) this.avatar.dispose();
    this.avatar = new RemotePlayer(this.scene, { id: 'menu', name: '', team, skins: {} }, true);
    this.avatar.label.visible = false;
    this.avatar.marker.visible = false;
    this.avatarTeam = team;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    this.resize();
    const frame = (now) => {
      if (!this.running) return;
      requestAnimationFrame(frame);
      this.tick(now);
    };
    requestAnimationFrame(frame);
  }

  stop() {
    this.running = false;
  }

  tick(now) {
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.time += dt;
    this.x += (this.targetX - this.x) * (1 - Math.exp(-6 * dt));
    if (!this.dragging) this.userYaw *= Math.exp(-0.6 * dt);          // drifts back to facing you

    if (this.avatar) {
      const yaw = Math.PI - 0.7 + Math.sin(this.time * 0.5) * 0.22 + this.userYaw;   // turned a little so the gun is seen from the side
      this.avatar.push(now, { x: this.x, y: 0, z: 0, yaw, pitch: 0, crouch: 0, prone: 0, lean: 0, vx: 0, vy: 0, vz: 0, onGround: true, alive: true });
      this.avatar.update(now, dt);
      this.avatar.root.visible = this.mode !== 'shop';
    }
    if (this.showcase?.visible) {
      this.showcase.rotation.y = this.time * 0.7;
      this.showcase.position.y = 1.2 + Math.sin(this.time * 1.4) * 0.05;
    }
    this.renderer.render(this.scene, this.camera);
  }
}
