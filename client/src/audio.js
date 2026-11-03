// Synthesised sound effects (no audio files). Gunshots are filtered noise bursts,
// panned and attenuated by distance from the listener.

import { GunSounds } from './gunSounds.js';

/** A made-up room: decaying noise, stereo, getting duller as it fades (`dark` 0..1: how fast the highs die). */
function makeImpulse(ctx, seconds, decay, dark) {
  const len = Math.floor(ctx.sampleRate * seconds), buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const k = i / len, a = 1 - Math.min(0.97, dark * (0.3 + k * 1.2));
      lp += (Math.random() * 2 - 1 - lp) * a;
      d[i] = lp * Math.pow(1 - k, decay) * (i < 90 ? i / 90 : 1);
    }
  }
  return buf;
}

export class Audio {
  constructor(volume = 0.5) {
    this.volume = volume;
    this.ctx = null;
    this.noise = null;
    this.guns = new GunSounds(this);
    const unlock = () => this.ensure();
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  ensure() {
    if (!this.ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return null;
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate * 0.5;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      // Two rooms for gunshots to echo in: a short boomy one indoors, a long thin one outdoors
      this.sends = {};
      for (const [name, secs, decay, dark, wet] of [['indoor', 0.7, 3.2, 0.5, 1.0], ['outdoor', 2.2, 2.6, 0.75, 0.6]]) {
        const conv = this.ctx.createConvolver();
        conv.buffer = makeImpulse(this.ctx, secs, decay, dark);
        const out = this.ctx.createGain();
        out.gain.value = wet;
        const send = this.ctx.createGain();
        send.connect(conv).connect(out).connect(this.master);
        this.sends[name] = send;
      }
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }

  /** A gunshot (see GunSounds in gunSounds.js). pos null = your own gun. env: { lisIn, srcIn, clear }. */
  shot(weaponId, pos, listener, env = {}) { this.guns.shot(weaponId, pos, listener, env); }

  /** Pulling the trigger on an empty gun. */
  dry() { this.guns.dry(); }

  /** After a shot: bolt, pump or hammer (if the gun has one). */
  mech(weaponId, pos = null, listener = null, clear = true) { this.guns.after(weaponId, pos, listener, clear); }

  beep(freq, duration, volume = 0.2, type = 'square') {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(volume, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + duration);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + duration + 0.02);
  }

  /** Low rumbling boom: long filtered noise plus a falling sine thump. */
  explosion(pos, listener) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    let gain = 1.0;
    if (pos && listener) gain /= 1 + Math.hypot(pos[0] - listener.x, pos[2] - listener.z) * 0.06;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(1200, t);
    filter.frequency.exponentialRampToValueAtTime(60, t + 0.45);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.48);
    src.connect(filter).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + 0.5);
    const osc = ctx.createOscillator();
    osc.frequency.setValueAtTime(110, t);
    osc.frequency.exponentialRampToValueAtTime(30, t + 0.4);
    const og = ctx.createGain();
    og.gain.setValueAtTime(gain * 0.8, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
    osc.connect(og).connect(this.master);
    osc.start(t);
    osc.stop(t + 0.5);
  }

  /**
   * Where a sound comes from, as the listener hears it: loudness falls off with
   * distance and is zero beyond `range`, panning follows the listener's facing, and
   * sounds on another floor or behind walls are quieter and duller.
   */
  spatialParams(pos, listener, range, clear = true) {
    if (!pos || !listener) return { gain: 1, pan: 0, muffle: 1 };
    const dx = pos[0] - listener.x, dz = pos[2] - listener.z;
    const flat = Math.hypot(dx, dz);
    const dy = Math.abs(pos[1] - (listener.y ?? pos[1]));
    const dist = flat + (dy > 2.4 ? 6 : dy * 0.5);   // another floor counts as further away
    if (dist >= range) return null;
    const fall = Math.pow(1 - dist / range, 1.6);
    const side = flat > 0.1 ? (dx * Math.cos(listener.yaw) - dz * Math.sin(listener.yaw)) / flat : 0;
    return {
      gain: fall * (clear ? 1 : 0.55),
      pan: Math.max(-1, Math.min(1, side)) * Math.min(1, flat / 1.5),
      muffle: (1 - 0.55 * (dist / range)) * (clear ? 1 : 0.45) * (dy > 2.4 ? 0.7 : 1),
    };
  }

  /**
   * Play a synthesised sound. spec: { noise | wave+freq(+freq2), filter, cutoff, q, dur, gain }.
   * Pass pos/listener/range for a positional sound; omit pos for one at your own ears.
   */
  play(spec, pos = null, listener = null, range = 20, clear = true) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const sp = this.spatialParams(pos, listener, range, clear);
    if (!sp) return;
    const vol = (spec.gain ?? 0.3) * sp.gain;
    if (vol < 0.003) return;
    const t = ctx.currentTime;
    let src;
    if (spec.noise) {
      src = ctx.createBufferSource();
      src.buffer = this.noise;
    } else {
      src = ctx.createOscillator();
      src.type = spec.wave || 'sine';
      src.frequency.setValueAtTime(spec.freq, t);
      if (spec.freq2) src.frequency.exponentialRampToValueAtTime(spec.freq2, t + spec.dur);
    }
    const filter = ctx.createBiquadFilter();
    filter.type = spec.filter || 'lowpass';
    filter.frequency.value = Math.max(120, (spec.cutoff || 3000) * sp.muffle);
    filter.Q.value = spec.q || 0.8;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + spec.dur);
    const panner = ctx.createStereoPanner();
    panner.pan.value = sp.pan;
    src.connect(filter).connect(g).connect(panner).connect(this.master);
    src.start(t);
    src.stop(t + spec.dur + 0.03);
  }

  clank() { this.beep(180, 0.12, 0.2, 'square'); setTimeout(() => this.beep(140, 0.15, 0.2, 'square'), 90); }

  hit(head) { this.beep(head ? 1800 : 1100, 0.06, 0.12, 'triangle'); }
  kill() { this.beep(660, 0.09, 0.15, 'triangle'); setTimeout(() => this.beep(990, 0.12, 0.15, 'triangle'), 70); }
  hurt() { this.beep(120, 0.15, 0.3, 'sawtooth'); }
  click() { this.beep(2400, 0.02, 0.08); }
  reload() { this.beep(500, 0.05, 0.1); setTimeout(() => this.beep(800, 0.05, 0.1), 160); }
}
