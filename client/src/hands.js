// First-person arms and gloved hands (Stage 2H), built from boxes in code: no external assets.
//
// Two hands, each a glove (palm, a knuckle pad, four fingers of three joints and a two-joint thumb, and a cuff
// in the operator's colour) on a sleeve (the team's colour). A hand is placed on the gun by a POSE: where its
// palm is (in the gun's own space), which way it faces, and how far each finger curls. Poses come from the
// gun's own parts (the rear hand wraps the grip with the index finger by the trigger; the other hand wraps the
// foregrip, cups the pump or handguard from below, or, on pistols, wraps over the first hand).
// The arms are two-bone IK from a fixed shoulder below the camera to each wrist.
//
// Animations (driven by ViewModel in weapons.js): reloading (the support hand goes to the magazine, pulls it
// out, brings a new one and pushes it in; on shotguns it feeds shells; on revolvers it works the cylinder),
// drawing a gun, throwing a utility, placing a gadget, melee and holding a grenade.

import * as THREE from 'three';

const GLOVE = 0x1c1f23, PAD = 0x2a2e34;
const SEG = [0.03, 0.026, 0.02];            // finger joint lengths
const CURL = [1.15, 1.25, 0.95];            // how far each joint bends at full curl (radians)
const WRIST = -0.052;                       // wrist, below the palm centre along the hand (y)

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const geos = new Map();
const segGeo = (len, w = 0.016, d = 0.016) => {
  const k = `${len}|${w}|${d}`;
  if (!geos.has(k)) geos.set(k, new THREE.BoxGeometry(w, len, d).translate(0, len / 2, 0));
  return geos.get(k);
};

/** The rotation of a hand whose local axes (x: across the knuckles, y: along the fingers, z: back of the hand) are these gun-space directions. */
function basis(x, y, z, mirror) {
  const m = new THREE.Matrix4().makeBasis(mirror ? x.clone().negate() : x, y, z);
  return new THREE.Quaternion().setFromRotationMatrix(m);
}

// ---------------------------------------------------------------- one hand

class Hand {
  constructor(mirror, mats) {
    this.mirror = mirror;                      // true: a left hand (the geometry is a right hand, flipped)
    this.root = new THREE.Group();
    const g = this.root;
    const palm = new THREE.Mesh(segGeo(0.056, 0.07, 0.03).clone().translate(0, -0.028, 0), mats.glove);
    const pad = new THREE.Mesh(segGeo(0.04, 0.066, 0.008).clone().translate(0, -0.02, 0), mats.pad);
    pad.position.z = 0.019;
    const cuff = new THREE.Mesh(segGeo(0.03, 0.078, 0.04), mats.cuff);
    cuff.position.y = WRIST - 0.002;
    g.add(palm, pad, cuff);
    this.cuff = cuff;
    this.fingers = [-0.0262, -0.0087, 0.0087, 0.0262].map((x, i) => {
      const chain = [], root = new THREE.Group();
      root.position.set(x, 0.028, 0);
      let parent = root;
      for (let j = 0; j < 3; j++) {
        const joint = new THREE.Group();
        if (j) joint.position.y = SEG[j - 1] * (i === 3 ? 0.85 : 1);
        parent.add(joint);
        joint.add(new THREE.Mesh(segGeo(SEG[j] * (i === 3 ? 0.85 : i === 0 || i === 2 ? 0.96 : 1.04), 0.0165 - j * 0.0008, 0.0165 - j * 0.0008), mats.glove));
        chain.push(joint);
        parent = joint;
      }
      g.add(root);
      return chain;
    });
    // The thumb: on the index finger's side, two joints, angled out from the palm
    this.thumbRoot = new THREE.Group();
    this.thumbRoot.position.set(-0.034, -0.02, -0.004);
    this.thumbRoot.rotation.z = 0.5;
    const t1 = new THREE.Group(), t2 = new THREE.Group();
    t1.add(new THREE.Mesh(segGeo(0.032, 0.02, 0.019), mats.glove));
    t2.position.y = 0.032;
    t2.add(new THREE.Mesh(segGeo(0.026, 0.018, 0.017), mats.glove));
    t1.add(t2);
    this.thumbRoot.add(t1);
    this.thumb = [t1, t2];
    g.add(this.thumbRoot);
    this.curl = [0, 0, 0, 0, 0];
    this.setCurl([0.4, 0.4, 0.4, 0.4, 0.3]);
    // the pose it is in now (position and rotation in its parent's space)
    this.p = V(); this.q = new THREE.Quaternion();
  }

