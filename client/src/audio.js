// Synthesised sound effects (no audio files). Gunshots are filtered noise bursts,
// panned and attenuated by distance from the listener.

import { gunTuning } from '../../shared/gunConfig.js';

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
      for (const [name, secs, decay, dark, wet] of [['indoor', 0.5, 3, 0.55, 0.9], ['outdoor', 1.7, 2.2, 0.8, 0.5]]) {
        const conv = this.ctx.createConvolver();
        conv.buffer = makeImpulse(this.ctx, secs, decay, dark);
        const out = this.ctx.createGain();
        out.gain.value = wet;
        const send = this.ctx.createGain();
        send.connect(conv).connect(out).connect(this.master);
        this.sends[name] = send;
      }
      this.shotTimes = [];
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }

  /**
   * A gunshot, built from layers (a sharp crack, the body of the bang, a low thump) plus an echo, from the gun's
   * sound settings in shared/gunConfig.js. pos / listener: where it is and who hears it (null pos = your own gun).
   * env: { lisIn, srcIn, clear }: listener and gun indoors, and no wall between them. Close up the crack
   * dominates; further away it fades and the echo takes over (and arrives a little later, like real sound).
   * Indoors everything is duller with a short room echo; outdoors it is crisp with a long thin one.
   */
  shot(weaponId, pos, listener, env = {}) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const now = performance.now();
    this.shotTimes = this.shotTimes.filter((x) => now - x < 100);
    if (this.shotTimes.length > 22) return;          // a firefight can't flood the audio graph
    this.shotTimes.push(now);
    const s = gunTuning(weaponId).sound;
    const clear = env.clear !== false, lisIn = !!env.lisIn, srcIn = pos ? !!env.srcIn : lisIn;
    let dist = 0, pan = 0;
    if (pos && listener) {
      const dx = pos[0] - listener.x, dz = pos[2] - listener.z;
      dist = Math.hypot(dx, dz, (pos[1] - (listener.y ?? pos[1])) * 0.5);
      pan = dist > 0.1 ? Math.max(-1, Math.min(1, (dx * Math.cos(listener.yaw) - dz * Math.sin(listener.yaw)) / dist)) : 0;
    }
    if (dist > 120) return;
    const inside = lisIn && srcIn, mixed = lisIn !== srcIn;
    const near = 1 / (1 + dist * 0.12);                                   // 1 up close, falling quickly: the crack
    const gain = s.volume * (pos ? 1 / (1 + dist * 0.07) : 1) * (clear ? 1 : 0.6) * (mixed ? 0.7 : 1);
    const muffle = (1 / (1 + dist * 0.03)) * (clear ? 1 : 0.45) * (inside ? 0.55 : mixed ? 0.5 : 1);   // duller indoors, behind walls, far away
    const t = ctx.currentTime + Math.min(0.3, dist / 343);
    const mix = ctx.createGain();
    mix.gain.value = 0.9 * gain;
    const panner = ctx.createStereoPanner();
    panner.pan.value = pan;
    mix.connect(panner).connect(this.master);
    const echo = ctx.createGain();
    echo.gain.value = s.tail * (0.22 + Math.min(0.6, dist / 45)) * (inside ? 1.1 : 1);
    mix.connect(echo).connect(inside || (lisIn && !pos) ? this.sends.indoor : this.sends.outdoor);

    const noiseLayer = (type, freq, freq2, q, decay, vol) => {
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      src.playbackRate.value = 0.85 + Math.random() * 0.3;
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.Q.value = q;
      f.frequency.setValueAtTime(Math.max(120, freq * muffle), t);
      if (freq2) f.frequency.exponentialRampToValueAtTime(Math.max(90, freq2 * muffle), t + decay);
      const g = ctx.createGain();
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + decay);
      src.connect(f).connect(g).connect(mix);
      src.start(t, Math.random() * 0.2);
      src.stop(t + decay + 0.05);
    };
    if (dist < 40) noiseLayer('bandpass', s.crackFreq, s.crackFreq * 0.5, 0.9, s.crackDecay, s.crackGain * near);
    noiseLayer('lowpass', s.bodyFreq * 3, s.bodyFreq * 0.2, 0.8, s.bodyDecay, s.bodyGain);
    if (dist < 60) {
      const o = ctx.createOscillator();
      o.frequency.setValueAtTime(s.thumpFreq, t);
      o.frequency.exponentialRampToValueAtTime(s.thumpFreq * 0.45, t + s.thumpDecay);
      const g = ctx.createGain();
      g.gain.setValueAtTime(s.thumpGain * (inside ? 0.8 : 1), t);
      g.gain.exponentialRampToValueAtTime(0.001, t + s.thumpDecay);
      o.connect(g).connect(mix);
      o.start(t);
      o.stop(t + s.thumpDecay + 0.03);
    }
  }

  /** The click of pulling the trigger on an empty gun. */
  dry(weaponId) {
    const heavy = ['lmg', 'shotgun', 'dmr', 'revolver'].includes(gunTuning(weaponId).type);
    this.play({ wave: 'square', freq: heavy ? 1100 : 1900, freq2: heavy ? 500 : 800, filter: 'lowpass', cutoff: 4500, dur: 0.035, gain: 0.22 });
    setTimeout(() => this.play({ noise: true, filter: 'bandpass', cutoff: heavy ? 1300 : 2200, q: 2, dur: 0.03, gain: 0.25 }), 25);
  }

  /** What a gun does after a shot: a bolt worked, a pump racked, a hammer cocked (a short mechanical double click). */
  mech(weaponId, pos = null, listener = null, clear = true) {
    const m = gunTuning(weaponId).sound.mech;
    if (m === 'none') return;
    const click = (delay, cutoff, gain, dur = 0.045) => setTimeout(() => this.play({ noise: true, filter: 'bandpass', cutoff, q: 2.2, dur, gain }, pos, listener, 22, clear), delay);
    if (m === 'bolt') { click(170, 1700, 0.5); click(260, 2300, 0.45, 0.04); click(330, 1300, 0.35); }
    else if (m === 'pump') { click(320, 900, 0.7, 0.07); click(480, 1500, 0.7, 0.06); }
    else if (m === 'hammer') click(150, 2600, 0.4, 0.03);
  }

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
