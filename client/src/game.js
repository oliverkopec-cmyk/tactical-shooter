// Owns the Three.js scene and the per-frame loop for a running match.

import * as THREE from 'three';
import {
  MAX_HEALTH, MAX_SHOT_RANGE, RESPAWN_MS, CHARGE_REACH, REINFORCE_REACH, TEAM_REINFORCEMENTS,
} from '../../shared/constants.js';
import { getEyePosition } from '../../shared/movement.js';
import { currentSpread, aimDirection } from '../../shared/weapons.js';
import { World } from '../../shared/world.js';
import { raycastWorld, rayPlayer } from '../../shared/raycast.js';
import { buildMap, setupLighting } from './map.js';
import { LocalPlayer } from './player.js';
import { RemotePlayer } from './avatars.js';
import { ViewModel } from './weapons.js';
import { Effects } from './effects.js';
import { Audio } from './audio.js';
import { DestructionView } from './destruction.js';

const FOV = 78;
const TRACER_OFFSET = new THREE.Vector3(0.2, -0.17, -0.9); // muzzle, roughly, in camera space

export class Game {
  constructor(canvas, network, ui) {
    this.canvas = canvas;
    this.network = network;
    this.ui = ui;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(FOV, 1, 0.05, 300);
    this.scene.add(this.camera);
    setupLighting(this.scene);
    this.map = buildMap(this.scene);
    this.world = new World();

    this.viewModel = new ViewModel();
    this.effects = new Effects(this.scene);
    this.audio = new Audio();
    this.destruction = new DestructionView(this.scene, this.world, this.effects, this.audio);
    this.loadout = { charges: 0, placed: false };
    this.reinforcementsLeft = TEAM_REINFORCEMENTS;
    this.reinforcing = null; // { start, ms }

    this.local = null;
    this.remotes = new Map();
    this.members = new Map(); // id -> { name, team }
    this.health = MAX_HEALTH;
    this.running = false;
    this.lockFailed = false;
    this.spectate = { index: 0, target: null, respawnAt: 0, deathPos: null };
    this.lastFrame = performance.now();

    this.resize();
    window.addEventListener('resize', () => this.resize());
    canvas.addEventListener('click', () => {
      if (!this.running) return;
      if (this.local && !this.local.alive) this.cycleSpectate();
      else if (!document.pointerLockElement) this.lockPointer();
    });
    // Ctrl+click is a right-click on macOS; don't let crouch-firing open a menu.
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => this.ui.setPointerLocked(!!document.pointerLockElement));
    document.addEventListener('pointerlockerror', () => { this.lockFailed = true; });

    network.on('snapshot', (snap) => this.onSnapshot(snap));
    network.on('shot', (msg) => this.onRemoteShot(msg));
    network.on('hitConfirm', (msg) => this.onHitConfirm(msg));
    network.on('damaged', (msg) => this.onDamaged(msg));
    network.on('kill', (msg) => this.onKill(msg));
    network.on('respawn', (msg) => this.onRespawn(msg));

