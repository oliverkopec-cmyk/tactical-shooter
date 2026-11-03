// Gun sounds (Stage 2G), all made in code: no audio files.
//
// Each gun's shot is RENDERED once, sample by sample, the first time it is heard, from the recipe in
// shared/gunConfig.js, into a few short buffers:
//   close (3 slightly different takes)  a click, the sharp supersonic crack, the noisy blast with its tone
//                                       sweeping down, a low pitch-dropping boom, and the gun's own metal
//                                       action clacking, mixed and lightly saturated
//   far                                 what it sounds like from across the map: a dull thump and rumble
//                                       with a few slapback echoes off buildings
// Playing a shot is then cheap: the close take fades out with distance while the far one fades in, sound
// arrives late at the speed of sound, a filter dulls it indoors, behind walls and with distance, and it is
// sent to an echo (a short boomy room indoors, a long thin one outdoors; see Audio in audio.js).
//
// The mechanical sounds (dry click, bolt, pump, hammer, reload steps, bullet impacts) are rendered the same
// way from FOLEY below: each is a few metal "hits" (a ringing note plus a noise click) at set times.

import { gunTuning } from '../../shared/gunConfig.js';

// ---------------------------------------------------------------- small DSP kit

/** A biquad filter (lowpass / highpass / bandpass) whose frequency can be changed while running. */
class Biquad {
  constructor(type, sr) { this.type = type; this.sr = sr; this.x1 = this.x2 = this.y1 = this.y2 = 0; }
  set(f, q = 0.707) {
    const w = (2 * Math.PI * Math.min(f, this.sr * 0.45)) / this.sr, cs = Math.cos(w), al = Math.sin(w) / (2 * q), a0 = 1 + al;
    let b0, b1, b2;
    if (this.type === 'lowpass') { b0 = (1 - cs) / 2; b1 = 1 - cs; b2 = b0; }
    else if (this.type === 'highpass') { b0 = (1 + cs) / 2; b1 = -(1 + cs); b2 = b0; }
    else { b0 = al; b1 = 0; b2 = -al; }
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0; this.a1 = (-2 * cs) / a0; this.a2 = (1 - al) / a0;
    return this;
  }
  run(x) {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y;
    return y;
  }
}

function random(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function finish(out, drive = 1.6) {
  let peak = 0;
  const norm = Math.tanh(drive);
  for (let i = 0; i < out.length; i++) { out[i] = Math.tanh(out[i] * drive) / norm; peak = Math.max(peak, Math.abs(out[i])); }
  if (peak > 0) for (let i = 0; i < out.length; i++) out[i] *= 0.95 / peak;
  // A few milliseconds of fade at the end so nothing clicks
  const fade = Math.min(out.length, 256);
  for (let i = 0; i < fade; i++) out[out.length - 1 - i] *= i / fade;
  return out;
}

// ---------------------------------------------------------------- a gunshot, close up

function renderClose(s, sr, seed) {
  const rnd = random(seed);
  const len = Math.max(0.45, s.blastLength * 4 + 0.12, s.boomLength * 3);
  const n = Math.floor(len * sr), out = new Float32Array(n);
  const crackBP = new Biquad('bandpass', sr).set(s.crackTone, 0.8), crackHP = new Biquad('highpass', sr).set(1500);
  const lp1 = new Biquad('lowpass', sr), lp2 = new Biquad('lowpass', sr);
  const mechBP = new Biquad('bandpass', sr).set(s.mechPitch * 0.5, 1.1);
  const mechAt = 0.006 + rnd() * 0.004, mech2At = mechAt + 0.03 + rnd() * 0.01;
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr, noise = rnd() * 2 - 1;
    // The click of the primer and the supersonic crack: very short and bright
    const crack = crackBP.run(crackHP.run(noise)) * Math.exp(-t / 0.004) * 2.2 + (i < 3 ? (1 - i / 3) * 0.8 : 0);
    // The blast: noise whose tone starts bright and sweeps down, with a lingering puff of gas
    if (i % 32 === 0) { const f = s.blastTone * 2.2 * Math.exp(-t / (s.blastLength * 0.7)) + s.blastTone * 0.15; lp1.set(f, 0.8); lp2.set(f * 1.2, 0.6); }
    const blastEnv = (1 - Math.exp(-t / 0.0004)) * (Math.exp(-t / (s.blastLength * 0.45)) + 0.25 * Math.exp(-t / (s.blastLength * 1.3)));
    const blast = lp2.run(lp1.run(noise)) * blastEnv * 2.5;
    // The boom: a low note that drops in pitch, punchy and slightly overdriven
    const f = s.boomPitch * (0.55 + 1.3 * Math.exp(-t / 0.02));
    phase += (2 * Math.PI * f) / sr;
    const boom = Math.tanh(1.6 * Math.sin(phase)) * (1 - Math.exp(-t / 0.001)) * Math.exp(-t / (s.boomLength * 0.4));
    // The action: the bolt slamming back and forward, a short dull clack (mostly noise, only a hint of ring)
    let mech = 0;
    const m = mechBP.run(noise);
    for (const [at, amp] of [[mechAt, 1], [mech2At, 0.6]]) {
      const u = t - at;
      if (u < 0 || u > 0.04) continue;
      mech += (m * 2.5 * Math.exp(-u / 0.004) + Math.sin(2 * Math.PI * s.mechPitch * u) * 0.15 * Math.exp(-u / 0.005)) * amp;
    }
    out[i] = crack * s.crack * 0.9 + blast * s.blast + boom * s.boom * 0.9 + mech * s.mech * 0.25;
  }
  return finish(out);
}

