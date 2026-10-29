// Small synthesised sounds for the main menu (crate opening). No audio files.

let ctx = null;
function audio() {
  if (!ctx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    ctx = new Ctx();
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function tone(freq, dur, { type = 'sine', gain = 0.2, slideTo = null, at = 0 } = {}) {
  const a = audio();
  if (!a) return;
  const t = a.currentTime + at;
  const osc = a.createOscillator(), g = a.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  osc.connect(g).connect(a.destination);
  osc.start(t);
  osc.stop(t + dur + 0.05);
}

function noise(dur, { gain = 0.2, freq = 800, at = 0 } = {}) {
  const a = audio();
  if (!a) return;
  const len = Math.floor(a.sampleRate * dur);
  const buf = a.createBuffer(1, len, a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  const src = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain();
  src.buffer = buf;
  f.type = 'lowpass';
  f.frequency.value = freq;
  const t = a.currentTime + at;
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(f).connect(g).connect(a.destination);
  src.start(t);
}

export const menuAudio = {
  /** The crate lands. */
  thud() { tone(90, 0.35, { slideTo: 40, gain: 0.5 }); noise(0.25, { gain: 0.25, freq: 500 }); },
  /** A glow pulse; `step` 0..3 is how far up the rarity ladder it is. */
  pulse(step) { tone(260 + step * 130, 0.5, { type: 'triangle', gain: 0.12, slideTo: 330 + step * 170 }); },
  /** The lid bursts open. */
  burst(rarity) {
    noise(0.5, { gain: 0.3, freq: 3000 });
    const base = { common: 330, rare: 392, epic: 466, legendary: 523 }[rarity] || 330;
    tone(base, 0.6, { type: 'sawtooth', gain: 0.12, slideTo: base * 2 });
    tone(base * 1.5, 0.6, { type: 'triangle', gain: 0.1, at: 0.05 });
  },
  /** Legendary pulls: a rising fanfare. */
  legendary() {
    [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, 0.7, { type: 'triangle', gain: 0.14, at: i * 0.09 }));
    tone(130, 1.2, { type: 'sawtooth', gain: 0.1, slideTo: 260 });
  },
  /** The gun is revealed. */
  reveal() { tone(880, 0.4, { type: 'sine', gain: 0.1 }); tone(1320, 0.5, { type: 'sine', gain: 0.08, at: 0.08 }); },
};