  /** curl: [index, middle, ring, pinky, thumb], 0 straight .. 1 fully closed. */
  setCurl(c) {
    for (let i = 0; i < 4; i++) {
      this.curl[i] = c[i];
      const k = c[i];
      this.fingers[i].forEach((j, n) => { j.rotation.x = -CURL[n] * k * (n === 0 ? 0.75 : 1); });
    }
    this.curl[4] = c[4];
    this.thumb[0].rotation.set(-0.5 * c[4], 0, 0);
    this.thumb[1].rotation.x = -0.9 * c[4];
  }

  /** Put it at p / q in its current parent (flipped for a left hand), scaled to undo the parent's scale. */
  place(p, q, parentScale = 1) {
    this.p.copy(p); this.q.copy(q);
    this.root.position.copy(p);
    this.root.quaternion.copy(q);
    this.root.scale.set((this.mirror ? -1 : 1) / parentScale, 1 / parentScale, 1 / parentScale);
  }

  wristWorld(out) {
    this.root.updateMatrixWorld(true);
    return this.root.localToWorld(out.set(0, WRIST - 0.016, 0));
  }
}

// ---------------------------------------------------------------- an arm: two-bone IK from the shoulder to the wrist

const L1 = 0.36, L2 = 0.34;
const _d = V(), _e = V(), _pole = V(), _perp = V();

class Arm {
  constructor(side, mats) {
    this.side = side;                          // 1 right, -1 left
    this.shoulder = V(side * 0.3, -0.6, 0.18);
    // A segment is a box along +z, which lookAt() aims at its target
    this.upper = new THREE.Mesh(undefined, mats.sleeve);
    this.fore = new THREE.Mesh(undefined, mats.sleeve);
    this.upper.geometry = new THREE.BoxGeometry(0.075, 0.075, 1).translate(0, 0, 0.5);
    this.fore.geometry = new THREE.BoxGeometry(0.062, 0.062, 1).translate(0, 0, 0.5);
    this.band = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 0.022), mats.cuff);
    this.group = new THREE.Group();
    this.group.add(this.upper, this.fore, this.band);
  }

  /** Reach the wrist at w; the elbow bends down and outwards. */
  solve(w) {
    const s = this.shoulder;
    _d.copy(w).sub(s);
    let dist = _d.length();
    const reach = L1 + L2 - 0.01;
    const sh = s.clone();
    if (dist > reach) { sh.copy(w).addScaledVector(_d.normalize(), -reach); dist = reach; }   // too far: the shoulder follows
    _d.copy(w).sub(sh).normalize();
    const a = (L1 * L1 - L2 * L2 + dist * dist) / (2 * dist), h = Math.sqrt(Math.max(0, L1 * L1 - a * a));
    _pole.set(this.side * 0.5, -1, 0.35);
    _perp.copy(_pole).addScaledVector(_d, -_pole.dot(_d)).normalize();
    _e.copy(sh).addScaledVector(_d, a).addScaledVector(_perp, h);
    this.upper.position.copy(sh);
    this.upper.scale.set(1, 1, sh.distanceTo(_e));
    this.upper.lookAt(_e);
    this.fore.position.copy(_e);
    this.fore.scale.set(1, 1, _e.distanceTo(w) + 0.02);
    this.fore.lookAt(w);
    this.band.position.copy(w).addScaledVector(_d, 0).addScaledVector(_e.clone().sub(w).normalize(), 0.0);
    this.band.lookAt(_e);
  }
}

// ---------------------------------------------------------------- the pair

const X = V(1, 0, 0), Y = V(0, 1, 0), Z = V(0, 0, 1);
const nX = V(-1, 0, 0), nY = V(0, -1, 0), nZ = V(0, 0, -1);

// Basis of a hand (x across the knuckles, y along the fingers, z the back of the hand), in gun space:
// rear: palm on the right of a vertical grip, fingers wrapping round its front; index on top.
const Q_RIGHT_GRIP = basis(nY, nZ, X, false);
// left side-wrap: palm on the left of a vertical grip, fingers wrapping round the front towards the right
const Q_LEFT_GRIP = basis(nY, nZ, nX, true);
// left cup: palm up under a handguard / pump / the magazine, fingers going right and curling up its far side
const Q_LEFT_CUP = basis(Z, X, nY, true);

const ease = (t) => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;
const seg = (f, a, b) => ease((f - a) / (b - a));      // 0 before a, 1 after b