// ---------------------------------------------------------------- the same gun from far away

function renderFar(s, sr, seed) {
  const rnd = random(seed);
  const n = Math.floor(1.7 * sr), dry = new Float32Array(n), out = new Float32Array(n);
  const lp1 = new Biquad('lowpass', sr), lp2 = new Biquad('lowpass', sr).set(s.blastTone * 0.5, 0.6);
  const snap = new Biquad('bandpass', sr).set(2400, 1);
  let phase = 0;
  const blastLen = s.blastLength * 1.6, boomLen = s.boomLength * 1.5;
  for (let i = 0; i < n; i++) {
    const t = i / sr, noise = rnd() * 2 - 1;
    if (i % 64 === 0) lp1.set(s.blastTone * 0.35 * Math.exp(-t / blastLen) + 120, 0.7);
    const blast = lp2.run(lp1.run(noise)) * (1 - Math.exp(-t / 0.002)) * Math.exp(-t / (blastLen * 0.6)) * 3;
    phase += (2 * Math.PI * s.boomPitch * 0.8 * (0.7 + 0.5 * Math.exp(-t / 0.04))) / sr;
    const boom = Math.sin(phase) * (1 - Math.exp(-t / 0.004)) * Math.exp(-t / (boomLen * 0.5));
    const crack = snap.run(noise) * Math.exp(-t / 0.006) * s.crack * 0.4;   // a rifle's crack still carries as a snap
    dry[i] = blast * s.blast + boom * s.boom * 1.1 + crack;
  }
  // Slapback echoes off buildings and hills: later ones quieter and duller
  const taps = [[0, 1], [0.09, 0.5], [0.2, 0.38], [0.34, 0.27], [0.52, 0.18], [0.78, 0.11], [1.05, 0.06]];
  taps.forEach(([at, g], k) => {
    const off = Math.floor(at * sr), a = 1 - Math.min(0.92, 0.25 + k * 0.12);   // one-pole lowpass, darker per echo
    let y = 0;
    for (let i = 0; i + off < n; i++) { y += (dry[i] - y) * a; out[i + off] += y * g * (k ? s.tail : 1); }
  });
  return finish(out, 1.2);
}

// ---------------------------------------------------------------- foley: clicks, clacks and impacts

// Each sound is a list of hits: [time s, ring Hz, ring length s, loudness, noise 0..1]
const FOLEY = {
  dry: [[0, 2400, 0.012, 0.8, 0.6], [0.018, 1500, 0.02, 0.5, 0.4]],
  bolt: [[0, 1300, 0.03, 0.8, 0.7], [0.09, 1900, 0.025, 0.9, 0.8], [0.16, 1100, 0.04, 0.7, 0.5]],
  pump: [[0, 700, 0.05, 1, 0.9], [0.03, 1400, 0.02, 0.5, 0.6], [0.17, 900, 0.05, 1, 0.9], [0.2, 1800, 0.02, 0.6, 0.6]],
  hammer: [[0, 3200, 0.01, 0.6, 0.5], [0.04, 2400, 0.012, 0.5, 0.5]],
  magRelease: [[0, 2600, 0.012, 0.6, 0.6]],
  magOut: [[0, 900, 0.04, 0.6, 0.8], [0.05, 500, 0.06, 0.4, 1]],
  magIn: [[0, 1200, 0.03, 0.8, 0.8], [0.02, 2200, 0.015, 0.9, 0.6]],
  slide: [[0, 1600, 0.025, 0.7, 0.7], [0.08, 2100, 0.02, 1, 0.8]],
  shellIn: [[0, 1700, 0.02, 0.5, 0.5], [0.03, 900, 0.03, 0.4, 0.6]],
  beltOpen: [[0, 600, 0.08, 1, 0.8], [0.05, 1300, 0.04, 0.6, 0.5]],
  beltIn: [[0, 500, 0.1, 0.8, 1], [0.1, 900, 0.05, 0.6, 0.8]],
  beltClose: [[0, 700, 0.07, 1, 0.8], [0.01, 2000, 0.03, 0.6, 0.6]],
  revOpen: [[0, 2000, 0.02, 0.7, 0.6], [0.05, 1200, 0.03, 0.5, 0.5]],
  revSpin: Array.from({ length: 9 }, (_, i) => [i * 0.024, 3000, 0.006, 0.35, 0.6]),
  revClose: [[0, 1100, 0.04, 0.9, 0.7]],
  hitWood: [[0, 420, 0.03, 1, 1], [0.004, 900, 0.015, 0.4, 1]],
  hitMetal: [[0, 2400, 0.14, 0.6, 0.3], [0, 3700, 0.08, 0.4, 0.2], [0.002, 6200, 0.03, 0.3, 0.4]],
  hitConcrete: [[0, 900, 0.012, 1, 1], [0.01, 600, 0.02, 0.4, 1]],
  hitGlass: Array.from({ length: 10 }, (_, i) => [i * 0.012 + (i % 3) * 0.004, 4000 + ((i * 1777) % 3000), 0.03, 0.5 - i * 0.03, 0.4]),
};

