// The killcam: after you die, a 4 second replay of your death through the killer's eyes (their
// movement, aim and shots, with their gun, skin and charm), then normal spectating. Click or Space skips it.
// The server sends the last few seconds it recorded (server/killcam.js); nothing is recorded here.

import { getEyePosition } from '../../shared/movement.js';
import { LEAN_ROLL } from '../../shared/constants.js';
import { RemotePlayer } from './avatars.js';

const lerp = (a, b, k) => a + (b - a) * k;
const lerpAngle = (a, b, k) => { let d = (b - a) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return a + d * k; };

/** Interpolate a recorded trail [[t, x, y, z, yaw, pitch, crouch, prone, lean, flip], ...] at time t. */
function sample(trail, t) {
  if (!trail.length) return null;
  let a = trail[0], b = trail[0];
  if (t >= trail[trail.length - 1][0]) a = b = trail[trail.length - 1];
  else for (let i = trail.length - 1; i > 0; i--) if (trail[i - 1][0] <= t) { a = trail[i - 1]; b = trail[i]; break; }
  const k = b[0] > a[0] ? Math.max(0, Math.min(1, (t - a[0]) / (b[0] - a[0]))) : 0;
  return {
    x: lerp(a[1], b[1], k), y: lerp(a[2], b[2], k), z: lerp(a[3], b[3], k),
    yaw: lerpAngle(a[4], b[4], k), pitch: lerp(a[5], b[5], k),
    crouch: lerp(a[6], b[6], k), prone: lerp(a[7], b[7], k), lean: lerp(a[8], b[8], k), rapFlip: lerp(a[9] || 0, b[9] || 0, k),
    vx: 0, vz: 0, onGround: true, alive: true,
  };
}

export class Killcam {
  constructor(game, data) {
    this.game = game;
    this.data = data;
    this.start = Math.max(data.trail[0]?.[0] ?? -4000, -4000);   // 4 s back, or since the killer appeared
    this.end = 300;                        // a moment after the kill
    this.time = this.start;
    this.began = performance.now();      // real time drives it, so a slow frame rate can't stretch the replay
    this.nextShot = 0;
    this.done = false;
    // Your own body, as it was, so you see yourself go down
    this.victim = data.victimTrail.length ? new RemotePlayer(game.scene, { id: 'killcam-victim', name: '', team: data.victimTeam, skins: {} }, false) : null;
    if (this.victim) { this.victim.setOperator(data.victimOp); this.victim.label.visible = false; }
  }

  get duration() { return this.end - this.start; }

  /** Advance the replay and place the camera; returns false once it is over. */
  update(dt) {
    if (this.done) return false;
    const g = this.game, d = this.data;
    this.time = this.start + (performance.now() - this.began);
    if (this.time >= this.end) { this.finish(); return false; }
    const pose = sample(d.trail, this.time);
    if (pose) {
      const eye = getEyePosition(pose, g.world);
      g.camera.position.set(eye.x, eye.y, eye.z);
      g.camera.rotation.set(pose.pitch, pose.yaw, -eye.lean * LEAN_ROLL + (pose.rapFlip || 0) * Math.PI, 'YXZ');
    }
    // My own body until the moment I died
    if (this.victim) {
      const vp = sample(d.victimTrail, Math.min(this.time, -1));
      if (vp) { this.victim.buffer.length = 0; this.victim.push(0, { ...vp, alive: this.time < 0 }); this.victim.update(0, dt); }
    }
    // The killer's gun, firing on the recorded shots
    g.viewModel.visible = true;
    g.viewModel.setWeapon(d.weapon, d.skin, d.charm);
    while (this.nextShot < d.shots.length && d.shots[this.nextShot].t <= this.time) {
      const shot = d.shots[this.nextShot++];
      g.viewModel.fire(d.weapon);
      g.audio.shot(d.weapon, null, null);
      const from = [g.camera.position.x, g.camera.position.y - 0.12, g.camera.position.z];
      for (const end of shot.ends) g.effects.tracer(from, end);
    }
    g.viewModel.update(dt, { speed: 0, sprinting: false, crouch: pose?.crouch || 0, lean: pose?.lean || 0, reloadFrac: -1 });
    return true;
  }

  finish() {
    if (this.done) return;
    this.done = true;
    this.victim?.dispose();
    this.victim = null;
  }
}
