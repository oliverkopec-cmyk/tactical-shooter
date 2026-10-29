// Everything you hear besides gunshots and explosions: footsteps, landing,
// reloading, drone motors, gadgets being placed, wood and plaster breaking.
// Other players' sounds are derived from what the snapshots already tell us
// (speed, stance, reload state), so they cost no extra network traffic.
//
// Footsteps follow the spec: sprinting is loud and carries far, walking is
// moderate, crouch-walking is almost silent.

const STEP = {
  //            stride (m)  gain   range (m)
  sprint: { stride: 2.3, gain: 1.0, range: 42 },
  walk: { stride: 1.7, gain: 0.4, range: 14 },
  crouch: { stride: 1.2, gain: 0.07, range: 3.5 },
};

const SOUNDS = {
  stepWood: { noise: true, filter: 'bandpass', cutoff: 950, q: 1.3, dur: 0.07, gain: 0.55 },
  stepHollow: { noise: true, filter: 'bandpass', cutoff: 620, q: 1.1, dur: 0.09, gain: 0.55 },
  stepSoft: { noise: true, filter: 'lowpass', cutoff: 430, q: 0.7, dur: 0.1, gain: 0.6 },
  land: { noise: true, filter: 'lowpass', cutoff: 320, q: 0.8, dur: 0.22, gain: 0.95 },
  landThump: { wave: 'sine', freq: 90, freq2: 40, dur: 0.18, gain: 0.7 },
  reloadOut: { wave: 'square', freq: 900, freq2: 420, filter: 'lowpass', cutoff: 2600, dur: 0.06, gain: 0.16 },
  reloadIn: { noise: true, filter: 'bandpass', cutoff: 1700, q: 1.6, dur: 0.07, gain: 0.5 },
  reloadClack: { wave: 'square', freq: 320, freq2: 180, filter: 'lowpass', cutoff: 1800, dur: 0.08, gain: 0.2 },
  woodBreak: { noise: true, filter: 'lowpass', cutoff: 2400, q: 0.9, dur: 0.28, gain: 0.9 },
  woodThud: { wave: 'sine', freq: 170, freq2: 60, dur: 0.2, gain: 0.7 },
  crack: { noise: true, filter: 'lowpass', cutoff: 1700, q: 0.8, dur: 0.3, gain: 0.8 },
  crackThud: { wave: 'sine', freq: 110, freq2: 45, dur: 0.22, gain: 0.55 },
  motor: { wave: 'sawtooth', freq: 70, freq2: 95, filter: 'lowpass', cutoff: 520, q: 0.9, dur: 0.13, gain: 0.14 },
  whoosh: { noise: true, filter: 'bandpass', cutoff: 800, q: 0.6, dur: 0.16, gain: 0.45 },
  // gadgets being placed
  placeShield: { wave: 'square', freq: 150, freq2: 70, filter: 'lowpass', cutoff: 900, dur: 0.2, gain: 0.5 },
  placeWire: { noise: true, filter: 'highpass', cutoff: 3500, q: 0.8, dur: 0.18, gain: 0.45 },
  placeBeep: { wave: 'square', freq: 1500, freq2: 1500, filter: 'lowpass', cutoff: 4000, dur: 0.06, gain: 0.22 },
  placeClick: { wave: 'square', freq: 2600, freq2: 900, filter: 'lowpass', cutoff: 5000, dur: 0.04, gain: 0.24 },
  hammer: { noise: true, filter: 'bandpass', cutoff: 1100, q: 1.4, dur: 0.06, gain: 0.7 },
};

export class Soundscape {
  constructor(game) {
    this.game = game;
    this.audio = game.audio;
    this.own = { stride: 0, wasGround: true, vy: 0, wasReloading: false, ammo: 0 };
    this.remote = new Map();   // id -> { stride, wasGround, vy, wasReloading }
    this.drone = new Map();    // id -> time until the next motor blip
  }

  /** Play a named sound at a position, quieter and duller if walls or floors are in the way. */
  at(name, pos, range, gain = 1) {
    const spec = gain === 1 ? SOUNDS[name] : { ...SOUNDS[name], gain: SOUNDS[name].gain * gain };
    this.audio.play(spec, pos, this.game.listener(), range, this.game.soundClear(pos));
  }

  /** Play a named sound at your own ears. */
  self(name, gain = 1) {
    this.audio.play({ ...SOUNDS[name], gain: SOUNDS[name].gain * gain });
  }

  // ---------------------------------------------------------------- footsteps

  stepClass(speed, crouch, sprinting) {
    if (speed < 0.5) return null;
    if (crouch >= 0.5) return STEP.crouch;
    return sprinting || speed > 5 ? STEP.sprint : STEP.walk;
  }