function renderFoley(hits, sr, seed) {
  const rnd = random(seed);
  const len = Math.max(...hits.map(([at, , d]) => at + d * 6)) + 0.03;
  const out = new Float32Array(Math.ceil(len * sr));
  for (const [at, f, d, g, nz] of hits) {
    const bp = new Biquad('bandpass', sr).set(f * 1.3, 1.2), start = Math.floor(at * sr), end = Math.min(out.length, start + Math.ceil(d * 6 * sr));
    const ratio = 2.3 + rnd() * 0.4;
    for (let i = start; i < end; i++) {
      const u = (i - start) / sr;
      // A short ring under a click: kept low and quick so it reads as a clack, not a bell
      const ring = (Math.sin(2 * Math.PI * f * u) + 0.4 * Math.sin(2 * Math.PI * f * ratio * u)) * Math.exp(-u / (d * 0.5));
      const click = bp.run(rnd() * 2 - 1) * Math.exp(-u / (d * 0.5)) * 3;
      out[i] += g * (ring * 0.35 * (1 - nz * 0.6) + click * Math.max(nz, 0.5));
    }
  }
  return finish(out, 1.3);
}

// ---------------------------------------------------------------- playing them

const TAKES = 3;

export class GunSounds {
  constructor(audio) {
    this.audio = audio;
    this.guns = new Map();     // gun id -> { close: [AudioBuffer], far: AudioBuffer }
    this.foley = new Map();    // name -> AudioBuffer
    this.recent = [];          // times of recent shots, so a big firefight can't flood the audio graph
  }

  get ctx() { return this.audio.ctx; }

  buffer(data) {
    const b = this.ctx.createBuffer(1, data.length, this.ctx.sampleRate);
    b.copyToChannel(data, 0);
    return b;
  }

  /** The rendered shots of a gun (made the first time they're needed, a few milliseconds of work). */
  sounds(id) {
    let g = this.guns.get(id);
    if (!g) {
      const s = gunTuning(id).sound, sr = this.ctx.sampleRate;
      let seed = 0;
      for (let i = 0; i < id.length; i++) seed = (seed * 31 + id.charCodeAt(i)) >>> 0;
      // One close take now; the far version and the other takes over the next few moments (no hitch on a first shot)
      g = { close: [this.buffer(renderClose(s, sr, seed))], far: null };
      this.guns.set(id, g);
      const later = [() => { g.far = this.buffer(renderFar(s, sr, seed + 5)); }];
      for (let k = 1; k < TAKES; k++) later.push(() => g.close.push(this.buffer(renderClose(s, sr, seed + k * 977))));
      const next = () => { later.shift()?.(); if (later.length) setTimeout(next, 30); };
      setTimeout(next, 30);
    }
    return g;
  }

  /** Render a gun's sounds now (when it is equipped), so its first shot doesn't have to wait. */
  prewarm(id) { if (this.ctx && id && !this.guns.has(id)) this.sounds(id); }

  foleyBuffer(name) {
    let b = this.foley.get(name);
    if (!b && FOLEY[name]) { b = this.buffer(renderFoley(FOLEY[name], this.ctx.sampleRate, name.length * 7919)); this.foley.set(name, b); }
    return b;
  }