export class Hands {
  constructor(scene) {
    this.scene = scene;
    this.mats = {
      glove: new THREE.MeshStandardMaterial({ color: GLOVE, roughness: 0.85 }),
      pad: new THREE.MeshStandardMaterial({ color: PAD, roughness: 0.6, metalness: 0.2 }),
      sleeve: new THREE.MeshStandardMaterial({ color: 0x556070, roughness: 0.8 }),
      cuff: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 }),
    };
    this.right = new Hand(false, this.mats);
    this.left = new Hand(true, this.mats);
    this.arms = [new Arm(1, this.mats), new Arm(-1, this.mats)];
    this.root = new THREE.Group();
    this.root.add(this.arms[0].group, this.arms[1].group);
    scene.add(this.root);
    // A grenade the right hand holds before throwing
    this.grenade = new THREE.Group();
    this.grenadeMat = new THREE.MeshStandardMaterial({ color: 0x4a5a3a, roughness: 0.5, metalness: 0.3 });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.07, 14), this.grenadeMat);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.02, 10), this.mats.pad);
    cap.position.y = 0.045;
    const lever = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.06, 0.012), this.mats.pad);
    lever.position.set(0.03, 0.01, 0);
    this.grenade.add(body, cap, lever);
    this.grenade.position.set(0, 0.03, -0.034);
    this.grenade.scale.setScalar(0.85);
    this.grenade.visible = false;
    this.right.root.add(this.grenade);
    this.anchors = null;
    this.gun = null;
    this.wrist = V();
  }

  /** Outfit colours: sleeves in the team's colour, gloves and cuffs in the operator's (darker on the palm and fingers). */
  setOutfit(teamColor, opColor) {
    if (this.outfitKey === `${teamColor}|${opColor}`) return;
    this.outfitKey = `${teamColor}|${opColor}`;
    const m = this.mats, dark = new THREE.Color(0x15171a);
    m.sleeve.color.setHex(teamColor).multiplyScalar(0.6);
    m.glove.color.setHex(opColor).lerp(dark, 0.72);          // dark gloves with a tint of the operator's colour
    m.pad.color.setHex(opColor).lerp(dark, 0.3);             // knuckle pads and finger tips
    m.cuff.color.setHex(opColor);
  }

  /** A gun was drawn: find where the hands go on it. `model`: the gun's model type (pistols are held with both hands). */
  setGun(gun, model) {
    this.gun = gun;
    for (const h of [this.right, this.left]) h.root.removeFromParent();
    const parts = gun?.userData.parts || {};
    const names = Object.keys(parts);
    const find = (prefix) => names.filter((n) => n.startsWith(prefix)).flatMap((n) => parts[n]);
    const box = (meshes) => {
      const b = new THREE.Box3();
      for (const m of meshes) {
        m.geometry.computeBoundingBox();
        const bb = m.geometry.boundingBox.clone(), off = m.parent === gun ? V() : m.parent.position;
        bb.translate(m.position).translate(off);
        b.union(bb);
      }
      return b;
    };
    const grip = find('grip.main');
    if (!gun || !grip.length) { this.anchors = null; return; }
    const gb = box(grip), gc = gb.getCenter(V()), gs = gb.getSize(V());
    const a = { grip: gc, gripW: gs.x / 2, gripH: gs.y, scale: gun.scale.x || 1, model };
    const twoHand = ['pistol', 'revolver', 'machinePistol'].includes(model);
    const sidePart = twoHand ? [] : find('foregrip');
    const underPart = twoHand ? [] : [...find('pump.main'), ...find('handguard.main'), ...find('shroud.main')];
    if (twoHand) a.support = { kind: 'cup', c: gc.clone().add(V(-(a.gripW + 0.016), -0.026, -0.004)) };
    else if (sidePart.length) { const b = box(sidePart), c = b.getCenter(V()); a.support = { kind: 'side', c: c.add(V(-(b.getSize(V()).x / 2 + 0.016), 0, 0)) }; }
    else if (underPart.length) { const b = box(underPart), c = b.getCenter(V()), s = b.getSize(V()); a.support = { kind: 'under', c: V(c.x - 0.012, b.min.y - 0.018, c.z), w: s.x }; }
    else a.support = { kind: 'under', c: V(0, -0.05, -0.25), w: 0.05 };
    // The magazine (for reloads): where the support hand goes
    const mag = gun.userData.anim?.mag, cyl = gun.userData.anim?.cylinder, pump = gun.userData.anim?.pump;
    a.mag = mag || null; a.cylinder = cyl || null; a.pump = pump || null;
    this.anchors = a;
    gun.add(this.right.root, this.left.root);
  }

  /** The rest poses on the gun: { p, q, curl } for each hand. */
  rest() {
    const a = this.anchors;
    const right = { p: a.grip.clone().add(V(a.gripW + 0.016, 0.004, 0)), q: Q_RIGHT_GRIP, curl: [0.12, 0.85, 0.9, 0.95, 0.55] };   // index near the trigger, the rest closed round the grip
    let left;
    const s = a.support;
    if (s.kind === 'cup') left = { p: s.c.clone(), q: Q_LEFT_GRIP, curl: [0.85, 0.9, 0.9, 0.9, 0.2] };
    else if (s.kind === 'side') left = { p: s.c.clone(), q: Q_LEFT_GRIP, curl: [0.8, 0.9, 0.9, 0.9, 0.5] };
    else left = { p: s.c.clone().add(V(-0.022, 0.014, 0)), q: new THREE.Quaternion().setFromAxisAngle(Z, -0.5).multiply(Q_LEFT_CUP), curl: [0.5, 0.7, 0.8, 0.9, 0.3] };   // tilted to show the back of the hand and the thumb on the left
    return { right, left };
  }

  /**
   * ctx: { reload (0..1 or -1), swing (0..1 melee), throwT (0..1 or -1), place (item group or null), placeAmt, gunHidden }
   * The view model has already placed the gun this frame.
   */
  update(dt, ctx) {
    const show = !!this.anchors && !ctx.hidden;
    this.root.visible = show;
    this.right.root.visible = this.left.root.visible = show;
    if (!show) return;
    const a = this.anchors, rest = this.rest(), gun = this.gun, sc = a.scale;
    let L = { p: rest.left.p.clone(), q: rest.left.q, curl: rest.left.curl.slice() };
    let R = { p: rest.right.p.clone(), q: rest.right.q, curl: rest.right.curl.slice() };

    // Pulling the trigger: the index finger squeezes in for a moment
    if (ctx.kick > 0.1) R.curl[0] = lerp(R.curl[0], 0.7, ctx.kick);

    // Melee: the support hand lets go and comes back towards the body while the gun is thrust out
    if (ctx.swing > 0) { L.p.add(V(0.06, -0.04, 0.12).multiplyScalar(ctx.swing)); L.curl = L.curl.map((c) => lerp(c, 0.2, ctx.swing)); }

    // Reloading
    if (ctx.reload >= 0) this.reloadPose(ctx.reload, L, R, rest);

    for (const h of [this.right, this.left]) { if (h.root.parent !== gun) gun.add(h.root); h.free = false; }   // back on the gun, then maybe off again below
    this.right.place(R.p, R.q, sc); this.right.setCurl(R.curl);
    this.left.place(L.p, L.q, sc); this.left.setCurl(L.curl);
    gun.updateMatrixWorld(true);

    // Hands that leave the gun: throwing (the right hand takes a grenade, winds up and throws) and placing
    // (both hands hold the item). They blend from where they are on the gun to a pose in the view.
    this.grenade.visible = false;
    if (ctx.throwT >= 0) this.throwPose(ctx.throwT, ctx.throwColor);
    if (ctx.placeItem && ctx.placeAmt > 0.02) this.placePose(ctx.placeItem, ctx.placeAmt);

    // The arms: from the shoulders to the wrists
    this.scene.updateMatrixWorld(true);
    this.arms[0].solve(this.right.wristWorld(this.wrist));
    this.arms[1].solve(this.left.wristWorld(this.wrist));
  }

  /**
   * Take a hand off the gun to the pose (p, q) in the view, blended by w (0 = where it is on the gun, 1 = there).
   * The hand is re-parented to the scene, at normal size.
   */
  freeHand(hand, p, q, w, curl) {
    const from = new THREE.Vector3(), fq = new THREE.Quaternion(), fs = new THREE.Vector3();
    hand.root.updateMatrixWorld(true);
    hand.root.matrixWorld.decompose(from, fq, fs);
    const keep = hand.curl.slice();
    this.scene.add(hand.root);                       // (leaves the gun)
    hand.free = true;
    hand.root.position.copy(from).lerp(p, w);
    hand.root.quaternion.copy(fq).slerp(q, w);
    hand.root.scale.set(hand.mirror ? -1 : 1, 1, 1);
    hand.setCurl(keep.map((c, i) => lerp(c, curl[i], w)));
  }

  /** Throwing a utility: t runs 0..1. The right hand takes a grenade, winds up, throws and returns. */
  throwPose(t, color) {
    const grab = V(0.15, -0.1, -0.42), back = V(0.2, -0.02, -0.28), out = V(0.08, -0.04, -0.7);
    const Qhold = basis(nX, nZ, nY, false), Qback = basis(nX, nZ, nY, false).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0.7, 0, 0)));
    const Qout = Qhold.clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.5, 0, 0)));
    const wIn = seg(t, 0, 0.22), wOut = 1 - seg(t, 0.82, 1);
    const w = Math.min(wIn, wOut);
    let p = grab.clone(), q = Qhold.clone();
    if (t >= 0.28 && t < 0.5) { const k = seg(t, 0.28, 0.5); p.lerp(back, k); q.slerp(Qback, k); }
    if (t >= 0.5) { const k = seg(t, 0.5, 0.7); p.copy(back).lerp(out, k); q.copy(Qback).slerp(Qout, k); }
    this.freeHand(this.right, p, q, w, t < 0.7 ? [0.7, 0.7, 0.7, 0.7, 0.55] : [0.1, 0.1, 0.1, 0.1, 0.1]);
    this.grenade.visible = t > 0.1 && t < 0.7;
    if (color !== undefined) this.grenadeMat.color.setHex(color);
  }

  /** Placing a gadget: both hands hold the item (a group in the view), on its two sides. */
  placePose(item, amt) {
    const side = (s) => item.localToWorld(V(s * 0.085, 0, 0.0));
    const iq = item.getWorldQuaternion(new THREE.Quaternion());
    this.freeHand(this.right, side(1), iq.clone().multiply(Q_RIGHT_GRIP), amt, [0.2, 0.6, 0.65, 0.7, 0.5]);
    this.freeHand(this.left, side(-1), iq.clone().multiply(Q_LEFT_GRIP), amt, [0.2, 0.6, 0.65, 0.7, 0.5]);
  }

  /** Move the support hand (L) through a reload; f runs 0..1 over the reload time. */
  reloadPose(f, L, R, rest) {
    const a = this.anchors;
    if (a.mag) {
      const m = a.mag.userData.base;
      const grab = V(m.x, a.mag.position.y - 0.07 + (a.model === 'lmg' ? -0.02 : 0), a.mag.position.z - 0.01);
      const away = V(-0.18, -0.34, a.mag.position.z + 0.08);
      const toMag = seg(f, 0.0, 0.14), off = seg(f, 0.33, 0.5), back = seg(f, 0.52, 0.66), home = seg(f, 0.9, 1.0);
      let p = rest.left.p.clone();
      p = p.lerp(grab, toMag);                       // the hand goes to the magazine
      p = p.lerp(away, off);                         // pulls it out and away: it's tossed down and a fresh one fetched
      p = p.lerp(grab, back);                        // brings the new one back to the well
      p = p.lerp(rest.left.p, home);                 // and goes back to the front of the gun
      if (f > 0.14 && f < 0.33) p.y = a.mag.position.y - 0.07;     // while pulling, it follows the magazine out
      if (f > 0.66 && f < 0.9) p.y = a.mag.position.y - 0.07;
      L.p.copy(p);
      const cup = Math.max(toMag * (1 - off), back * (1 - home));
      L.q = rest.left.q.clone().slerp(Q_LEFT_CUP, cup);
      L.curl = rest.left.curl.map((c, i) => lerp(c, [0.35, 0.5, 0.55, 0.6, 0.2][i], cup));
      a.mag.visible = !(f > 0.4 && f < 0.5);        // between the old magazine going and the new one arriving
    } else if (a.pump) {
      // Shotgun: the hand reaches under the gun and feeds shells in, over and over, then racks the pump
      const to = seg(f, 0, 0.1), home = seg(f, 0.88, 1);
      const port = V(0, -0.1, 0.02);
      const feed = f > 0.1 && f < 0.88 ? Math.pow(Math.max(0, Math.sin(((f - 0.1) / 0.78) * Math.PI * 5)), 0.6) : 0;
      let p = rest.left.p.clone().lerp(port, to * (1 - home));
      p.add(V(0.0, 0.04 * feed, 0.0).multiplyScalar(to));
      L.p.copy(p);
      L.q = rest.left.q.clone().slerp(Q_LEFT_CUP, to * (1 - home));
      L.curl = rest.left.curl.map((c, i) => lerp(c, [0.6, 0.7, 0.7, 0.7, 0.6][i], to * (1 - home)));
    } else if (a.cylinder) {
      // Revolver: the left hand pushes the cylinder out, dumps and reloads it, and snaps it shut
      const side = V(-0.07, a.cylinder.position.y - 0.01, a.cylinder.position.z);
      const to = seg(f, 0, 0.12), home = seg(f, 0.88, 1);
      const wiggle = f > 0.3 && f < 0.8 ? Math.sin(f * 40) * 0.012 : 0;
      L.p.copy(rest.left.p.clone().lerp(side, to * (1 - home))).add(V(0, wiggle, 0));
      L.curl = rest.left.curl.map((c) => lerp(c, 0.5, to * (1 - home)));
    }
  }

}
