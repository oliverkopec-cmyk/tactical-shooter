// The gun workshop (Stage P), opened by clicking a gun in the Operators tab: the gun large in 3D, which you drag to
// turn and scroll to zoom, and its slots: sight, muzzle, grip, magazine, skin and charm. Every change shows on the gun
// at once and is saved to the account. The stat bars compare before and after: hovering an option compares it with
// what is fitted; otherwise they compare the gun as it comes with the gun as you've set it up.
// It has its own small renderer, made the first time it opens, which draws nothing while the screen is closed.

import * as THREE from 'three';
import { WEAPONS } from '../../shared/weapons.js';
import { ATTACHMENTS, SLOTS, SLOT_NAMES, optionsFor, cleanAttachments, attachmentKey } from '../../shared/attachments.js';
import { gunStatRows } from '../../shared/gunStats.js';
import { makeGunModel, sightOf, stockSight } from './gunModels.js';
import { attachCharm } from './charmModels.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export class GunWorkshop {
  /**
   * hooks: { getAccount(), equipAttachment(gun, slot, value), equipSkin(gun, id), equipCharm(gun, id), skinTiles(gun),
   *          charmTiles(gun), goToShop(), onClose() }. The three equip hooks save, and return when the account is updated.
   */
  constructor(hooks) {
    this.hooks = hooks;
    this.el = $('workshop');
    this.canvas = $('ws-canvas');
    this.open_ = false;
    this.tab = 'sight';
    this.hover = null;
    this.yaw = 0; this.pitch = 0.1; this.zoom = 1; this.touched = false;
    this.bindControls();
    $('ws-close').addEventListener('click', () => this.close());
    this.el.addEventListener('click', (e) => this.onClick(e));
    this.el.addEventListener('mouseover', (e) => this.onHover(e));
    $('ws-options').addEventListener('mouseleave', () => this.setHover(null));
    window.addEventListener('keydown', (e) => { if (this.open_ && e.key === 'Escape') this.close(); });
  }

  get isOpen() { return this.open_; }

  bindControls() {
    const c = this.canvas;
    c.addEventListener('pointerdown', (e) => { this.dragging = true; this.last = [e.clientX, e.clientY]; this.touched = true; c.setPointerCapture?.(e.pointerId); });
    c.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      const dx = e.clientX - this.last[0], dy = e.clientY - this.last[1];
      this.last = [e.clientX, e.clientY];
      this.yaw += dx * 0.009;
      this.pitch = Math.max(-1.3, Math.min(1.3, this.pitch + dy * 0.007));
      this.gun?.userData.charm?.push(dx * 0.02, dy * 0.02);
    });
    const up = () => { this.dragging = false; };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.zoom = Math.max(0.55, Math.min(3, this.zoom * Math.exp(-e.deltaY * 0.0012)));
    }, { passive: false });
  }

  // ---------------------------------------------------------------- opening and closing

  open(gunId, tab = null) {
    this.gunId = gunId;
    this.w = WEAPONS[gunId];
    this.opts = optionsFor(this.w);
    const first = SLOTS.find((s) => this.opts[s].length);
    this.tab = tab || first || 'skin';
    this.hover = null;
    this.yaw = -Math.PI / 2 + 0.45; this.pitch = 0.12; this.zoom = 1; this.touched = false; this.time = 0;
    this.open_ = true;
    this.el.classList.remove('hidden');
    this.buildScene();
    this.modelKey = null;
    this.refresh();
    this.last_ = performance.now();
    const loop = (t) => {
      if (!this.open_) return;
      this.frame(t);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  close() {
    if (!this.open_) return;
    this.open_ = false;
    this.el.classList.add('hidden');
    this.pivot.clear();
    this.gun = null;
    this.hooks.onClose?.();
  }

  buildScene() {
    if (this.scene) return;
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.scene = new THREE.Scene();
    this.scene.add(new THREE.HemisphereLight(0xe8eeff, 0x20242c, 1.5));
    const key = new THREE.DirectionalLight(0xfff1dc, 2.8);
    key.position.set(2, 3, 3);
    const rim = new THREE.DirectionalLight(0xbfd8ff, 2);
    rim.position.set(-3, 1.5, -3);
    const under = new THREE.DirectionalLight(0xffc890, 0.6);
    under.position.set(0, -2, 1);
    this.scene.add(key, rim, under);
    this.camera = new THREE.PerspectiveCamera(24, 1, 0.05, 30);
    this.pivot = new THREE.Group();
    this.scene.add(this.pivot);
  }

  // ---------------------------------------------------------------- what is fitted

  /** What is fitted now, as the account has it. */
  att() { return this.hooks.getAccount()?.equippedAttachments?.[this.gunId] || null; }

  /** The gun on the stand, rebuilt whenever something on it changes. */
  rebuildGun() {
    const a = this.hooks.getAccount();
    const skin = a?.equippedSkins?.[this.gunId] || null, charm = a?.equippedCharms?.[this.gunId] || null, att = this.att();
    const key = `${skin}|${charm}|${attachmentKey(att)}`;
    if (key === this.modelKey) return;
    this.modelKey = key;
    this.pivot.clear();
    const gun = makeGunModel(this.gunId, skin, att);
    attachCharm(gun, charm);
    gun.scale.multiplyScalar(this.w.shield ? 0.42 : 1);
    this.gun = gun;
    // Keep the gun itself centred on the middle of the stand, so what you fit doesn't make it jump about
    const box = new THREE.Box3().setFromObject(gun);
    const c = box.getCenter(new THREE.Vector3());
    gun.position.sub(c);
    this.size = Math.max(box.getSize(new THREE.Vector3()).length(), 0.3);
    this.pivot.add(gun);
  }

  refresh() {
    if (!this.open_) return;
    this.rebuildGun();
    $('ws-title').textContent = this.w.name;
    $('ws-kind').textContent = this.w.kind;
    this.renderTabs();
    this.renderOptions();
    this.renderStats();
  }

  // ---------------------------------------------------------------- the slots

  renderTabs() {
    const tabs = [...SLOTS.filter((s) => this.opts[s].length).map((s) => [s, SLOT_NAMES[s]]), ['skin', 'Skin'], ['charm', 'Charm']];
    $('ws-tabs').innerHTML = tabs.map(([id, name]) => `<button type="button" class="ws-tab${this.tab === id ? ' active' : ''}" data-ws-tab="${id}"><b>${esc(name)}</b><i>${esc(this.fittedName(id))}</i></button>`).join('');
  }

  fittedName(slot) {
    const a = this.hooks.getAccount();
    if (slot === 'skin') return this.hooks.skinName(a?.equippedSkins?.[this.gunId]);
    if (slot === 'charm') return this.hooks.charmName(a?.equippedCharms?.[this.gunId]);
    const att = this.att();
    if (slot === 'sight') return ATTACHMENTS.sight[att?.sight || stockSight(this.gunId)].name;
    const id = att?.[slot] || Object.keys(ATTACHMENTS[slot])[0];
    return ATTACHMENTS[slot][id].name;
  }

  renderOptions() {
    const el = $('ws-options');
    if (this.tab === 'skin') { el.innerHTML = `<div class="skin-grid">${this.hooks.skinTiles(this.gunId)}</div>`; return; }
    if (this.tab === 'charm') { el.innerHTML = `<div class="skin-grid charm-grid">${this.hooks.charmTiles(this.gunId)}</div>`; return; }
    const slot = this.tab, att = this.att();
    const stock = slot === 'sight' ? stockSight(this.gunId) : Object.keys(ATTACHMENTS[slot])[0];
    const current = att?.[slot] || stock;
    el.innerHTML = this.opts[slot].map((id) => {
      const o = ATTACHMENTS[slot][id];
      const zoom = slot === 'sight' ? `<span class="ws-zoom">${o.zoom}x</span>` : '';
      return `<button type="button" class="ws-option${id === current ? ' equipped' : ''}" data-ws-slot="${slot}" data-ws-id="${id}">
        <span class="ws-option-name"><b>${esc(o.name)}</b>${zoom}${id === stock && slot === 'sight' ? '<em>comes with the gun</em>' : ''}${id === current ? '<u>Fitted</u>' : ''}</span>
        <span class="ws-option-desc">${esc(o.desc)}</span></button>`;
    }).join('');
  }

  // ---------------------------------------------------------------- the stat bars

  /** The attachments with this option swapped in. */
  withOption(slot, id) {
    return cleanAttachments(this.w, { ...this.att(), [slot]: id });
  }

  renderStats() {
    const el = $('ws-stats');
    if (this.w.shield) { el.innerHTML = '<p class="muted">A shield has no attachments: it only takes a skin and a charm.</p>'; return; }
    const id = this.gunId;
    const after = this.hover ? this.withOption(this.hover.slot, this.hover.id) : this.att();
    const before = this.hover ? this.att() : null;
    const rowsB = gunStatRows(id, before, sightOf(id, before));
    const rowsA = gunStatRows(id, after, sightOf(id, after));
    $('ws-stats-title').textContent = this.hover ? `With ${ATTACHMENTS[this.hover.slot][this.hover.id].name}` : 'Compared with the gun as it comes';
    el.innerHTML = rowsA.map((r, i) => {
      const b = rowsB[i], lo = Math.min(b.frac, r.frac), hi = Math.max(b.frac, r.frac);
      const changed = b.text !== r.text;
      const better = r.frac > b.frac + 1e-6;
      return `<div class="ws-stat${changed ? (better ? ' better' : ' worse') : ''}">
        <div class="ws-stat-head"><span>${esc(r.label)}</span><b>${changed ? `<s>${esc(b.text)}</s> ` : ''}${esc(r.text)}</b></div>
        <div class="ws-bar"><i style="width:${(lo * 100).toFixed(1)}%"></i>${changed ? `<em style="left:${(lo * 100).toFixed(1)}%;width:${((hi - lo) * 100).toFixed(1)}%"></em>` : ''}</div>
      </div>`;
    }).join('');
  }

  setHover(h) {
    const same = (!h && !this.hover) || (h && this.hover && h.slot === this.hover.slot && h.id === this.hover.id);
    if (same) return;
    this.hover = h;
    this.renderStats();
  }

  onHover(e) {
    const opt = e.target.closest?.('[data-ws-id]');
    if (opt) this.setHover({ slot: opt.dataset.wsSlot, id: opt.dataset.wsId });
  }

  // ---------------------------------------------------------------- choosing

  async onClick(e) {
    const tab = e.target.closest('[data-ws-tab]');
    if (tab) { this.tab = tab.dataset.wsTab; this.hover = null; this.renderTabs(); this.renderOptions(); this.renderStats(); return; }
    const opt = e.target.closest('[data-ws-id]');
    if (opt) {
      const slot = opt.dataset.wsSlot, id = opt.dataset.wsId;
      const stock = slot === 'sight' ? stockSight(this.gunId) : Object.keys(ATTACHMENTS[slot])[0];
      this.hover = null;
      await this.hooks.equipAttachment(this.gunId, slot, id === stock ? null : id);
      this.refresh();
      return;
    }
    const skin = e.target.closest('[data-skin]'), charm = e.target.closest('[data-charm]');
    if ((skin || charm)?.classList.contains('locked')) { this.close(); this.hooks.goToShop(); return; }
    if (skin) { await this.hooks.equipSkin(this.gunId, skin.dataset.skin || null); this.refresh(); return; }
    if (charm) { await this.hooks.equipCharm(this.gunId, charm.dataset.charm || null); this.refresh(); }
  }

  // ---------------------------------------------------------------- each frame

  frame(t) {
    const dt = Math.min(0.05, (t - this.last_) / 1000);
    this.last_ = t;
    this.time += dt;
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (!w || !h || !this.renderer) return;
    if (this.canvas.width !== Math.round(w * this.renderer.getPixelRatio()) || this.canvas.height !== Math.round(h * this.renderer.getPixelRatio())) {
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }
    // Until you touch it, it turns a little by itself to show it is 3D
    const sway = this.touched ? 0 : Math.sin(this.time * 0.5) * 0.28;
    this.pivot.rotation.set(this.pitch, this.yaw + sway, 0, 'XYZ');
    const fit = Math.max((this.size || 1) * 1.1 / (2 * Math.tan((this.camera.fov * Math.PI) / 360)) / Math.min(1.1, this.camera.aspect * 0.58), 0.4);
    this.camera.position.set(0, 0, fit / this.zoom);
    this.camera.lookAt(0, 0, 0);
    this.gun?.userData.charm?.update(dt, { x: 0, y: 0, z: 0 });
    this.renderer.render(this.scene, this.camera);
  }
}
