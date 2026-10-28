// Other players: simple blocky bodies, interpolated between server snapshots.

import * as THREE from 'three';
import { TEAM_COLORS, LEAN_OFFSET, STAND_EYE } from '../../shared/constants.js';
import { bodyHeight } from '../../shared/movement.js';

const LEAN_ANGLE = Math.atan2(LEAN_OFFSET, STAND_EYE);
const BUFFER_MS = 1000;

function lerpAngle(a, b, t) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

function makeLabel(text, color) {
  const canvas = document.createElement('canvas');
  canvas.width = 256; canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.font = 'bold 30px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 6;
  ctx.strokeStyle = 'rgba(0,0,0,0.7)';
  ctx.strokeText(text, 128, 32);
  ctx.fillStyle = `#${color.toString(16).padStart(6, '0')}`;
  ctx.fillText(text, 128, 32);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: true, transparent: true }));
  sprite.scale.set(1.4, 0.35, 1);
  return sprite;
}

export class RemotePlayer {
  constructor(scene, { id, name, team }, isTeammate) {
    this.id = id;
    this.name = name;
    this.team = team;
    this.buffer = []; // [{ t, s }]
    this.scene = scene;

    const color = TEAM_COLORS[team] ?? 0xffffff;
    const bodyMat = new THREE.MeshStandardMaterial({ color, roughness: 0.7 });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x1d2228, roughness: 0.5 });

    this.root = new THREE.Group();        // at the feet, rotated by yaw
    this.lean = new THREE.Group();        // tilts around the feet
    this.root.add(this.lean);

    this.torso = new THREE.Mesh(new THREE.BoxGeometry(0.62, 1, 0.38), bodyMat);
    this.torso.castShadow = true;
    this.lean.add(this.torso);

    this.head = new THREE.Group();
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.17, 16, 12), bodyMat);
    skull.castShadow = true;
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.08, 0.06), darkMat);
    visor.position.set(0, 0.02, -0.16);
    this.head.add(skull, visor);
    this.lean.add(this.head);

    this.label = makeLabel(name, color);
    if (isTeammate) {
      // Teammate names show through walls; enemy names only in line of sight.
      this.label.material.depthTest = false;
      this.label.renderOrder = 10;
    }
    this.lean.add(this.label);

    scene.add(this.root);
  }

  push(t, s) {
    this.buffer.push({ t, s });
    const cutoff = t - BUFFER_MS;
    while (this.buffer.length > 2 && this.buffer[0].t < cutoff) this.buffer.shift();
  }

  /** Place the avatar at renderTime by interpolating the two surrounding snapshots. */
  update(renderTime) {
    const buf = this.buffer;
    if (!buf.length) return;
    let a = buf[0], b = buf[0];
    if (renderTime >= buf[buf.length - 1].t) {
      a = b = buf[buf.length - 1];
    } else {
      for (let i = buf.length - 1; i >= 0; i--) {
        if (buf[i].t <= renderTime) { a = buf[i]; b = buf[i + 1] || buf[i]; break; }
      }
    }
    const span = b.t - a.t;
    const t = span > 0 ? Math.min(1, Math.max(0, (renderTime - a.t) / span)) : 0;
    const L = (k) => a.s[k] + (b.s[k] - a.s[k]) * t;

    const crouch = L('crouch');
    const h = bodyHeight(crouch);
    this.root.position.set(L('x'), L('y'), L('z'));
    this.root.rotation.y = lerpAngle(a.s.yaw, b.s.yaw, t);
    this.lean.rotation.z = -L('lean') * LEAN_ANGLE;

    const torsoH = h - 0.36;
    this.torso.scale.y = torsoH;
    this.torso.position.y = torsoH / 2;
    this.head.position.y = h - 0.18;
    this.head.rotation.x = lerpAngle(a.s.pitch, b.s.pitch, t);
    this.label.position.y = h + 0.35;
  }

  dispose() {
    this.scene.remove(this.root);
    this.root.traverse((o) => {
      o.geometry?.dispose();
      if (o.material) { o.material.map?.dispose(); o.material.dispose(); }
    });
  }
}
