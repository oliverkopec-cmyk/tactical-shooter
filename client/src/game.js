// Owns the Three.js scene and the per-frame loop for a running match.

import * as THREE from 'three';
import { MAP } from '../../shared/map.js';
import { buildMap, setupLighting } from './map.js';
import { LocalPlayer } from './player.js';
import { RemotePlayer } from './avatars.js';

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
    this.camera = new THREE.PerspectiveCamera(78, 1, 0.05, 300);
    this.scene.add(this.camera);
    setupLighting(this.scene);
    this.map = buildMap(this.scene);
    this.world = { boxes: MAP.boxes };

    this.local = null;
    this.remotes = new Map();
    this.running = false;
    this.lastFrame = performance.now();

    this.resize();
    window.addEventListener('resize', () => this.resize());
    canvas.addEventListener('click', () => {
      if (this.running && !document.pointerLockElement) this.lockPointer();
    });
    document.addEventListener('pointerlockchange', () => this.ui.setPointerLocked(!!document.pointerLockElement));

    network.on('snapshot', (snap) => this.onSnapshot(snap));
  }

  lockPointer() {
    // Newer browsers return a promise that rejects without a user gesture.
    try { this.canvas.requestPointerLock()?.catch?.(() => {}); } catch { /* ignored */ }
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** Called on 'matchStart' (also for late joiners). */
  start(payload) {
    this.stop();
    const myId = this.network.id;
    const me = payload.players.find((p) => p.id === myId);
    if (!me) return;

    this.myTeam = me.team;
    this.local = new LocalPlayer({
      id: myId, team: me.team, state: me.state, world: this.world,
      network: this.network, camera: this.camera, canvas: this.canvas,
    });
    for (const p of payload.players) if (p.id !== myId) this.addRemote(p);

    this.running = true;
    this.lastFrame = performance.now();
    this.ui.setPointerLocked(!!document.pointerLockElement);
    this.lockPointer();
    requestAnimationFrame((t) => this.frame(t));
  }

  stop() {
    this.running = false;
    this.local?.dispose();
    this.local = null;
    for (const r of this.remotes.values()) r.dispose();
    this.remotes.clear();
    if (document.pointerLockElement) document.exitPointerLock();
  }

  addRemote(p) {
    if (this.remotes.has(p.id)) return this.remotes.get(p.id);
    const r = new RemotePlayer(this.scene, p, p.team === this.myTeam);
    this.remotes.set(p.id, r);
    if (p.state) r.push(Date.now() + (this.network.serverOffset ?? 0), { ...p.state });
    return r;
  }

  /** Keep the avatar list in sync with room membership. */
  syncRoster(players) {
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
      if (p.id === this.network.id) this.local?.reconcile(p);
      else this.remotes.get(p.id)?.push(snap.t, p);
    }
  }

  frame(now) {
    if (!this.running) return;
    const dt = Math.min(0.25, (now - this.lastFrame) / 1000);
    this.lastFrame = now;

    this.local.update(dt);
    const rt = this.network.renderTime();
    for (const r of this.remotes.values()) r.update(rt);

    this.renderer.render(this.scene, this.camera);
    this.ui.updateStats(dt, this.network.ping, this.local);
    requestAnimationFrame((t) => this.frame(t));
  }
}
