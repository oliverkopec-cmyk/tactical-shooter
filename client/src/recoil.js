// Your own recoil (Stage 2G), from each gun's settings in shared/gunConfig.js. Three separate things:
//
//   aim     where the gun now points. Every shot climbs it (more with each shot of a burst, and it never levels off) and
//           pushes it sideways along the gun's own pattern. The bullets go where the view points, so pulling the
//           mouse down really cancels the climb. Let go of the trigger and it settles back down.
//   punch   a quick extra snap of the camera that springs straight back (visual only)
//   shake   a short buzz of the camera (visual only)
//
// The kick of a shot is fed in over a few frames, so the view moves fast but not in one jump.

import { gunTuning } from '../../shared/gunConfig.js';

const DEG = Math.PI / 180;

/**
 * A gun's sideways pattern: for shot i, a value from -1 to 1. It is the same every time for the same gun (so it
 * can be learned): it leans one way for about `swing` shots, then the other, by an amount fixed per gun.
 */
const patterns = new Map();
function sideOf(id, i, swing) {
  let p = patterns.get(id);
  if (!p) {
    let a = 0;
    for (let k = 0; k < id.length; k++) a = (a * 31 + id.charCodeAt(k)) >>> 0;
    const rnd = () => { a = (a * 1664525 + 1013904223) >>> 0; return a / 4294967296; };
    const first = rnd() < 0.5 ? -1 : 1;
    p = { first, bend: Array.from({ length: 12 }, () => 0.55 + rnd() * 0.45) };
    patterns.set(id, p);
  }
  if (swing <= 1) return i === 0 ? p.first * 0.3 : (i % 2 ? -1 : 1) * p.first * p.bend[i % 12];
  const leg = Math.floor(i / swing), dir = leg % 2 ? -p.first : p.first;
  return dir * p.bend[leg % 12] * Math.sin(Math.min(1, (i % swing + 1) / swing) * Math.PI * 0.85 + 0.3);
}

export class Recoil {
  constructor() { this.reset(); }

  reset() {
    this.pitch = 0; this.yaw = 0;           // aim offset (radians): moves the bullets
    this.inP = 0; this.inY = 0;             // kick still being fed in
    this.punchP = 0; this.punchY = 0; this.punchVP = 0; this.punchVY = 0;   // camera snap spring (visual)
    this.shake = 0;
    this.shot = 0; this.lastShot = -1e9; this.gun = null;
  }

  /** One shot of gun `id`. stance: { ads 0..1, crouch 0..1 }. */
  fire(id, stance, att = null) {
    const rc = gunTuning(id, att).recoil, now = performance.now() / 1000;
    if (this.gun !== id || now - this.lastShot > rc.resetTime) this.shot = 0;
    this.gun = id;
    this.lastShot = now;
    const i = this.shot++;
    const mul = (1 - (1 - rc.aimMul) * (stance.ads || 0)) * (1 - (1 - rc.crouchMul) * (stance.crouch || 0));
    const grow = 1 + rc.upGrowth * Math.min(1, i / Math.max(1, rc.growShots));
    const rnd = () => (Math.random() * 2 - 1) * rc.jitter;
    const up = rc.up * grow * (i === 0 ? rc.firstMul : 1) + rnd() * 0.5, side = rc.side * sideOf(id, i, rc.swing) + rnd();
    this.inP += up * mul * DEG;
    this.inY -= side * mul * DEG;
    // Visual only: the camera snaps a bit further and springs back, and buzzes
    this.punchVP += rc.punch * mul * DEG * 26;
    this.punchVY += (Math.random() * 2 - 1) * rc.punch * 0.35 * DEG * 26;
    this.shake = Math.min(2.5, this.shake + rc.shake * 0.35);
  }

  /** Every frame. firing: the trigger is held. */
  update(dt, gunId, firing) {
    const rc = gunTuning(gunId || this.gun || 'rifle').recoil;
    // Feed in the kick (about 95% within 50 ms)
    const feed = 1 - Math.exp(-dt * 60);
    this.pitch += this.inP * feed; this.yaw += this.inY * feed;
    this.inP -= this.inP * feed; this.inY -= this.inY * feed;
    // Settle back to where you aimed: slowly while still firing, quickly after
    const back = 1 - Math.exp(-dt * (firing ? rc.returnWhileFiring : rc.returnSpeed));
    this.pitch -= this.pitch * back; this.yaw -= this.yaw * back;
    // Camera snap: a stiff, well damped spring
    const k = 320, c = 30, h = Math.min(dt, 0.05);
    this.punchVP += (-k * this.punchP - c * this.punchVP) * h; this.punchP += this.punchVP * h;
    this.punchVY += (-k * this.punchY - c * this.punchVY) * h; this.punchY += this.punchVY * h;
    this.shake = Math.max(0, this.shake - this.shake * Math.min(1, dt * 10) - dt * 0.08);
  }

  /** Extra camera rotation this frame that doesn't move the bullets: { pitch, yaw, roll } in radians. */
  view() {
    let p = this.punchP, y = this.punchY, r = 0;
    if (this.shake > 0.001) {
      const t = performance.now() / 1000, a = this.shake * 0.25 * DEG;
      p += Math.sin(t * 71) * a; y += Math.sin(t * 53 + 1.7) * a; r = Math.sin(t * 61 + 0.6) * a * 1.8;
    }
    return { pitch: p, yaw: y, roll: r };
  }
}