    // Destruction
    network.on('panelsDestroyed', ({ ids }) => { if (this.running) this.destruction.destroyPanels(ids); });
    network.on('chargePlaced', (c) => { if (this.running) this.destruction.addCharge(c); });
    network.on('chargeRemoved', ({ id }) => this.destruction.removeCharge(id));
    network.on('chargeExploded', (msg) => {
      if (!this.running) return;
      this.destruction.explode(msg, this.listener());
      const d = Math.hypot(msg.pos[0] - this.camera.position.x, msg.pos[2] - this.camera.position.z);
      this.shake = Math.max(this.shake || 0, Math.max(0, 1 - d / 15) * 0.6);
    });
    network.on('reinforced', ({ section, left }) => {
      if (!this.running) return;
      this.destruction.reinforce(section);
      this.reinforcementsLeft = left;
      if (this.reinforcing?.section === section) this.reinforcing = null;
    });
    network.on('reinforceStart', ({ section, ms }) => { this.reinforcing = { section, start: performance.now(), ms }; });
    network.on('reinforceCancel', ({ reason }) => {
      this.reinforcing = null;
      if (reason) this.ui.toast(reason);
    });
    network.on('loadout', (l) => { this.loadout = l; });
    network.on('actionError', ({ msg }) => this.ui.toast(msg));
  }

  lockPointer() {
    // Newer browsers return a promise that rejects without a user gesture or
    // where pointer lock isn't supported (e.g. some embedded browsers).
    try {
      const p = this.canvas.requestPointerLock();
      p?.catch?.((err) => { if (err?.name !== 'SecurityError') this.lockFailed = true; });
    } catch { this.lockFailed = true; }
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.viewModel?.setAspect(w / h);
  }

  /** Called on 'matchStart' (also for late joiners). */
  start(payload) {
    this.stop();
    const myId = this.network.id;
    const me = payload.players.find((p) => p.id === myId);
    if (!me) return;

    this.myTeam = me.team;
    this.members.clear();
    for (const p of payload.players) this.members.set(p.id, { name: p.name, team: p.team });

    this.local = new LocalPlayer({
      id: myId, team: me.team, state: me.state, weapon: me.weapon, world: this.world,
      network: this.network, camera: this.camera, canvas: this.canvas,
      onShot: (shot) => this.onLocalShot(shot),
      renderTime: () => this.network.renderTime(),
      canFireUnlocked: () => this.lockFailed,
    });
    this.health = me.health ?? MAX_HEALTH;
    this.loadout = { charges: me.charges ?? 0, placed: !!me.placed };
    this.reinforcing = null;

    const d = payload.destruction || {};
    this.world.applySnapshot(d.world);
    this.destruction.syncAll();
    this.destruction.clearCharges();
    for (const c of d.charges || []) this.destruction.addCharge(c);
    this.reinforcementsLeft = d.reinforcementsLeft ?? TEAM_REINFORCEMENTS;
    for (const p of payload.players) if (p.id !== myId) this.addRemote(p);

    this.running = true;
    this.lastFrame = performance.now();
    this.ui.setPointerLocked(!!document.pointerLockElement);
    this.ui.hideDeath();
    this.ui.clearKillfeed();
    this.lockPointer();
    requestAnimationFrame((t) => this.frame(t));
  }

  stop() {
    this.running = false;
    this.local?.dispose();
    this.local = null;
    for (const r of this.remotes.values()) r.dispose();
    this.remotes.clear();
    this.effects.clearDecals();
    if (document.pointerLockElement) document.exitPointerLock();
  }

  addRemote(p) {
    if (this.remotes.has(p.id)) return this.remotes.get(p.id);
    const r = new RemotePlayer(this.scene, p, p.team === this.myTeam);
    this.remotes.set(p.id, r);
    if (p.weapon) r.setWeapon(p.weapon.id);
    if (p.state) r.push(Date.now() + (this.network.serverOffset ?? 0), { ...p.state, alive: p.alive !== false });
    return r;
  }

  /** Keep the avatar list in sync with room membership. */
  syncRoster(players) {
    for (const p of players) this.members.set(p.id, { name: p.name, team: p.team });
    if (!this.running) return;
    const ids = new Set(players.map((p) => p.id));
    for (const [id, r] of this.remotes) {
      if (!ids.has(id)) { r.dispose(); this.remotes.delete(id); }
    }
    for (const p of players) if (p.id !== this.network.id && !this.remotes.has(p.id)) this.addRemote(p);
  }

  onSnapshot(snap) {
    if (!this.running) return;
    for (const p of snap.players) {
      if (p.id === this.network.id) {
        this.local?.reconcile(p);
        if (typeof p.hp === 'number' && this.local?.alive) this.health = p.hp;
      } else {
        this.remotes.get(p.id)?.push(snap.t, p);
      }
    }
  }

  // ---------------------------------------------------------------- combat events

  /** Our own predicted shot: draw it immediately. The server decides what it hit. */
  onLocalShot({ origin, dirs, weaponId }) {
    const muzzle = TRACER_OFFSET.clone().applyMatrix4(this.camera.matrixWorld);
    for (const d of dirs) {
      const wall = raycastWorld(this.world, origin, d, MAX_SHOT_RANGE);
      let maxT = wall ? wall.t : MAX_SHOT_RANGE;
      let hitPlayer = false;
      for (const r of this.remotes.values()) {
        if (!r.alive || r.team === this.myTeam) continue;
        const h = rayPlayer(origin, d, r.pose, maxT);
        if (h) { maxT = h.t; hitPlayer = true; }
      }
      const end = [origin[0] + d[0] * maxT, origin[1] + d[1] * maxT, origin[2] + d[2] * maxT];
      this.effects.tracer([muzzle.x, muzzle.y, muzzle.z], end);
      if (hitPlayer) this.effects.blood(end);
      else if (wall) this.effects.bulletHole(wall.point, wall.normal, wall.box.kind === 'panel' ? wall.box.id : null);
    }
    this.viewModel.fire(weaponId);
    this.audio.shot(weaponId, null, null);
  }

  onRemoteShot({ id, w, ends }) {
    const r = this.remotes.get(id);
    if (!r) return;
    r.showFlash();
    const from = r.muzzlePosition();
    for (const end of ends) {
      this.effects.tracer(from, end);
      const d = [end[0] - from[0], end[1] - from[1], end[2] - from[2]];
      const len = Math.hypot(d[0], d[1], d[2]);
      if (len < 0.01) continue;
      const dir = [d[0] / len, d[1] / len, d[2] / len];
      const wall = raycastWorld(this.world, from, dir, len + 0.1);
      if (wall && wall.t > len - 0.2) this.effects.bulletHole(wall.point, wall.normal, wall.box.kind === 'panel' ? wall.box.id : null);
    }
    this.audio.shot(w, from, this.listener());
  }

  onHitConfirm({ head, killed }) {
    this.ui.showHitmarker(head, killed);
    this.audio.hit(head);
  }

  onDamaged({ health, from }) {
    this.health = health;
    this.audio.hurt();
    if (!this.local) return;
    const s = this.local.state;
    const dx = from[0] - s.x, dz = from[1] - s.z;
    const yaw = this.local.aimYaw;
    const fwd = dx * -Math.sin(yaw) + dz * -Math.cos(yaw);
    const right = dx * Math.cos(yaw) + dz * -Math.sin(yaw);
    this.ui.showDamage(Math.atan2(right, fwd));
  }

  onKill({ killer, victim, weapon, head }) {
    const myId = this.network.id;
    const name = (id) => this.members.get(id) || { name: '?', team: 'attack' };
    this.ui.addKill({ killer: name(killer), victim: name(victim), weapon, head, mine: killer === myId || victim === myId });
    if (killer === myId) this.audio.kill();
    const victimAvatar = this.remotes.get(victim);
    if (victimAvatar) victimAvatar.alive = false; // hide now rather than at the next snapshot
    if (victim === myId && this.local) {
      this.local.die();
      this.reinforcing = null;
      this.health = 0;
      const s = this.local.state;
      this.spectate = { index: 0, target: null, respawnAt: performance.now() + RESPAWN_MS, deathPos: { x: s.x, y: s.y, z: s.z, yaw: this.local.aimYaw } };
      this.ui.showDeath(`Eliminated by ${name(killer).name}`, '');
      this.cycleSpectate(true);
    }
  }

  onRespawn({ state, weapon, health }) {
    if (!this.local) return;
    this.local.respawn(state, weapon);
    this.health = health;
    if (this.spectate.target) this.spectate.target.hiddenForSpectate = false;
    this.spectate.target = null;
    this.ui.hideDeath();
  }

  // ---------------------------------------------------------------- spectating

  spectateCandidates() {
    return [...this.remotes.values()].filter((r) => r.alive && r.team === this.myTeam);
  }

  cycleSpectate(reset = false) {
    const list = this.spectateCandidates();
    if (this.spectate.target) this.spectate.target.hiddenForSpectate = false;
    if (!list.length) { this.spectate.target = null; return; }
    this.spectate.index = reset ? 0 : (this.spectate.index + 1) % list.length;
    this.spectate.target = list[this.spectate.index];
    this.spectate.target.hiddenForSpectate = true;
  }

  updateSpectateCamera(now) {
    let target = this.spectate.target;
    if (target && !target.alive) { this.cycleSpectate(true); target = this.spectate.target; }
    const secs = Math.max(0, Math.ceil((this.spectate.respawnAt - now) / 1000));
    const respawnText = `Respawning in ${secs}s`;

    if (target) {
      const eye = getEyePosition(target.pose, this.world);
      this.camera.position.set(eye.x, eye.y, eye.z);
      this.camera.rotation.set(target.pose.pitch, target.pose.yaw, 0, 'YXZ');
      this.ui.setDeathSub(`Spectating ${target.name} · click to switch · ${respawnText}`);
    } else {
      // Nobody to watch: look down at where we fell.
      const d = this.spectate.deathPos;
      if (d) {
        this.camera.position.set(d.x + Math.sin(d.yaw) * 3, d.y + 3.5, d.z + Math.cos(d.yaw) * 3);
        this.camera.lookAt(d.x, d.y + 0.5, d.z);
      }
      this.ui.setDeathSub(`No teammates alive to spectate · ${respawnText}`);
    }
  }

  /** Gadget counters, the "press G / V" prompt for the wall you're aiming at, and progress. */
  updateGadgetHud(now) {
    const local = this.local;
    const attack = this.myTeam === 'attack';
    let prompt = '';
    if (local.alive) {
      const eye = getEyePosition(local.state, this.world);
      const reach = attack ? CHARGE_REACH : REINFORCE_REACH;
      const hit = raycastWorld(this.world, [eye.x, eye.y, eye.z], aimDirection(local.aimYaw, local.aimPitch), reach);
      const panel = hit?.box.kind === 'panel' ? hit.box : null;
      if (attack && !this.loadout.placed && panel) {
        if (this.world.isReinforcedPanel(panel.id)) prompt = 'Reinforced wall: breach charges won\'t break it';
        else if (this.loadout.charges > 0) prompt = 'Press G to plant a breach charge';
      } else if (!attack && panel && !this.reinforcing) {
        const section = this.world.sections[panel.sectionId];
        if (this.world.reinforced[section.id]) prompt = 'Reinforced';
        else if (section.reinforceable && this.reinforcementsLeft > 0) prompt = 'Press V to reinforce this wall';
      }
    }
    this.ui.setPrompt(prompt);

    let progress = null;
    if (this.reinforcing) progress = Math.min(1, (now - this.reinforcing.start) / this.reinforcing.ms);
    this.ui.setProgress(progress, 'Reinforcing…');

    this.ui.updateGadgets(attack
      ? { label: 'Breach charge', key: 'G', value: this.loadout.placed ? 'Planted: press G to detonate' : `×${this.loadout.charges}` }
      : { label: 'Team reinforcements', key: 'V', value: `${this.reinforcementsLeft} left` }, local.alive);
  }

  listener() {
    return { x: this.camera.position.x, z: this.camera.position.z, yaw: this.local?.aimYaw ?? 0 };
  }

  // ---------------------------------------------------------------- frame loop

  frame(now) {
    if (!this.running) return;
    const dt = Math.min(0.25, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    const local = this.local;

    local.update(dt);
    const rt = this.network.renderTime();
    for (const r of this.remotes.values()) r.update(rt, dt);
    if (!local.alive) this.updateSpectateCamera(now);

    // View model and HUD
    const s = local.state;
    this.viewModel.visible = local.alive;
    this.viewModel.setWeapon(local.weapon.id);
    const w = local.weaponDef;
    this.viewModel.update(dt, {
      speed: Math.hypot(s.vx, s.vz),
      sprinting: local.sprinting,
      crouch: s.crouch,
      lean: s.lean,
      reloadFrac: local.weapon.reload > 0 ? 1 - local.weapon.reload / w.reloadTime : -1,
    });
    if (local.weapon.reload > 0 && !this.wasReloading) this.audio.reload();
    this.wasReloading = local.weapon.reload > 0;

    const spread = currentSpread(local.weapon, s);
    const halfFov = THREE.MathUtils.degToRad(FOV / 2);
    this.ui.setCrosshairGap(3 + (Math.tan(spread) / Math.tan(halfFov)) * (window.innerHeight / 2));
    this.ui.updateCombat({ health: this.health, weapon: local.weapon, alive: local.alive });

    this.updateGadgetHud(now);
    this.destruction.update(dt);
    this.effects.update(dt);

    // Explosion camera shake
    if (this.shake > 0.001 && local.alive) {
      this.camera.rotation.x += (Math.random() - 0.5) * this.shake * 0.08;
      this.camera.rotation.y += (Math.random() - 0.5) * this.shake * 0.08;
      this.shake *= Math.exp(-6 * dt);
    }
    this.renderer.render(this.scene, this.camera);
    this.viewModel.render(this.renderer);
    this.ui.updateStats(dt, this.network.ping, local);
    requestAnimationFrame((t) => this.frame(t));
  }
}