  /**
   * A gunshot. pos null = your own gun. env: { lisIn, srcIn, clear } = you indoors, the gun indoors, no wall
   * in between (from Game.soundEnv).
   */
  shot(id, pos, listener, env = {}) {
    const ctx = this.ctx, a = this.audio;
    if (!ctx || ctx.state !== 'running') return;
    const now = performance.now();
    this.recent = this.recent.filter((x) => now - x < 100);
    if (this.recent.length > 20) return;
    this.recent.push(now);
    const s = gunTuning(id).sound, g = this.sounds(id);
    const lisIn = !!env.lisIn, srcIn = pos ? !!env.srcIn : lisIn, clear = env.clear !== false;
    let d = 0, pan = 0;
    if (pos && listener) {
      const dx = pos[0] - listener.x, dz = pos[2] - listener.z, dy = pos[1] - (listener.y ?? pos[1]);
      d = Math.hypot(dx, dz, dy * 0.6);
      pan = d > 0.3 ? Math.max(-1, Math.min(1, (dx * Math.cos(listener.yaw) - dz * Math.sin(listener.yaw)) / Math.hypot(dx, dz) || 0)) * Math.min(1, d / 2) : 0;
    }
    if (d > 160) return;
    const inside = lisIn && srcIn, through = lisIn !== srcIn;
    // How dull it is: a little indoors, more with distance, much more through a wall or between inside and out
    let cutoff = pos ? 16000 / (1 + d * 0.02) : 16000;
    if (inside) cutoff *= 0.6;
    if (through) cutoff *= 0.3;
    if (!clear) cutoff *= 0.15;
    const t = ctx.currentTime + Math.min(0.4, d / 343);
    const rate = 1 + (Math.random() * 2 - 1) * s.pitchVar;
    const out = ctx.createGain();
    out.gain.value = s.volume * (pos ? 1 : 0.8) * (clear ? 1 : 0.6) * (through ? 0.75 : 1);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = Math.max(300, cutoff); lp.Q.value = 0.5;
    const panner = ctx.createStereoPanner();
    panner.pan.value = pan;
    lp.connect(out).connect(panner).connect(a.master);
    const echo = ctx.createGain();
    echo.gain.value = s.tail * (pos ? 0.35 + Math.min(0.6, d / 50) : 0.3) * (inside ? 1.2 : 1);
    out.connect(echo).connect(srcIn ? a.sends.indoor : a.sends.outdoor);
    const play = (buf, gain) => {
      if (gain < 0.004) return;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = rate;
      const gg = ctx.createGain();
      gg.gain.value = gain;
      src.connect(gg).connect(lp);
      src.start(t);
    };
    // Close up the sharp version; with distance it fades out and the far rumble (with its echoes) takes over
    const nearGain = pos ? 1 / Math.pow(1 + d / 7, 1.25) : 1;
    const farIn = Math.max(0, Math.min(1, (d - 5) / 25));
    play(g.close[Math.floor(Math.random() * g.close.length)], nearGain);
    if (pos && g.far) play(g.far, s.distant * 0.6 * farIn * farIn * (3 - 2 * farIn) / (1 + d / 110));
  }

  /** A rendered foley sound, at your ears (pos null) or positional. */
  play(name, pos = null, listener = null, range = 20, clear = true, gain = 1) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const buf = this.foleyBuffer(name);
    if (!buf) return;
    const sp = this.audio.spatialParams(pos, listener, range, clear);
    if (!sp) return;
    const vol = gain * sp.gain * 0.55;
    if (vol < 0.003) return;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = 0.94 + Math.random() * 0.12;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = Math.max(400, 14000 * sp.muffle);
    const g = ctx.createGain();
    g.gain.value = vol;
    const panner = ctx.createStereoPanner();
    panner.pan.value = sp.pan;
    src.connect(lp).connect(g).connect(panner).connect(this.audio.master);
    src.start();
  }

  /** Pulling the trigger on an empty gun. */
  dry() { this.play('dry'); }

  /** After a shot: the bolt worked, the pump racked or the hammer cocked. */
  after(id, pos = null, listener = null, clear = true) {
    const kind = gunTuning(id).sound.after, delay = { bolt: 160, pump: 300, hammer: 140 }[kind];
    if (delay) setTimeout(() => this.play(kind, pos, listener, 24, clear), delay);
  }
}

// Reloading: [fraction of the reload time, foley sound], by the gun's `reload` setting
export const RELOAD_STEPS = {
  mag: [[0.03, 'magRelease'], [0.25, 'magOut'], [0.62, 'magIn'], [0.86, 'slide']],
  smg: [[0.03, 'magRelease'], [0.38, 'magIn'], [0.82, 'slide']],
  shell: [[0.12, 'shellIn'], [0.27, 'shellIn'], [0.42, 'shellIn'], [0.57, 'shellIn'], [0.72, 'shellIn'], [0.9, 'pump']],
  belt: [[0.03, 'beltOpen'], [0.3, 'magOut'], [0.62, 'beltIn'], [0.88, 'beltClose']],
  revolver: [[0.03, 'revOpen'], [0.22, 'revSpin'], [0.62, 'shellIn'], [0.72, 'shellIn'], [0.9, 'revClose']],
};
