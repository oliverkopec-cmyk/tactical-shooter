// The shop's 3D item cards (Stage 2K): every card shows its gun, in its skin, slowly turning. One small WebGL
// renderer draws all of them (into an offscreen canvas, copied into each card's own 2D canvas), about 30 times a
// second, only while the shop is showing. A pack card cycles through its guns.

import * as THREE from 'three';
import { makeGunModel } from './weapons.js';

const W = 480, H = 300;      // the render size; cards are drawn from it at their own size (all 16:10)
const FRAME_MS = 33;

/** A stylised crate for the crate card: a dark box with glowing trim. */
export function makeCrateModel(christmas = false) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.42, 0.42), new THREE.MeshStandardMaterial({ color: christmas ? 0x8a141c : 0x1c2026, roughness: 0.5, metalness: christmas ? 0.25 : 0.6 }));
  g.add(body);
  const trim = new THREE.MeshStandardMaterial({ color: 0xf0b43c, emissive: 0xf0b43c, emissiveIntensity: 0.7, metalness: 0.9, roughness: 0.3 });
  for (const y of [-0.21, 0.21]) for (const z of [-0.21, 0.21]) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.64, 0.03, 0.03), trim); b.position.set(0, y, z); g.add(b); }
  for (const x of [-0.31, 0.31]) for (const z of [-0.21, 0.21]) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.44, 0.03), trim); b.position.set(x, 0, z); g.add(b); }
  const lid = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.05, 0.44), trim);
  lid.position.y = 0.22;
  g.add(lid);
  const mark = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.018, 8, 20, Math.PI * 1.4), trim);
  mark.position.set(0, 0.04, 0.222); mark.rotation.z = -0.6;
  const dot = new THREE.Mesh(new THREE.SphereGeometry(0.02, 8, 6), trim);
  dot.position.set(0, -0.09, 0.222);
  g.add(mark, dot);
  if (christmas) {
    // A green ribbon round the box, with a bow
    const ribbon = new THREE.MeshStandardMaterial({ color: 0x1f7a44, roughness: 0.4, metalness: 0.2 });
    for (const size of [[0.1, 0.432, 0.432], [0.632, 0.432, 0.09]]) g.add(new THREE.Mesh(new THREE.BoxGeometry(...size), ribbon));
    mark.position.x = dot.position.x = 0.2;
    for (const side of [-1, 1]) { const loop = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.018, 8, 16), ribbon); loop.position.set(side * 0.06, 0.28, 0); loop.rotation.set(0, Math.PI / 2, side * 0.5); g.add(loop); }
    lid.visible = false;
  }
  g.userData.isCrate = true;
  return g;
}

/** Centre a model on its pivot and scale it to fit the view. */
function fit(model) {
  const pivot = new THREE.Group();
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3()), centre = box.getCenter(new THREE.Vector3());
  model.position.sub(centre);
  pivot.add(model);
  const s = 1.1 / Math.max(size.x, size.y * 1.6, size.z, 0.2);
  pivot.scale.setScalar(s);
  return pivot;
}

export class ShopCards {
  constructor() {
    this.cards = [];         // { canvas, ctx, guns, skin, crate, pivots, at, offset, hover }
    this.active = false;
    this.renderer = null;
  }

  ensure() {
    if (this.renderer) return true;
    try {
      this.offscreen = document.createElement('canvas');
      this.offscreen.width = W; this.offscreen.height = H;
      this.renderer = new THREE.WebGLRenderer({ canvas: this.offscreen, antialias: true, alpha: true, preserveDrawingBuffer: true });
      this.renderer.setSize(W, H, false);
      this.renderer.setClearColor(0x000000, 0);
    } catch { this.renderer = null; return false; }
    this.scene = new THREE.Scene();
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x2a3440, 1.5));
    const key = new THREE.DirectionalLight(0xffffff, 2.4);
    key.position.set(1.5, 2, 2.5);
    const rim = new THREE.DirectionalLight(0x9fc8ff, 1.4);
    rim.position.set(-2, 1, -2);
    this.scene.add(key, rim);
    this.camera = new THREE.PerspectiveCamera(28, W / H, 0.1, 20);
    this.camera.position.set(0, 0.32, 2.15);
    this.camera.lookAt(0, 0, 0);
    return true;
  }

  /** Cards to draw: [{ canvas, guns: [gun ids] or [], skin, crate: bool }]. Old models are thrown away. */
  setCards(list) {
    this.clear();
    if (!this.ensure()) return;
    this.cards = list.map((c, i) => {
      const pivots = c.crate ? [fit(makeCrateModel(c.crate === 'christmas'))] : c.guns.map((g) => fit(makeGunModel(g, c.skin)));
      if (c.crate) pivots[0].scale.multiplyScalar(0.62);   // a box fills more of the view than a gun of the same length
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      c.canvas.width = Math.round((c.canvas.clientWidth || W) * dpr);
      c.canvas.height = Math.round((c.canvas.clientHeight || H) * dpr);
      return { ...c, ctx: c.canvas.getContext('2d'), pivots, at: 0, offset: i * 1.3, hover: false };
    });
    for (const c of list) {
      const card = c.canvas.closest('[data-card]');
      card?.addEventListener('mouseenter', () => { const k = this.cards.find((x) => x.canvas === c.canvas); if (k) k.hover = true; });
      card?.addEventListener('mouseleave', () => { const k = this.cards.find((x) => x.canvas === c.canvas); if (k) k.hover = false; });
    }
    this.drawAll(performance.now());
  }

  clear() {
    for (const c of this.cards) for (const p of c.pivots) p.traverse((o) => { if (o.isMesh) o.geometry.dispose(); });
    this.cards = [];
  }

  setActive(on) {
    this.active = on;
    if (on && !this.raf) this.loop();
  }

  loop() {
    this.raf = requestAnimationFrame((t) => {
      this.raf = null;
      if (!this.active) return;
      if (t - (this.last || 0) >= FRAME_MS) { this.last = t; this.drawAll(t); }
      this.loop();
    });
  }

  drawAll(t) {
    if (!this.renderer) return;
    const dt = Math.min(0.1, (t - (this.prev || t)) / 1000);
    this.prev = t;
    for (const c of this.cards) {
      if (!c.canvas.isConnected) continue;
      c.at += dt * (c.hover ? 1.6 : 0.55);
      // A pack shows each of its guns in turn
      const i = c.pivots.length > 1 ? Math.floor((t / 2600 + c.offset) % c.pivots.length) : 0;
      const p = c.pivots[i];
      p.rotation.set(0.12, c.at + c.offset, 0);
      this.scene.add(p);
      this.renderer.render(this.scene, this.camera);
      this.scene.remove(p);
      // Fill the card, keeping the shape (a wide banner crops a little off the top and bottom)
      const cw = c.canvas.width, ch = c.canvas.height, k = Math.max(cw / W, ch / H), dw = W * k, dh = H * k;
      c.ctx.clearRect(0, 0, cw, ch);
      c.ctx.drawImage(this.offscreen, (cw - dw) / 2, (ch - dh) / 2, dw, dh);
    }
  }
}
