// Other players: simple blocky bodies, interpolated between server snapshots.

import * as THREE from 'three';
import { TEAM_COLORS, LEAN_OFFSET, STAND_EYE, STAND_HEIGHT } from '../../shared/constants.js';
import { PRONE_BODY } from '../../shared/raycast.js';
import { bodyHeight } from '../../shared/movement.js';
import { makeGunModel, animateGun } from './weapons.js';
import { attachCharm } from './charmModels.js';
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
function makeMarker(fill = '#ff2a2a') {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.beginPath();
  ctx.moveTo(8, 12); ctx.lineTo(56, 12); ctx.lineTo(32, 56); ctx.closePath();
  ctx.fillStyle = fill;
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
  constructor(scene, { id, name, team, skins, charms }, isTeammate) {
    this.id = id;
    this.skins = skins || {};   // gun skins this player has equipped: { weaponId: skinId }
    this.charms = charms || {}; // charms hanging from their guns: { weaponId: charmId }
    this.name = name;
    this.team = team;
    this.buffer = []; // [{ t, s }]
    this.scene = scene;
    this.alive = true;
    this.hiddenForSpectate = false;
    this.pose = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, crouch: 0, prone: 0, lean: 0 };
    this.flashTime = 0;

    const color = TEAM_COLORS[team] ?? 0xffffff;
    const bodyMat = new THREE.MeshStandardMaterial({ color, roughness: 0.7 });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x1d2228, roughness: 0.5 });
    this.visorMat = new THREE.MeshStandardMaterial({ color: 0x1d2228, roughness: 0.4, emissive: 0x000000 });

    this.root = new THREE.Group();        // at the feet, rotated by yaw
    this.lean = new THREE.Group();        // tilts around the feet
    this.root.add(this.lean);

    // A simple humanoid: head with helmet, torso with vest, two arms holding the gun,
    // and two-segment legs. Poses are driven from snapshots in update().
    const skinMat = new THREE.MeshStandardMaterial({ color: 0xcfa27d, roughness: 0.8 });
    const bootMat = new THREE.MeshStandardMaterial({ color: 0x15181b, roughness: 0.7 });
    const box = (w, h, d, mat, y = 0) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.position.y = y;
      m.castShadow = true;
      return m;
    };

    // Legs: thigh and shin hang from the hip and bend to match the crouch
    this.hips = new THREE.Group();
    this.legs = [-1, 1].map((side) => {
      const thigh = new THREE.Group();
      thigh.position.x = side * 0.12;
      thigh.add(box(0.16, 0.46, 0.17, darkMat, -0.23));
      const shin = new THREE.Group();
      shin.position.y = -0.46;
      shin.add(box(0.14, 0.4, 0.15, darkMat, -0.2));
      const boot = box(0.15, 0.08, 0.24, bootMat, -0.43);
      boot.position.z = -0.03;
      shin.add(boot);
      thigh.add(shin);
      this.hips.add(thigh);
      return { thigh, shin };
    });
    this.hips.add(box(0.36, 0.14, 0.24, darkMat, 0));
    this.lean.add(this.hips);

    // Torso with a vest, and arms pivoting at the shoulders
    this.upper = new THREE.Group();
    this.upper.add(box(0.46, 0.55, 0.27, bodyMat, 0.275));
    this.upper.add(box(0.5, 0.36, 0.31, darkMat, 0.3));
    this.arms = [1, -1].map((side) => {
      const arm = new THREE.Group();
      arm.position.set(side * 0.31, 0.5, 0);
      arm.add(box(0.11, 0.3, 0.11, bodyMat, -0.15));
      const fore = box(0.1, 0.27, 0.1, skinMat, -0.43);
      arm.add(fore);
      arm.add(box(0.1, 0.08, 0.1, bootMat, -0.6));      // glove
      arm.rotation.order = 'YXZ';
      this.upper.add(arm);
      return arm;
    });
    this.lean.add(this.upper);

    this.head = new THREE.Group();
    this.head.add(new THREE.Mesh(new THREE.SphereGeometry(0.14, 16, 12), skinMat));
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.165, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.62), bodyMat);
    helmet.position.y = 0.015;
    helmet.castShadow = true;
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.07, 0.05), this.visorMat);
    visor.position.set(0, 0.0, -0.13);
    this.head.add(helmet, visor);
    this.lean.add(this.head);
    this.walkPhase = 0;
    this.swingT = 0;
    this.speed = 0; this.onGround = true; this.vy = 0; this.reloading = false;   // read by the soundscape

    // Small red marker above the head while a drone pilot has pinged this enemy.
    // Only the marker is drawn through walls; the body is not.
    this.marker = makeMarker();
    this.marker.visible = false;
    this.root.add(this.marker);
    this.spotted = false;
    // The attacker carrying the defuser, shown to their teammates (a yellow arrow over their head, even through walls)
    this.carrier = false;
    this.carryMark = makeMarker('#ffd23c');
    this.carryMark.visible = false;
    this.root.add(this.carryMark);
    // A defender who stayed outside too long: a red glow through walls (only attackers are told)
    this.detected = false;
    this.glow = new THREE.Mesh(
      new THREE.BoxGeometry(0.75, 1.9, 0.55),
      new THREE.MeshBasicMaterial({ color: 0xff2a2a, transparent: true, opacity: 0.45, depthTest: false, depthWrite: false }),
    );
    this.glow.position.y = 0.95;
    this.glow.renderOrder = 15;
    this.glow.visible = false;
    this.root.add(this.glow);
    this.rap = 0; this.rapFlip = 0; this.vaulting = false;   // on a rope (rope number), how upside down, hopping over something

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
    this.root.add(this.label);   // on the root so it stays upright when the body leans or lies down

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
    const gun = makeGunModel(id, this.skins[id]);
    gun.scale.multiplyScalar(1.3);   // keeps the gun's own size
    gun.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    this.gunMount.add(gun);
    attachCharm(gun, this.charms[id]);
    this.gun = gun;
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

  /** Melee animation. */
  swing() {
    this.swingT = 0.0001;
  }

  showFlash() {
    this.flashTime = 0.05;
  }

  push(t, s) {
    if (s.w) this.setWeapon(s.w.id);
    if (s.o) this.setOperator(s.o);
    this.reloading = !!(s.w && s.w.reload > 0);
    this.detected = !!s.det;
    this.rap = s.rk ? s.rk[0] : 0;
    this.rapFlip = s.rk ? s.rk[2] : 0;
    this.vaulting = !!s.vt;
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
    // The slide or bolt kicks back with each shot; a reload drops the magazine
    if (this.gun) animateGun(this.gun, { kick: Math.max(0, this.flashTime) / 0.05, reloadFrac: this.reloading ? ((performance.now() / 1000) % 2.4) / 2.4 : -1 });
    this.root.visible = this.alive && !this.hiddenForSpectate;
    this.marker.visible = this.spotted && this.alive;
    this.glow.visible = this.detected && this.alive;
    this.carryMark.visible = this.carrier && this.alive;
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
    const prone = (a.s.prone || 0) + ((b.s.prone || 0) - (a.s.prone || 0)) * t;
    const p = this.pose;
    p.x = L('x'); p.y = L('y'); p.z = L('z');
    p.yaw = lerpAngle(a.s.yaw, b.s.yaw, t);
    p.pitch = lerpAngle(a.s.pitch, b.s.pitch, t);
    p.crouch = crouch; p.prone = prone; p.lean = L('lean');
    this.root.position.set(p.x, p.y, p.z);
    this.root.rotation.y = p.yaw;
    // The charm swings with the player's movement (seen from the player's own side) and with each shot
    const charm = this.gun?.userData.charm;
    if (charm) {
      if (this.flashTime > 0.045) charm.push(0.5 * (Math.random() - 0.5), 1.4);
      const c = Math.cos(p.yaw), s = Math.sin(p.yaw);
      charm.update(dt, { x: p.x * c - p.z * s, y: p.y, z: p.x * s + p.z * c });
    }
    this.lean.rotation.z = -p.lean * LEAN_ANGLE;
    // Prone: the whole body tips forward around the feet to lie flat, feet behind,
    // head in front (the server's prone hitbox in shared/raycast.js matches this).
    this.lean.rotation.x = -Math.PI / 2 * prone;
    this.lean.position.set(0, 0.17 * prone, PRONE_BODY.max[2] * prone);
    if (this.rap) {
      // Hanging on a rope: leaning back against the wall, or flipped head down (the body turns about the feet, then is lifted so the hips stay put)
      const flip = this.rapFlip, back = 0.5;
      this.lean.rotation.x = back + flip * (Math.PI - back);
      this.lean.position.y = flip * 1.8;
    }
    // Body pose height: crouch height upright, straightening out as the body lies down
    const upright = bodyHeight(crouch);
    const h = upright + (STAND_HEIGHT - upright) * prone;

    // Pose the body from the snapshot: height from crouch, legs from speed, arms from aim
    const speed = Math.hypot(L('vx'), L('vz'));
    this.speed = speed;
    this.onGround = b.s.onGround !== false;
    this.vy = L('vy');
    const sprinting = speed > 5;
    this.walkPhase += speed * dt * 2.3;
    const k = Math.min(1, speed / 4);
    const shoulderY = h - 0.33;
    const hipY = shoulderY - 0.55;
    this.hips.position.y = hipY + Math.abs(Math.sin(this.walkPhase)) * 0.025 * k;
    const bend = Math.acos(Math.min(1, Math.max(0, hipY / 0.92)));     // thigh angle that puts the foot under the hip
    const swing = Math.sin(this.walkPhase) * 0.65 * k;
    this.legs[0].thigh.rotation.x = bend + swing;
    this.legs[1].thigh.rotation.x = bend - swing;
    this.legs[0].shin.rotation.x = -2 * bend - Math.max(0, swing) * 0.9;
    this.legs[1].shin.rotation.x = -2 * bend - Math.max(0, -swing) * 0.9;

    this.upper.position.y = hipY;
    this.upper.rotation.x = sprinting ? -0.18 : 0;
    this.head.position.y = h - 0.18;

    // Melee: both arms chop forward and up, then settle
    let strike = 0;
    if (this.swingT > 0) {
      this.swingT += dt / 0.3;
      if (this.swingT >= 1) this.swingT = 0; else strike = Math.sin(this.swingT * Math.PI);
    }
    // Lying down, "forward" for arms, gun and head is along the body (towards the head)
    const lie = Math.PI / 2 * prone;
    this.head.rotation.x = p.pitch + lie;
    const armBase = sprinting ? 0.55 : Math.PI / 2 + p.pitch + lie;   // sprinting carries the gun low
    this.arms[0].rotation.set(armBase + strike * 0.9, 0.25 - strike * 0.3, 0);
    this.arms[1].rotation.set(armBase + strike * 0.9, -0.5 + strike * 0.3, 0);
    this.gunMount.position.set(0.1, shoulderY - 0.1 - (sprinting ? 0.12 : 0) + 0.3 * prone, -0.3 - strike * 0.25 + 0.41 * prone);
    this.gunMount.rotation.x = sprinting ? -0.2 : p.pitch + lie + strike * 0.5;
    const top = bodyHeight(crouch, prone);   // real height above the floor, for the name tag and marker
    this.label.position.y = top + 0.35;
    this.markerPhase = (this.markerPhase || 0) + dt * 5;
    this.marker.position.y = top + 0.75 + Math.sin(this.markerPhase) * 0.05;
    this.carryMark.position.y = top + 0.75 + Math.sin(this.markerPhase) * 0.05;
  }

  dispose() {
    this.scene.remove(this.root);
    this.root.traverse((o) => {
      o.geometry?.dispose();
      if (o.material) { o.material.map?.dispose(); o.material.dispose(); }
    });
  }
}
