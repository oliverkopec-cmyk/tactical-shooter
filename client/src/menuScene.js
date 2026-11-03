// The 3D scene behind the main menu: your operator standing on a lit pad on a rooftop at dusk
// (client/src/menuBackdrop.js) holding their gun (with its skin), and in the Operators tab a big
// slowly turning copy of the gun to show the skin off. The camera drifts slowly so the scene is
// never quite still. Drag to turn the operator. The Low graphics setting turns the effects down.

import * as THREE from 'three';
import { TEAM_COLORS } from '../../shared/constants.js';
import { OPERATORS } from '../../shared/operators.js';
import { RemotePlayer } from './avatars.js';
import { makeGunModel } from './weapons.js';
import { attachCharm } from './charmModels.js';
import { CrateSequence } from './crateScene.js';
import { GiftPile, GiftOpening } from './giftScene.js';
import { MenuBackdrop } from './menuBackdrop.js';
import { lowGraphics, quality, pixelRatioFor } from './graphics.js';
import { onSettingsChange } from './settings.js';

const CAMERA = { y: 1.6, z: 6.8, lookY: 1.15 };

/** A soft round glow (for the light pooling under the operator). */
function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,0.8)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.25)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

export class MenuScene {
  constructor(canvas) {
    this.canvas = canvas;
    this.low = lowGraphics();
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: quality().aa === 'on' });
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x2c2536, 0.0085);
    this.camera = new THREE.PerspectiveCamera(32, 1, 0.1, 300);

    // Lighting: a cool sky fill, a warm key light from the low sun on the left (casting soft shadows),
    // a rim light from behind in the operator's colour, and a faint blue bounce from the city
    this.scene.add(new THREE.HemisphereLight(0x8a9cd0, 0x1a1420, 0.75));
    const key = new THREE.DirectionalLight(0xffc8a0, 2.4);
    key.position.set(-3.5, 4, 3.5);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.radius = 5;
    key.shadow.bias = -0.0005;
    key.shadow.camera.left = -3.5; key.shadow.camera.right = 3.5; key.shadow.camera.top = 3.5; key.shadow.camera.bottom = -1.5;
    this.key = key;
    this.scene.add(key);
    this.rim = new THREE.DirectionalLight(0xffffff, 3.2);
    this.rim.position.set(2.5, 3, -4);
    this.scene.add(this.rim);
    const bounce = new THREE.DirectionalLight(0x5a7ad0, 0.5);
    bounce.position.set(3, 1, -2);
    this.scene.add(bounce);

    // The pad: dark metal with a glowing ring in the operator's colour and light pooling under their feet
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 1.8, 0.1, 48), new THREE.MeshStandardMaterial({ color: 0x1a2029, roughness: 0.45, metalness: 0.7 }));
    pad.position.y = -0.05;
    pad.receiveShadow = true;
    this.ringMat = new THREE.MeshBasicMaterial({ color: 0xe8833a });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.72, 0.022, 8, 64), this.ringMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.002;
    const inner = new THREE.Mesh(new THREE.TorusGeometry(1.15, 0.008, 6, 64), this.ringMat);
    inner.rotation.x = Math.PI / 2;
    inner.position.y = 0.004;
    this.glowMat = new THREE.MeshBasicMaterial({ map: glowTexture(), color: 0xe8833a, transparent: true, opacity: 0.45, depthWrite: false, blending: THREE.AdditiveBlending });
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(3.8, 3.8), this.glowMat);
    glow.rotation.x = -Math.PI / 2;
    glow.position.y = 0.006;
    this.padLight = new THREE.PointLight(0xe8833a, 1.4, 3.5, 1.6);
    this.padLight.position.set(0, 0.35, 0.6);
    this.scene.add(pad, ring, inner, glow, this.padLight);

    this.applyQuality();
    this.offSettings = onSettingsChange((name) => {
      if (name !== 'graphics' && !/^g[A-Z]/.test(name)) return;
      clearTimeout(this.qualityTimer);                       // a preset sets several options at once: rebuild once
      this.qualityTimer = setTimeout(() => this.applyQuality(), 0);
    });

    this.avatar = null;
    this.avatarTeam = null;
    this.showcase = null;
    this.showcaseKey = '';
    this.mode = 'play';
    this.look = { team: 'attack', operatorId: 'recruit_atk', weaponId: 'rifle', skinId: null, charmId: null };
    this.userYaw = 0;
    this.targetX = 0;
    this.x = 0;
    this.time = 0;
    this.running = false;
    this.dragging = false;
    this.gifts = new GiftPile(this.scene);   // unopened gifts, as presents in front of the operator
    this.giftList = [];
    this.opening = null;                       // a present being unwrapped
    this.onGiftClick = null;

    canvas.addEventListener('pointerdown', (e) => { this.dragging = true; this.lastX = e.clientX; this.downAt = [e.clientX, e.clientY]; canvas.setPointerCapture?.(e.pointerId); });
    canvas.addEventListener('pointermove', (e) => {
      if (this.dragging) { this.userYaw += (e.clientX - this.lastX) * 0.012; this.lastX = e.clientX; }
      const id = this.giftsShown() ? this.gifts.pick(this.ndc(e), this.camera) : null;
      this.gifts.hover = id;
      canvas.style.cursor = id !== null ? 'pointer' : '';
    });
    const release = () => { this.dragging = false; };
    // A click (not a drag) on a present opens it
    canvas.addEventListener('pointerup', (e) => {
      const d = this.downAt ? Math.hypot(e.clientX - this.downAt[0], e.clientY - this.downAt[1]) : 99;
      if (d < 6 && this.giftsShown()) {
        const id = this.gifts.pick(this.ndc(e), this.camera);
        if (id !== null) this.onGiftClick?.(id);
      }
    });
    canvas.addEventListener('pointerup', release);
    canvas.addEventListener('pointercancel', release);
    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  /** Build (or rebuild) the rooftop for the graphics setting: Low has fewer effects, no shadows, no extra lights. */
  applyQuality() {
    this.low = lowGraphics();
    this.renderer.setPixelRatio(Math.min(pixelRatioFor(quality().resolution), 1.5));   // the menu never needs more than 1.5x
    this.renderer.shadowMap.enabled = quality().shadows !== 'off';
    this.renderer.shadowMap.needsUpdate = true;
    this.padLight.visible = !this.low;
    this.backdrop?.dispose();
    this.backdrop = new MenuBackdrop(this.scene, { low: this.low });
    this.scene.traverse((o) => { if (o.material) o.material.needsUpdate = true; });   // shadows on/off need the shaders rebuilt
    this.resize();
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // Keep the whole platform in view on tall or narrow screens
    this.camDist = CAMERA.z * Math.max(1, 1.5 / this.camera.aspect);
    this.placeCamera(this.time || 0);
    this.camera.updateProjectionMatrix();
  }

  /** The slow cinematic drift: the camera sways gently around its spot and keeps the operator framed. */
  placeCamera(t) {
    const d = this.camDist || CAMERA.z;
    this.camera.position.set(Math.sin(t * 0.13) * 0.22 + Math.sin(t * 0.051) * 0.12, CAMERA.y + Math.sin(t * 0.17) * 0.06, d + Math.sin(t * 0.09) * 0.18);
    this.camera.lookAt(Math.sin(t * 0.11) * 0.05, CAMERA.lookY + Math.sin(t * 0.07) * 0.03, 0);
  }

  /**
   * 'play': the operator stands in the middle. 'operators': they step left to make room for the gun showcase.
   * 'shop': just the big gun, to look at a skin before buying it.
   */
  setMode(mode) {
    this.mode = mode;
    this.targetX = mode === 'operators' ? -0.8 : 0;
    this.applyShowcaseLayout();
    if (mode !== 'crate') this.stopCrate();
  }

  ndc(e) {
    const r = this.canvas.getBoundingClientRect();
    return new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  }

  giftsShown() { return this.mode === 'play' && !this.opening && !this.crate; }

  /** The unopened gifts: [{ id, title, exclusive }]. */
  setGifts(list) {
    this.giftList = list;
    this.gifts.set(list, this.opening?.box.gift.id);
  }

  /** Unwrap a present: result is what the server says was inside; onReveal runs when it is up. showGun: the gun a gifted skin is shown on. */
  playGift(id, result, { showGun, onReveal }) {
    const box = this.gifts.take(id);
    if (!box) { onReveal?.(); return; }
    this.stopGift();
    this.opening = new GiftOpening(this.scene, box, result, { showGun, onReveal });
    this.gifts.setVisible(false);
  }

  stopGift() {
    this.opening?.dispose();
    this.opening = null;
    this.gifts.setVisible(true);
    this.gifts.set(this.giftList);
  }

  /** Play the crate opening for a result { weapon, skin, rarity }; onReveal runs when the gun appears. */
  playCrate(result, onReveal) {
    this.stopCrate();
    this.mode = 'crate';
    this.applyShowcaseLayout();
    this.crate = new CrateSequence(this.scene, result, { onReveal });
    return this.crate;
  }

  stopCrate() {
    this.crate?.dispose();
    this.crate = null;
  }

  applyShowcaseLayout() {
    if (!this.showcase) return;
    const shop = this.mode === 'shop';
    this.showcase.visible = this.mode === 'operators' || shop;   // hidden while a crate is opening
    this.showcase.position.x = shop ? 0.2 : 0.3;
    this.showcase.scale.setScalar(shop ? 1.35 : 1);
  }

  /** What to show: { team, operatorId, weaponId, skinId } */
  setLook(look) {
    this.look = { ...this.look, ...look };
    const { team, operatorId, weaponId, skinId, charmId } = this.look;
    if (!this.avatar || this.avatarTeam !== team) this.buildAvatar(team);
    this.avatar.setOperator(operatorId);
    this.avatar.skins = { [weaponId]: skinId };
    this.avatar.charms = { [weaponId]: charmId };
    this.avatar.weaponId = null;                 // force the gun to be rebuilt with the new skin
    this.avatar.setWeapon(weaponId);
    const color = OPERATORS[operatorId]?.color ?? TEAM_COLORS[team];
    this.ringMat.color.setHex(color);
    this.glowMat.color.setHex(color);
    this.padLight.color.setHex(color);
    this.rim.color.setHex(color).lerp(new THREE.Color(0xffffff), 0.35);

    const key = `${weaponId}|${skinId || ''}|${charmId || ''}`;
    if (key !== this.showcaseKey) {
      this.showcaseKey = key;
      if (this.showcase) this.scene.remove(this.showcase);
      const holder = new THREE.Group();
      const gun = makeGunModel(weaponId, skinId);
      attachCharm(gun, charmId);
      this.showcaseGun = gun;
      gun.userData.hold && gun.position.set(0, 0, 0);
      gun.scale.multiplyScalar(1.45 * gun.userData.display);
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
      this.avatar.root.visible = this.mode !== 'shop' && this.mode !== 'crate' && !this.opening;   // stepped aside while a gift is unwrapped
    }
    this.gifts.setVisible(this.giftsShown());
    this.gifts.update(this.time);
    this.opening?.update(dt, this.time);
    this.placeCamera(this.time);                     // drifts (and undoes the crate's landing thump from last frame)
    this.backdrop.update(dt);
    if (this.padLight.visible) this.padLight.intensity = 1.2 + Math.sin(this.time * 1.6) * 0.25;
    if (this.crate) this.crate.update(dt, this.camera);
    if (this.showcase?.visible) {
      this.showcase.rotation.y = this.time * 0.7;
      this.showcase.position.y = 1.2 + Math.sin(this.time * 1.4) * 0.05;
      const charm = this.showcaseGun?.userData.charm;
      if (charm) { charm.push(Math.sin(this.time * 2.1) * 0.1 * dt * 12, Math.cos(this.time * 1.7) * 0.06 * dt * 12); charm.update(dt, this.showcase.position); }
    }
    this.renderer.render(this.scene, this.camera);
  }
}
