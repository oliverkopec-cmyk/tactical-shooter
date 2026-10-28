// Synthesised sound effects (no audio files). Gunshots are filtered noise bursts,
// panned and attenuated by distance from the listener.

const SHOT_TONE = {
  rifle: { freq: 1400, decay: 0.16, gain: 0.5 },
  smg: { freq: 2000, decay: 0.11, gain: 0.4 },
  shotgun: { freq: 700, decay: 0.3, gain: 0.7 },
};

export class Audio {
  constructor() {
    this.ctx = null;
    this.noise = null;
    const unlock = () => this.ensure();
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
  }

  ensure() {
    if (!this.ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return null;
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate * 0.5;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }

  /** listener: { x, z, yaw } ; pos: [x, y, z] or null for "at the listener" */
  shot(weaponId, pos, listener) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const tone = SHOT_TONE[weaponId] || SHOT_TONE.rifle;
    let gain = tone.gain, pan = 0, muffle = 1;
    if (pos && listener) {
      const dx = pos[0] - listener.x, dz = pos[2] - listener.z;
      const dist = Math.hypot(dx, dz);
      gain *= 1 / (1 + dist * 0.08);
      muffle = 1 / (1 + dist * 0.03);
      // Right vector of the listener: (cos yaw, -sin yaw)
      pan = dist > 0.1 ? Math.max(-1, Math.min(1, (dx * Math.cos(listener.yaw) - dz * Math.sin(listener.yaw)) / dist)) : 0;
    }
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(tone.freq * 3 * muffle, t);
    filter.frequency.exponentialRampToValueAtTime(Math.max(80, tone.freq * 0.3 * muffle), t + tone.decay);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + tone.decay);
    const panner = ctx.createStereoPanner();
    panner.pan.value = pan;
    src.connect(filter).connect(g).connect(panner).connect(this.master);
    src.start(t);
    src.stop(t + tone.decay + 0.05);
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

  clank() { this.beep(180, 0.12, 0.2, 'square'); setTimeout(() => this.beep(140, 0.15, 0.2, 'square'), 90); }

  hit(head) { this.beep(head ? 1800 : 1100, 0.06, 0.12, 'triangle'); }
  kill() { this.beep(660, 0.09, 0.15, 'triangle'); setTimeout(() => this.beep(990, 0.12, 0.15, 'triangle'), 70); }
  hurt() { this.beep(120, 0.15, 0.3, 'sawtooth'); }
  click() { this.beep(2400, 0.02, 0.08); }
  reload() { this.beep(500, 0.05, 0.1); setTimeout(() => this.beep(800, 0.05, 0.1), 160); }
}
