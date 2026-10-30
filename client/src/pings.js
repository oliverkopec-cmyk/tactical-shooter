// Team pings: markers in the world (seen through walls, for your team only, for a few seconds) and
// the ping wheel. Tap the ping key to ping what you aim at; hold it to open the wheel and move the
// mouse towards a choice, then let go.

import * as THREE from 'three';
import { PING_TYPES } from '../../shared/voiceLines.js';

export const WHEEL = ['enemy', 'go', 'danger', 'help', 'defend'];   // clockwise from the top

function makeTag(text, color) {
  const canvas = document.createElement('canvas');
  canvas.width = 256; canvas.height = 96;
  const ctx = canvas.getContext('2d');
  // a diamond icon over the label
  ctx.fillStyle = color;
  ctx.strokeStyle = 'rgba(0,0,0,0.8)';
  ctx.lineWidth = 4;
  ctx.beginPath(); ctx.moveTo(128, 6); ctx.lineTo(146, 26); ctx.lineTo(128, 46); ctx.lineTo(110, 26); ctx.closePath();
  ctx.fill(); ctx.stroke();
  ctx.font = 'bold 26px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.lineWidth = 6;
  ctx.strokeText(text, 128, 80);
  ctx.fillStyle = '#fff';
  ctx.fillText(text, 128, 80);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, depthWrite: false, transparent: true, sizeAttenuation: false }));
  sprite.scale.set(0.16, 0.06, 1);
  sprite.renderOrder = 25;
  return sprite;
}

export class PingView {
  constructor(scene) {
    this.scene = scene;
    this.pings = new Map();   // id -> { sprite, until, from }
  }

  /** p: { id, from, by, type, text, pos, ms } from the server. */
  add(p) {
    // A player has at most two pings showing: the oldest of theirs goes
    const mine = [...this.pings.entries()].filter(([, q]) => q.from === p.from);
    if (mine.length >= 2) this.remove(mine[0][0]);
    const color = PING_TYPES[p.type]?.color || '#ffd23c';
    const sprite = makeTag(`${p.text} · ${p.by}`, color);
    sprite.position.set(...p.pos);
    this.scene.add(sprite);
    this.pings.set(p.id, { sprite, until: performance.now() + p.ms, from: p.from, ms: p.ms });
  }

  remove(id) {
    const q = this.pings.get(id);
    if (!q) return;
    this.scene.remove(q.sprite);
    q.sprite.material.map.dispose();
    q.sprite.material.dispose();
    this.pings.delete(id);
  }

  update() {
    const now = performance.now();
    for (const [id, q] of this.pings) {
      const left = q.until - now;
      if (left <= 0) { this.remove(id); continue; }
      q.sprite.material.opacity = Math.min(1, left / 600);     // fades out at the end
    }
  }

  clear() { for (const id of [...this.pings.keys()]) this.remove(id); }
}
