// Other players: detailed bodies (client/src/avatarModel.js), interpolated between server snapshots and posed here.
// Arms and legs are solved from where the hands and feet need to be: the hands stay on the gun through aiming and
// reloads, and the feet step along the ground in the direction of travel.

import * as THREE from 'three';
import { TEAM_COLORS, LEAN_OFFSET, STAND_EYE, STAND_HEIGHT } from '../../shared/constants.js';
import { PRONE_BODY } from '../../shared/raycast.js';
import { bodyHeight } from '../../shared/movement.js';
import { makeGunModel, animateGun } from './weapons.js';
import { attachCharm } from './charmModels.js';
import { OPERATORS, defaultOperator } from '../../shared/operators.js';
import { WEAPONS, gunFor } from '../../shared/weapons.js';
import { SHIELD_HEIGHT } from '../../shared/raycast.js';
import { bodyShapes, bodyMesh, LIMBS } from './avatarModel.js';
import { quality } from './graphics.js';

const SHIELD_ID = Object.values(WEAPONS).find((w) => w.shield)?.id;

const LEAN_ANGLE = Math.atan2(LEAN_OFFSET, STAND_EYE);
const BUFFER_MS = 1000;
const NEAR = 16, FAR = 20;      // metres: closer than NEAR the full body, further than FAR the low one
const STEP_ANKLE = LIMBS.ankle;
const REACH_EPS = 0.001;

// Whose eyes decide how much detail a body needs (the game's camera; the menus have none, so they get the full body)
let viewer = null;
export function setAvatarViewer(camera) { viewer = camera; }

const lerp = (a, b, k) => a + (b - a) * k;
const ease = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// Working values for posing, so a frame makes no garbage
const V = () => new THREE.Vector3();
const vS = V(), vT = V(), vD = V(), vE = V(), vP = V(), vX = V(), vY = V(), vZ = V(), vF = V(), vR = V(), vL = V(), vA = V(), vB = V();
const mA = new THREE.Matrix4(), mB = new THREE.Matrix4(), qU = new THREE.Quaternion(), qF = new THREE.Quaternion();

/** The rotation that runs a limb's -y along `dir`, with its -z (knee pads, elbow pads) towards `pole`. */
function aim(q, dir, pole) {
  vY.copy(dir).negate();
  vZ.copy(pole).addScaledVector(vY, -pole.dot(vY));
  if (vZ.lengthSq() < 1e-6) vZ.set(0, 0, 1).addScaledVector(vY, -vY.z);
  vZ.normalize().negate();
  vX.crossVectors(vY, vZ);
  q.setFromRotationMatrix(mA.makeBasis(vX, vY, vZ));
}

/** Two-joint limb: upper hangs at `root`, lower hangs from its end, and the far end reaches `target` if it can. */
function solveLimb(upper, lower, root, target, pole, l1, l2) {
  vD.subVectors(target, root);
  const reach = Math.max(Math.abs(l1 - l2) + REACH_EPS, Math.min(l1 + l2 - REACH_EPS, vD.length()));
  vD.normalize();
  const a = (l1 * l1 - l2 * l2 + reach * reach) / (2 * reach), h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  vP.copy(pole).addScaledVector(vD, -pole.dot(vD));
  if (vP.lengthSq() < 1e-6) vP.set(0, 0, -1).addScaledVector(vD, vD.z);
  vP.normalize();
  vE.copy(vD).multiplyScalar(a).addScaledVector(vP, h);        // the elbow or knee, from the root
  vF.copy(vE).normalize();
  aim(qU, vF, vP);
  upper.position.copy(root);
  upper.quaternion.copy(qU);
  vF.copy(vD).multiplyScalar(reach).sub(vE).normalize();
  aim(qF, vF, vP);
  lower.position.set(0, -l1, 0);
  lower.quaternion.copy(qU).invert().multiply(qF);
}