  /** Floor type: wooden indoors, hollow upstairs, soft ground outside. */
  stepSound(x, y, z) {
    const indoors = Math.abs(x) < 12 && Math.abs(z) < 8;
    if (!indoors) return 'stepSoft';
    return y > 2.5 ? 'stepHollow' : 'stepWood';
  }

  // ---------------------------------------------------------------- per frame

  update(dt) {
    const g = this.game;
    if (!g.local) return;
    this.updateOwn(dt);
    this.updateRemotes(dt);
    this.updateDrones(dt);
  }

  updateOwn(dt) {
    const l = this.game.local, s = l.state, o = this.own;
    const active = l.alive && !l.droneState && !this.game.camView;
    const speed = Math.hypot(s.vx, s.vz);
    if (active && s.onGround) {
      const cls = this.stepClass(speed, Math.max(s.crouch, s.prone || 0), s.sprinting);
      if (cls) {
        o.stride += speed * dt;
        if (o.stride >= cls.stride) {
          o.stride = 0;
          this.self(this.stepSound(s.x, s.y, s.z), cls.gain * 0.6);   // your own steps are a little softer
        }
      }
    }
    if (active && s.onGround && !o.wasGround && o.vy < -5) {
      const k = Math.min(1, -o.vy / 12);
      this.self('land', k);
      this.self('landThump', k);
    }
    o.wasGround = s.onGround;
    o.vy = s.vy;

    const reloading = l.weapon.reload > 0;
    if (reloading && !o.wasReloading) this.self('reloadOut');
    if (!reloading && o.wasReloading && l.weapon.ammo > o.ammo) { this.self('reloadIn'); setTimeout(() => this.self('reloadClack'), 90); }
    o.wasReloading = reloading;
    o.ammo = l.weapon.ammo;
  }

  updateRemotes(dt) {
    for (const [id, r] of this.game.remotes) {
      if (!r.alive) { this.remote.delete(id); continue; }
      let st = this.remote.get(id);
      if (!st) { st = { stride: 0, wasGround: true, vy: 0, wasReloading: false }; this.remote.set(id, st); }
      const p = r.pose, pos = [p.x, p.y + 0.1, p.z];
      const cls = this.stepClass(r.speed, Math.max(p.crouch, p.prone || 0), r.speed > 5);
      if (cls && r.onGround) {
        st.stride += r.speed * dt;
        if (st.stride >= cls.stride) { st.stride = 0; this.at(this.stepSound(p.x, p.y, p.z), pos, cls.range, cls.gain); }
      }
      if (r.onGround && !st.wasGround && st.vy < -5) {
        const k = Math.min(1, -st.vy / 12);
        this.at('land', pos, 30, k);
        this.at('landThump', pos, 30, k);
      }
      st.wasGround = r.onGround;
      st.vy = r.vy;
      if (r.reloading && !st.wasReloading) this.at('reloadOut', [p.x, p.y + 1.1, p.z], 16);
      if (!r.reloading && st.wasReloading) { this.at('reloadIn', [p.x, p.y + 1.1, p.z], 16); }
      st.wasReloading = r.reloading;
    }
    for (const id of this.remote.keys()) if (!this.game.remotes.has(id)) this.remote.delete(id);
  }

  updateDrones(dt) {
    const myId = this.game.network.id;
    for (const [id, e] of this.game.drones.drones) {
      const t = e.target;
      const speed = Math.hypot(t.vx, t.vz);
      if (speed < 0.4 || t.j) { this.drone.set(id, 0); continue; }
      const wait = (this.drone.get(id) ?? 0) - dt;
      if (wait > 0) { this.drone.set(id, wait); continue; }
      this.drone.set(id, 0.17 / Math.min(1.6, speed / 3));
      if (t.o === myId && t.a) this.self('motor', 0.6);
      else this.at('motor', [e.mesh.position.x, e.mesh.position.y + 0.2, e.mesh.position.z], 16);
    }
  }

  // ---------------------------------------------------------------- events

  /** A gadget or charge appeared at pos. */
  placed(kind, pos) {
    const range = 22;
    if (kind === 'shield') this.at('placeShield', pos, range);
    else if (kind === 'wire') this.at('placeWire', pos, range);
    else if (kind === 'jammer') { this.at('placeBeep', pos, range); setTimeout(() => this.at('placeBeep', pos, range, 0.8), 90); }
    else if (kind === 'camera') this.at('placeClick', pos, range);
    else if (kind === 'barricade') for (let i = 0; i < 3; i++) setTimeout(() => this.at('hammer', pos, 26), i * 150);
    else this.at('placeBeep', pos, range);   // breach charge
  }

  woodBreak(pos) { this.at('woodBreak', pos, 32); this.at('woodThud', pos, 32); }

  plasterBreak(pos) { this.at('crack', pos, 34); this.at('crackThud', pos, 34); }

  melee(pos) { this.at('whoosh', pos, 14); }
}
