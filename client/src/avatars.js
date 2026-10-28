// Other players: simple blocky bodies, interpolated between server snapshots.

import * as THREE from 'three';
import { TEAM_COLORS, LEAN_OFFSET, STAND_EYE } from '../../shared/constants.js';
import { bodyHeight } from '../../shared/movement.js';
import { makeGunModel } from './weapons.js';
import { OPERATORS } from '../../shared/operators.js';

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

/** A red downward-pointing arrow that is always visible, even through walls. */
function makeMarker() {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.beginPath();
  ctx.moveTo(8, 12); ctx.lineTo(56, 12); ctx.lineTo(32, 56); ctx.closePath();
  ctx.fillStyle = '#ff2a2a';
  ctx.fill();
  ctx.lineWidth = 5;
  ctx.strokeStyle = 'rgba(0,0,0,0.75)';
  ctx.stroke();
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, depthWrite: false, transparent: true, sizeAttenuation: false }));
  sprite.scale.set(0.045, 0.045, 1);   // screen-relative: stays readable at any distance
  sprite.renderOrder = 20;
  return sprite;
}

export class RemotePlayer {
  constructor(scene, { id, name, team }, isTeammate) {
    this.id = id;
    this.name = name;
    this.team = team;
    this.buffer = []; // [{ t, s }]
    this.scene = scene;
    this.alive = true;
    this.hiddenForSpectate = false;
    this.pose = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, crouch: 0, lean: 0 };
    this.flashTime = 0;

    const color = TEAM_COLORS[team] ?? 0xffffff;
    const bodyMat = new THREE.MeshStandardMaterial({ color, roughness: 0.7 });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x1d2228, roughness: 0.5 });
    this.visorMat = new THREE.MeshStandardMaterial({ color: 0x1d2228, roughness: 0.4, emissive: 0x000000 });

    this.root = new THREE.Group();        // at the feet, rotated by yaw
    this.lean = new THREE.Group();        // tilts around the feet
    this.root.add(this.lean);

    this.torso = new THREE.Mesh(new THREE.BoxGeometry(0.62, 1, 0.38), bodyMat);
    this.torso.castShadow = true;
    this.lean.add(this.torso);

    this.head = new THREE.Group();
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.17, 16, 12), bodyMat);
    skull.castShadow = true;
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.08, 0.06), this.visorMat);
    visor.position.set(0, 0.02, -0.16);
    this.head.add(skull, visor);
    this.lean.add(this.head);

    // Small red marker above the head while a drone pilot has pinged this enemy.
    // Only the marker is drawn through walls; the body is not.
    this.marker = makeMarker();
    this.marker.visible = false;
    this.root.add(this.marker);
    this.spotted = false;

    // Held weapon: a scaled-down copy of the first-person model
    this.gunMount = new THREE.Group();
    this.lean.add(this.gunMount);
    this.weaponId = null;
    this.flash = new THREE.Mesh(
      new THREE.SphereGeometry(0.07, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.9 }),
    );
    this.flash.visible = false;

    this.label = makeLabel(name, color);
    if (isTeammate) {
      // Teammate names show through walls; enemy names only in line of sight.
      this.label.material.depthTest = false;
      this.label.renderOrder = 10;
    }
    this.lean.add(this.label);

    scene.add(this.root);
  }

  /** Tint the visor with the operator's colour. */
  setOperator(opId) {
    if (!opId || opId === this.operatorId) return;
    this.operatorId = opId;
    const op = OPERATORS[opId];
    if (op) this.visorMat.color.setHex(op.color);
  }

  setWeapon(id) {
    if (!id || id === this.weaponId) return;
    this.weaponId = id;
    this.gunMount.clear();
    const gun = makeGunModel(id);
    gun.scale.setScalar(1.3);
    gun.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    this.gunMount.add(gun);
    this.muzzle = gun.userData.muzzle;
    this.muzzle.add(this.flash);
  }

  /** World position of the muzzle, for tracers. */
  muzzlePosition() {
    const v = new THREE.Vector3();
    if (this.muzzle) this.muzzle.getWorldPosition(v);
    else v.set(this.pose.x, this.pose.y + 1.4, this.pose.z);
    return [v.x, v.y, v.z];
  }

  showFlash() {
    this.flashTime = 0.05;
  }

  push(t, s) {
    if (s.w) this.setWeapon(s.w.id);
    if (s.o) this.setOperator(s.o);
    // Coming back to life: don't interpolate from the death spot to the spawn.
    // (attackers have no body during prep: u = not spawned yet)
    const present = s.alive !== false && !s.u;
    if (present && !this.alive) this.buffer.length = 0;
    this.alive = present;
    this.buffer.push({ t, s });
    const cutoff = t - BUFFER_MS;
    while (this.buffer.length > 2 && this.buffer[0].t < cutoff) this.buffer.shift();
  }

  /** Place the avatar at renderTime by interpolating the two surrounding snapshots. */
  update(renderTime, dt = 0) {
    this.flashTime -= dt;
    this.flash.visible = this.flashTime > 0;
    this.root.visible = this.alive && !this.hiddenForSpectate;
    this.marker.visible = this.spotted && this.alive;
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
    const p = this.pose;
    p.x = L('x'); p.y = L('y'); p.z = L('z');
    p.yaw = lerpAngle(a.s.yaw, b.s.yaw, t);
    p.pitch = lerpAngle(a.s.pitch, b.s.pitch, t);
    p.crouch = crouch; p.lean = L('lean');
    this.root.position.set(p.x, p.y, p.z);
    this.root.rotation.y = p.yaw;
    this.lean.rotation.z = -p.lean * LEAN_ANGLE;

    const torsoH = h - 0.36;
    this.torso.scale.y = torsoH;
    this.torso.position.y = torsoH / 2;
    this.head.position.y = h - 0.18;
    this.head.rotation.x = p.pitch;
    this.gunMount.position.set(0.24, torsoH * 0.82, -0.2);
    this.gunMount.rotation.x = p.pitch;
    this.label.position.y = h + 0.35;
    this.markerPhase = (this.markerPhase || 0) + dt * 5;
    this.marker.position.y = h + 0.75 + Math.sin(this.markerPhase) * 0.05;
  }

  dispose() {
    this.scene.remove(this.root);
    this.root.traverse((o) => {
      o.geometry?.dispose();
      if (o.material) { o.material.map?.dispose(); o.material.dispose(); }
    });
  }
}