/** Where the hands go on a gun, in the gun's own coordinates. */
function holdPoints(gun, model) {
  const parts = gun.userData.parts || {}, names = Object.keys(parts);
  const find = (prefix) => names.filter((n) => n.startsWith(prefix)).flatMap((n) => parts[n]);
  const box = (meshes) => {
    const b = new THREE.Box3();
    for (const m of meshes) {
      m.geometry.computeBoundingBox();
      const bb = m.geometry.boundingBox.clone();
      bb.translate(m.position);
      if (m.parent !== gun) bb.translate(m.parent.position);
      b.union(bb);
    }
    return b;
  };
  const grip = find('grip.main');
  const gc = grip.length ? box(grip).getCenter(V()) : V().set(0, -0.06, 0.08);
  const right = gc.clone().add(V().set(0, 0, 0));
  const pistol = ['pistol', 'revolver', 'machinePistol'].includes(model);
  const side = pistol ? [] : find('foregrip'), under = pistol ? [] : [...find('pump.main'), ...find('handguard.main'), ...find('shroud.main')];
  let left;
  if (pistol) left = gc.clone().add(V().set(-0.03, -0.03, 0));
  else if (side.length) left = box(side).getCenter(V());
  else if (under.length) { const b = box(under), c = b.getCenter(V()); left = V().set(c.x, b.min.y - 0.012, c.z); }
  else left = V().set(0, -0.05, -0.25);
  return { right, left };
}

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

/** A teammate on the floor: a red circle with a white cross, always visible, even through walls. */
function makeDownedIcon() {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.beginPath();
  ctx.arc(32, 32, 27, 0, Math.PI * 2);
  ctx.fillStyle = '#e02434';
  ctx.fill();
  ctx.lineWidth = 5;
  ctx.strokeStyle = 'rgba(0,0,0,0.75)';
  ctx.stroke();
  ctx.fillStyle = '#fff';
  ctx.fillRect(26, 15, 12, 34);
  ctx.fillRect(15, 26, 34, 12);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, depthWrite: false, transparent: true, sizeAttenuation: false }));
  sprite.scale.set(0.05, 0.05, 1);
  sprite.renderOrder = 21;
  return sprite;
}
let downedIcon = null;   // one texture shared by everyone; each player gets their own sprite only if they need it

export class RemotePlayer {
  constructor(scene, { id, name, team, skins, charms, attachments }, isTeammate) {
    this.id = id;
    this.isTeammate = isTeammate;
    this.skins = skins || {};   // gun skins this player has equipped: { weaponId: skinId }
    this.charms = charms || {}; // charms hanging from their guns: { weaponId: charmId }
    this.attachments = attachments || {}; // what is fitted to their guns: { weaponId: attachments }
    this.name = name;
    this.team = team;
    this.buffer = []; // [{ t, s }]
    this.scene = scene;
    this.alive = true;
    this.hiddenForSpectate = false;
    this.pose = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, crouch: 0, prone: 0, lean: 0 };
    this.flashTime = 0;

    const color = TEAM_COLORS[team] ?? 0xffffff;

    this.root = new THREE.Group();        // at the feet, rotated by yaw
    this.lean = new THREE.Group();        // tilts around the feet
    this.root.add(this.lean);

    // The body, one mesh per part (client/src/avatarModel.js). Poses are worked out in update(). Index 0 is the right side.
    const bone = (parent) => { const m = bodyMesh(); (parent || this.lean).add(m); return m; };
    this.hips = bone();
    this.upper = bone();                  // the torso, from the hips to the neck
    this.head = bone();
    this.lensMesh = new THREE.Mesh();
    this.lensMesh.userData.shared = true;
    this.head.add(this.lensMesh);
    this.arms = [0, 1].map(() => { const upper = bone(); const fore = bone(upper); return { upper, fore }; });
    this.legs = [0, 1].map(() => { const thigh = bone(); const shin = bone(thigh); const foot = bone(); return { thigh, shin, foot }; });
    this.operatorId = null;
    this.low = null;
    this.detailTimer = 0;
    this.inMenu = id === 'menu' || id === 'preview';
    this.applyShapes(defaultOperator(team), quality().effects === 'low');
    this.walkPhase = 0;
    this.time = Math.random() * 10;       // idle breathing, so players aren't in step
    this.swingT = 0;
    this.sprintAmt = 0; this.adsAmt = 0; this.moveAmt = 0; this.vaultAmt = 0; this.rapAmt = 0; this.airAmt = 0; this.reloadAmt = 0;
    this.moveX = 0; this.moveZ = -1;      // the way the feet are stepping, in the body's own frame
    this.rapPhase = 0; this.lastY = 0;
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
    // Aegis's ballistic shield, built the first time the snapshots say they carry one (cover > 0)
    this.shield = null;
    this.shieldMount = new THREE.Group();
    this.shieldMount.visible = false;
    this.lean.add(this.shieldMount);
    this.cover = 0;              // shieldCover(): 0 none or swung aside, 1 drawn in front, 2 held to the side
    // Placing something (Stage 27): 1 kneeling at the floor, 2 reaching forward; the gun goes and a small case is in the hands
    this.placing = 0;
    this.placeAmt = 0; this.kneelAmt = 0;
    this.placeItem = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.08, 0.11), new THREE.MeshStandardMaterial({ color: 0x2a2f36, roughness: 0.5, metalness: 0.5 }));
    this.placeItem.visible = false;
    this.lean.add(this.placeItem);
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

  /** Dress the body as this operator. */
  setOperator(opId) {
    if (!opId || opId === this.operatorId) return;
    this.applyShapes(opId, this.low);
  }

  /** Put an operator's shapes on the bones, in full or low detail. */
  applyShapes(opId, low) {
    this.operatorId = opId;
    this.low = low;
    const s = bodyShapes(opId, this.team, low);
    this.hips.geometry = s.hips;
    this.upper.geometry = s.torso;
    this.head.geometry = s.head;
    this.lensMesh.visible = !!s.lens;
    if (s.lens) { this.lensMesh.geometry = s.lens; this.lensMesh.material = s.lensMaterial; }
    this.arms.forEach((a, i) => { a.upper.geometry = s.upperArm[i]; a.fore.geometry = s.foreArm[i]; });
    this.legs.forEach((l, i) => { l.thigh.geometry = s.thigh[i]; l.shin.geometry = s.shin[i]; l.foot.geometry = s.foot[i]; });
  }

  /** Every so often: is this body close enough to need the full version? The Low graphics setting always uses the low one. */
  checkDetail(dt) {
    this.detailTimer -= dt;
    if (this.detailTimer > 0) return;
    this.detailTimer = 0.4;
    let low = quality().effects === 'low';
    if (!low && viewer && !this.inMenu) {
      const d = viewer.position.distanceTo(this.root.position);
      low = this.low ? d > NEAR : d > FAR;      // a gap between the two, so it doesn't flick at the boundary
    }
    if (low !== this.low) this.applyShapes(this.operatorId, low);
  }

  setWeapon(id) {
    if (!id || id === this.weaponId) return;
    this.weaponId = id;
    this.gunMount.clear();
    // A shield: it goes on its own mount and the hands hold nothing else
    if (WEAPONS[id]?.shield) {
      this.ensureShield(id);
      if (!this.cover) this.cover = 1;
      this.gun = null; this.hold = null; this.muzzle = null;
      return;
    }
    const gun = makeGunModel(id, this.skins[id], this.attachments[id]);
    gun.scale.multiplyScalar(1.3);   // keeps the gun's own size
    gun.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    this.gunMount.add(gun);
    attachCharm(gun, this.charms[id]);
    this.gun = gun;
    this.hold = holdPoints(gun, WEAPONS[id]?.model);
    this.muzzle = gun.userData.muzzle;
    this.muzzle.add(this.flash);
  }

  ensureShield(id = SHIELD_ID) {
    if (this.shield || !id) return;
    this.shield = makeGunModel(id, this.skins[id]);
    attachCharm(this.shield, this.charms[id]);
    this.shield.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    this.shieldMount.add(this.shield);
    this.shieldPose = null;
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
    // How far through the reload (0 to 1). w.reload counts the seconds left.
    if (s.w) this.reloadFrac = this.reloading ? Math.max(0, 1 - s.w.reload / (gunFor(s.w.id, this.attachments)?.reloadTime || 2.4)) : -1;
    this.placing = s.pl || 0;
    this.downed = !!s.dn;       // knocked down (Stage Q): dn is the seconds left to bleed out (for their team; 1 for the others)
    this.downedLeft = s.dn || 0;
    this.reviveFrac = s.rv || 0;
    this.revivedBy = s.rb || null;
    // (the menu's stand-in poses carry no id and no shield state: a shield is shown raised there)
    this.cover = 'id' in s ? s.sh || 0 : WEAPONS[this.weaponId]?.shield ? 1 : 0;
    if (this.cover) this.ensureShield();
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
    const reloadFrac = this.reloading ? this.reloadFrac ?? -1 : -1;
    if (this.gun) animateGun(this.gun, { kick: Math.max(0, this.flashTime) / 0.05, reloadFrac });
    this.checkDetail(dt);
    this.root.visible = this.alive && !this.hiddenForSpectate;
    this.marker.visible = this.spotted && this.alive;
    this.glow.visible = this.detected && this.alive;
    this.carryMark.visible = this.carrier && this.alive;
    if (this.downed && this.isTeammate && !this.downedMark) {
      downedIcon ||= makeDownedIcon();
      this.downedMark = downedIcon.clone();
      this.downedMark.userData.shared = true;   // the picture is shared: not ours to dispose of
      this.root.add(this.downedMark);
    }
    if (this.downedMark) this.downedMark.visible = this.downed && this.isTeammate && this.alive;
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
    p.sh = this.cover;   // the client's own shot prediction tests the shield too
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
      // Hanging on a rope: leaning back from the wall, or rolled head down, still facing where they look (then lifted so the hips stay put)
      const flip = this.rapFlip;
      this.lean.rotation.x = 0.5 * (1 - flip);
      this.lean.rotation.z = Math.PI * flip;
      this.lean.position.y = flip * 1.8;
    }
    this.poseBody(a, b, t, dt, reloadFrac);
    const top = bodyHeight(crouch, prone);   // real height above the floor, for the name tag and marker
    this.label.position.y = top + 0.35;
    this.markerPhase = (this.markerPhase || 0) + dt * 5;
    this.marker.position.y = top + 0.75 + Math.sin(this.markerPhase) * 0.05;
    this.carryMark.position.y = top + 0.75 + Math.sin(this.markerPhase) * 0.05;
    if (this.downedMark) this.downedMark.position.y = top + 0.65 + Math.sin(this.markerPhase * 0.7) * 0.04;
  }

  /** Pose the body for this frame, from where the hands and feet need to be. */
  poseBody(a, b, t, dt, reloadFrac) {
    const L = (k) => (a.s[k] || 0) + ((b.s[k] || 0) - (a.s[k] || 0)) * t;
    const p = this.pose, crouch = p.crouch, prone = p.prone;
    const k = (rate) => 1 - Math.exp(-rate * dt);
    this.time += dt;
    const time = this.time;

    // Placing: ease into kneeling (floor items) or reaching forward (wall items)
    this.placeAmt += ((this.placing ? 1 : 0) - this.placeAmt) * k(9);
    this.kneelAmt += ((this.placing === 1 ? 1 : 0) - this.kneelAmt) * k(9);
    // Body pose height: crouch height upright, straightening out as the body lies down
    const upright = bodyHeight(Math.max(crouch, this.kneelAmt)) - 0.25 * this.kneelAmt;
    const h = upright + (STAND_HEIGHT - upright) * prone;

    // How fast, and which way in the body's own frame
    const vx = L('vx'), vz = L('vz');
    const speed = Math.hypot(vx, vz);
    this.speed = speed;
    this.onGround = b.s.onGround !== false;
    this.vy = L('vy');
    const cy = Math.cos(p.yaw), sy = Math.sin(p.yaw);
    if (speed > 0.25) {
      const lx = (vx * cy - vz * sy) / speed, lz = (vx * sy + vz * cy) / speed;
      this.moveX += (lx - this.moveX) * k(12); this.moveZ += (lz - this.moveZ) * k(12);
    }
    const sprinting = speed > 5 && prone < 0.5;
    this.sprintAmt += ((sprinting ? 1 : 0) - this.sprintAmt) * k(9);
    this.moveAmt += (Math.min(1, speed / 0.8) - this.moveAmt) * k(12);
    this.adsAmt += (L('ad') - this.adsAmt) * k(16);
    this.vaultAmt += ((this.vaulting ? 1 : 0) - this.vaultAmt) * k(14);
    this.rapAmt += ((this.rap ? 1 : 0) - this.rapAmt) * k(10);
    this.airAmt += ((!this.onGround && !this.rap && !this.vaulting ? 1 : 0) - this.airAmt) * k(10);
    this.reloadAmt += ((reloadFrac >= 0 ? 1 : 0) - this.reloadAmt) * k(10);
    const sprint = this.sprintAmt, ads = this.adsAmt * (1 - sprint), move = this.moveAmt, vault = this.vaultAmt, rap = this.rapAmt, kneel = this.kneelAmt, place = this.placeAmt;
    const stand = 1 - prone;

    // Steps: the foot travels +-A along the way of travel, and lifts while it swings forward
    const A = (0.14 + Math.min(speed, 7) * 0.042) * lerp(1, 0.72, crouch);
    this.walkPhase += (speed * dt) / Math.max(0.1, A * 1.7);
    const phase = this.walkPhase;

    const shoulderY = h - 0.33;
    const hipY = shoulderY - 0.55;
    const bob = (Math.cos(phase * 2) * 0.016 - 0.01) * move * (1 + sprint) * stand;
    const breathe = Math.sin(time * 1.5) * 0.004;

    // The spine leans into a sprint, a crouch or kneeling, and takes a share of looking up and down. The hips go back
    // to balance it, so the head stays over the feet, where its hitbox is.
    const lie = Math.PI / 2 * prone;
    const spine = THREE.MathUtils.clamp((0.28 * Math.max(crouch, 0) + 0.24 * sprint + 0.48 * kneel * (this.placing === 1 ? 1 : 0) + 0.5 * vault + 0.07 * move - p.pitch * 0.22) * stand, -0.22, 0.75);
    const back = Math.sin(spine) * 0.34;
    const twist = Math.sin(phase) * (0.05 + 0.1 * sprint) * move * stand * (1 - ads);
    const crawl = prone * Math.min(1, speed / 0.3);
    this.hips.position.set(0, hipY + bob, back);
    this.hips.rotation.set(-spine * 0.4, twist * -0.8, 0);
    this.upper.position.set(0, hipY + bob + breathe, back);
    this.upper.rotation.set(-spine, twist + Math.sin(phase) * 0.12 * crawl, Math.sin(phase) * 0.03 * move * stand);
    this.upper.updateMatrix(); this.hips.updateMatrix();

    this.head.position.set(0, h - 0.18 + breathe + bob * 0.5, 0);
    this.head.rotation.set(p.pitch + lie, -twist * 0.5, -0.1 * ads);

    // Melee: both arms chop forward and up, then settle
    let strike = 0;
    if (this.swingT > 0) {
      this.swingT += dt / 0.3;
      if (this.swingT >= 1) this.swingT = 0; else strike = Math.sin(this.swingT * Math.PI);
    }

    // ---------------------------------------------------------------- the gun
    const kick = Math.max(0, this.flashTime) / 0.05;
    const reloadTilt = this.reloadAmt * (1 - ads);
    const swayX = Math.sin(time * 0.9) * 0.003, swayY = Math.sin(time * 1.5) * 0.004 + Math.sin(phase * 2) * 0.01 * move * stand;
    const gunScale = this.gun ? this.gun.userData.sightY * 1.3 : 0.06;
    let gx = 0.1, gy = shoulderY - 0.1, gz = -0.3;
    gx = lerp(gx, 0.03, sprint); gy = lerp(gy, shoulderY - 0.25, sprint); gz = lerp(gz, -0.2, sprint);
    gx = lerp(gx, 0.055, ads); gy = lerp(gy, h - 0.16 - gunScale, ads * stand); gz = lerp(gz, -0.34, ads);
    gy += 0.3 * prone; gz += 0.41 * prone;
    gy -= 0.06 * reloadTilt; gz += 0.05 * reloadTilt;
    gz += 0.022 * kick - strike * 0.25 + 0.06 * Math.sin(phase) * crawl;
    gy += swayY - 0.14 * vault - 0.1 * rap * (1 - ads);
    this.gunMount.position.set(gx + swayX + 0.05 * vault, gy, gz);
    const rx = lerp(p.pitch + lie, -0.34, sprint) + strike * 0.5 + 0.03 * kick + 0.28 * reloadTilt - 0.4 * vault - 0.5 * rap * (1 - this.rapFlip);
    this.gunMount.rotation.set(rx, 0.62 * sprint + 0.14 * reloadTilt, -0.26 * sprint + 0.42 * reloadTilt);
    this.gunMount.visible = place < 0.5 && !this.downed;
    this.gunMount.updateMatrix();

    // ---------------------------------------------------------------- the hands
    const right = vR, left = vL;
    if (this.gun && this.hold) {
      this.gun.updateMatrix();
      mB.multiplyMatrices(this.gunMount.matrix, this.gun.matrix);
      right.copy(this.hold.right).applyMatrix4(mB);
      left.copy(this.hold.left).applyMatrix4(mB);
      // Reloading: the left hand takes the magazine out, goes to a pouch on the vest, brings a new one back
      const mag = this.gun.userData.anim?.mag;
      if (reloadFrac >= 0 && mag) {
        vA.copy(mag.position);
        if (mag.parent !== this.gun) vA.add(mag.parent.position);
        vA.applyMatrix4(mB);
        vB.set(-0.13, 0.17, -0.2).applyMatrix4(this.upper.matrix);
        const f = reloadFrac;
        const toMag = ease(0, 0.1, f) * (1 - ease(0.88, 1, f));
        const toPouch = ease(0.36, 0.5, f) * (1 - ease(0.58, 0.72, f));
        vA.lerp(vB, toPouch);
        left.lerp(vA, toMag);
      }
    } else if (this.cover || this.shield) {
      // A shield and nothing else: both hands on its grips
      const s = this.shieldMount.position;
      right.set(s.x + 0.1, s.y - 0.1, s.z + 0.1);
      left.set(s.x - 0.12, s.y - 0.02, s.z + 0.1);
    } else {
      right.set(0.26, hipY + 0.02, -0.06);
      left.set(-0.26, hipY + 0.02, -0.06);
    }
    if (this.gun && this.shield && this.cover) { const s = this.shieldMount.position; left.set(s.x + 0.02, s.y, s.z + 0.1); }   // pistol in the right, shield in the left

    // Placing something: both hands on the item, working at it
    if (place > 0.01) {
      const floor = this.placing === 1 || kneel > 0.5;
      const work = Math.sin(time * 9) * 0.012;
      const ix = 0.02, iy = floor ? 0.2 + work : shoulderY - 0.06 + work, iz = floor ? -0.46 : -0.46 + work;
      this.placeItem.position.set(ix, iy, iz);
      this.placeItem.visible = place >= 0.5;
      right.lerp(vA.set(ix + 0.085, iy + 0.03, iz + 0.015), place);
      left.lerp(vA.set(ix - 0.085, iy + 0.03, iz + 0.015), place);
    } else this.placeItem.visible = false;

    // Knocked down: the gun is gone and the arms drag the body along, one hand over the other
    this.downedAmt = (this.downedAmt || 0) + ((this.downed ? 1 : 0) - (this.downedAmt || 0)) * Math.min(1, dt * 9);
    if (this.downedAmt > 0.01) {
      const reach = Math.sin(phase * 0.9) * 0.14 * Math.min(1, speed / 0.2);
      // (lying down, this frame's up is along the floor and its back is up off the floor)
      right.lerp(vA.set(0.27, shoulderY + 0.26 + reach, 0.02), this.downedAmt);
      left.lerp(vA.set(-0.27, shoulderY + 0.26 - reach, 0.02), this.downedAmt);
    }

    // On a rope the left hand holds it above the head; hopping over something it plants on the obstacle
    if (rap > 0.01 && this.rapFlip < 0.5) left.lerp(vA.set(-0.06, shoulderY + 0.28 + Math.sin(this.rapPhase) * 0.05, -0.34), rap);
    if (vault > 0.01) left.lerp(vA.set(-0.2, hipY - 0.12, -0.46), vault);

    const elbowDown = lerp(-1, -0.3, prone);
    vS.set(0.25, 0.49, 0).applyMatrix4(this.upper.matrix);
    vT.set(0.75, elbowDown, lerp(0.42, -0.9, prone));
    solveLimb(this.arms[0].upper, this.arms[0].fore, vS, right, vT, LIMBS.upperArm, LIMBS.foreArm);
    vS.set(-0.25, 0.49, 0).applyMatrix4(this.upper.matrix);
    vT.set(-0.85, elbowDown, lerp(0.18, -0.9, prone));
    solveLimb(this.arms[1].upper, this.arms[1].fore, vS, left, vT, LIMBS.upperArm, LIMBS.foreArm);

    // ---------------------------------------------------------------- the feet
    const leanA = p.lean * LEAN_ANGLE * stand * (1 - rap), cosL = Math.cos(leanA), sinL = Math.sin(leanA);
    this.rapPhase += Math.abs(p.y - this.lastY) * 3.4;
    this.lastY = p.y;
    this.legs.forEach((leg, i) => {
      const side = i === 0 ? 1 : -1, ph = phase + (i === 0 ? 0 : Math.PI);
      const swingK = Math.sin(ph), liftK = Math.max(0, Math.cos(ph));
      // Standing and walking
      const stance = 0.135 + 0.02 * crouch;
      let fx = side * stance + this.moveX * A * swingK * move;
      let fz = (side > 0 ? -0.15 : 0.14) * crouch + this.moveZ * A * swingK * move + (side > 0 ? -0.07 : 0.07);
      let fy = STEP_ANKLE + liftK ** 1.5 * (0.06 + 0.2 * sprint + 0.02 * crouch) * move;
      let toe = -0.6 * liftK * (0.25 + sprint) * move;   // (above zero lifts the toe, below lifts the heel)
      // A heel lifts when the back foot of a crouch is bent far under
      if (side < 0) { fy += 0.05 * crouch; toe -= 0.5 * crouch; }
      // Kneeling to place something: right foot forward, left knee on the floor
      if (kneel > 0.01) {
        fx = lerp(fx, side * 0.13, kneel);
        fz = lerp(fz, side > 0 ? -0.3 : 0.32, kneel);
        fy = lerp(fy, side > 0 ? STEP_ANKLE : 0.13, kneel);
        toe = lerp(toe, side > 0 ? 0 : -0.9, kneel);
      }
      // Hopping over something: both knees tucked up
      if (vault > 0.01) { fy = lerp(fy, hipY - 0.28, vault); fz = lerp(fz, -0.12 * side, vault); toe = lerp(toe, -0.3, vault); }
      // In the air: legs drawn up a little
      if (this.airAmt > 0.01) { fy = lerp(fy, Math.max(STEP_ANKLE, hipY - 0.68), this.airAmt); fz = lerp(fz, side * 0.1, this.airAmt); toe = lerp(toe, -0.5, this.airAmt); }
      // Lying down: legs straight out behind, drawn up in turn when crawling
      if (prone > 0.01) {
        const draw = Math.max(0, Math.sin(ph)) * crawl;
        fx = lerp(fx, side * (0.14 + 0.1 * draw), prone);
        fy = lerp(fy, 0.2 + 0.26 * draw, prone);
        fz = lerp(fz, 0.02, prone);
        toe *= 1 - prone;
      }
      // On a rope: walking the wall in front
      if (rap > 0.01) {
        const walk = Math.sin(this.rapPhase + i * Math.PI);
        fx = lerp(fx, side * 0.15, rap);
        fy = lerp(fy, 0.24 + walk * 0.1, rap);
        fz = lerp(fz, -0.56 - Math.max(0, walk) * 0.05, rap);
        toe = lerp(toe, 1.05, rap);
      }
      // Leaning tips the body about the feet, but the feet stay flat on the floor
      vT.set(fx * cosL - fy * sinL, fx * sinL + fy * cosL, fz);
      vS.set(side * 0.095, -0.07, 0).applyMatrix4(this.hips.matrix);
      vA.set(side * (0.1 + prone * 0.9), 0, lerp(-1, 0.15, prone));
      solveLimb(leg.thigh, leg.shin, vS, vT, vA, LIMBS.thigh, LIMBS.shin);
      leg.foot.position.copy(vT);
      leg.foot.rotation.set(toe - 1.3 * prone, side * (0.12 + 0.3 * prone), 0);
    });

    if (this.shield) this.poseShield(dt, h, strike, prone);
  }

  /** Put the shield where shieldCover() says it is (eased): in front, held to the side, or swung aside. Matches shieldBox() in shared/raycast.js. */
  poseShield(dt, h, strike, prone) {
    const c = this.cover, half = SHIELD_HEIGHT / 2;
    // Carried: shown now, drawn, their operator has one, or seen in the last 2 s (sprinting hides the cover state)
    const now = performance.now();
    if (c > 0) this.coverSeen = now;
    const carried = c > 0 || WEAPONS[this.weaponId]?.shield || WEAPONS[OPERATORS[this.operatorId]?.weapons.primary]?.shield || now - (this.coverSeen || -1e9) < 2000;
    this.shieldMount.visible = carried && prone < 0.5;
    if (!this.shieldMount.visible) return;
    // [x, y (centre), z, yaw]
    const want = c === 1 ? [-0.02, h + 0.06 - half, -0.48 - strike * 0.25, 0]
      : c === 2 ? [-0.34, h - 0.04 - half, -0.44, 0.4]   // pistol out: held to the left
        : [-0.42, h * 0.5, -0.12, 1.2];                  // sprinting: swung aside
    if (!this.shieldPose || Math.abs(this.shieldPose[3] - want[3]) > 2) this.shieldPose = want.slice();
    const k = Math.min(1, dt * 10);
    for (let i = 0; i < 4; i++) this.shieldPose[i] += (want[i] - this.shieldPose[i]) * k;
    this.shieldMount.position.set(this.shieldPose[0], Math.max(half + 0.02, this.shieldPose[1]), this.shieldPose[2]);
    this.shieldMount.rotation.set(0, this.shieldPose[3], 0);
    this.shield.userData.charm?.update(dt, this.shieldMount.position);
  }

  dispose() {
    this.scene.remove(this.root);
    this.root.traverse((o) => {
      if (o.userData.shared) return;
      o.geometry?.dispose();
      if (o.material) { o.material.map?.dispose(); o.material.dispose(); }
    });
  }
}
