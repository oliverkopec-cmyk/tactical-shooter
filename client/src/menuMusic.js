// Menu music: a slow ambient piece made live with Web Audio (no audio files). A warm pad drifts
// through four chords, eight seconds each, over a soft bass; sparse plucked notes echo through a
// delay; light rain hisses underneath. It fades in when the main menu shows and out when a match
// starts. Volume: the "Menu music" setting (0 turns it off completely).

import { settings, onSettingsChange } from './settings.js';

const CHORD_SECONDS = 8;
// A minor: Am9, Fmaj7, Cmaj7, G6 (MIDI notes)
const CHORDS = [[57, 60, 64, 67, 71], [53, 57, 60, 64, 69], [48, 55, 59, 64, 67], [55, 59, 62, 64, 71]];
const ROOTS = [45, 41, 36, 43];
const hz = (m) => 440 * 2 ** ((m - 69) / 12);

class MenuMusic {
  constructor() {
    this.ctx = null;
    this.playing = false;
    this.chord = 0;
    onSettingsChange((name, v) => { if (name === 'menuMusic') this.setVolume(v); });
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return;
      if (document.hidden) this.ctx.suspend(); else if (this.playing) this.ctx.resume();
    });
  }

  setup() {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return false;
    const c = this.ctx = new Ctx();
    this.master = c.createGain();
    this.master.gain.value = 0;
    this.master.connect(c.destination);
    // A soft echo for the plucks and a little of the pad
    this.delay = c.createDelay(1);
    this.delay.delayTime.value = 0.42;
    const fb = c.createGain(); fb.gain.value = 0.38;
    const tone = c.createBiquadFilter(); tone.type = 'lowpass'; tone.frequency.value = 1800;
    this.delay.connect(tone).connect(fb).connect(this.delay);
    tone.connect(this.master);
    // Rain: a loop of filtered noise
    const len = c.sampleRate * 2, buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const rain = c.createBufferSource(); rain.buffer = buf; rain.loop = true;
    const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 500;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2600;
    const rg = c.createGain(); rg.gain.value = 0.05;
    rain.connect(hp).connect(lp).connect(rg).connect(this.master);
    rain.start();
    // Browsers only allow sound after a click or key press: try again on the first one
    const unlock = () => { if (this.playing) c.resume(); };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    return true;
  }

  start() {
    if (this.playing || settings.menuMusic <= 0) return;
    if (!this.ctx && !this.setup()) return;
    this.playing = true;
    const c = this.ctx;
    c.resume();
    const now = c.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setValueAtTime(this.master.gain.value, now);
    this.master.gain.linearRampToValueAtTime(this.level(), now + 3);
    this.nextAt = Math.max(now + 0.1, this.nextAt || 0);
    clearInterval(this.timer);
    this.timer = setInterval(() => this.schedule(), 400);
    this.schedule();
  }

  stop() {
    if (!this.playing) return;
    this.playing = false;
    clearInterval(this.timer);
    const c = this.ctx, now = c.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setValueAtTime(this.master.gain.value, now);
    this.master.gain.linearRampToValueAtTime(0, now + 1.5);
    setTimeout(() => { if (!this.playing) c.suspend(); }, 1700);
  }

  level() { return settings.menuMusic * 0.5; }

  setVolume(v) {
    if (v <= 0) { this.stop(); return; }
    if (!this.playing) { if (this.wanted) this.start(); return; }
    this.master.gain.setTargetAtTime(this.level(), this.ctx.currentTime, 0.2);
  }

  /** Whether the menu is showing (the music plays only then). */
  setWanted(on) {
    this.wanted = on;
    if (on) this.start(); else this.stop();
  }

  /** Keep the next chord (and its notes) queued a little ahead of time. */
  schedule() {
    const c = this.ctx;
    while (this.nextAt < c.currentTime + 1.5) {
      this.playChord(this.chord % CHORDS.length, this.nextAt);
      this.chord++;
      this.nextAt += CHORD_SECONDS;
    }
  }

  playChord(i, at) {
    const c = this.ctx, dur = CHORD_SECONDS + 2.5;
    // Pad: two slightly detuned saws per note through a filter that opens and closes
    const filter = c.createBiquadFilter();
    filter.type = 'lowpass'; filter.Q.value = 0.7;
    filter.frequency.setValueAtTime(450, at);
    filter.frequency.linearRampToValueAtTime(1100, at + dur * 0.5);
    filter.frequency.linearRampToValueAtTime(500, at + dur);
    const env = c.createGain();
    env.gain.setValueAtTime(0, at);
    env.gain.linearRampToValueAtTime(0.045, at + 2.5);
    env.gain.setValueAtTime(0.045, at + dur - 3);
    env.gain.linearRampToValueAtTime(0, at + dur);
    filter.connect(env);
    env.connect(this.master);
    const send = c.createGain(); send.gain.value = 0.25;
    env.connect(send).connect(this.delay);
    for (const note of CHORDS[i]) {
      for (const cents of [-7, 7]) {
        const o = c.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = hz(note);
        o.detune.value = cents;
        o.connect(filter);
        o.start(at); o.stop(at + dur + 0.1);
      }
    }
    // Bass
    const b = c.createOscillator(), bg = c.createGain();
    b.type = 'sine'; b.frequency.value = hz(ROOTS[i]);
    bg.gain.setValueAtTime(0, at);
    bg.gain.linearRampToValueAtTime(0.11, at + 1.5);
    bg.gain.setValueAtTime(0.11, at + dur - 3);
    bg.gain.linearRampToValueAtTime(0, at + dur);
    b.connect(bg).connect(this.master);
    b.start(at); b.stop(at + dur + 0.1);
    // A few plucked notes from the chord, an octave up, into the echo
    const n = 3 + Math.floor(Math.random() * 3);
    for (let k = 0; k < n; k++) {
      const t = at + 0.8 + Math.random() * (CHORD_SECONDS - 1.5);
      const note = CHORDS[i][Math.floor(Math.random() * CHORDS[i].length)] + 12;
      const o = c.createOscillator(), g = c.createGain();
      o.type = 'triangle'; o.frequency.value = hz(note);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.05, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0005, t + 1.6);
      o.connect(g);
      g.connect(this.master);
      g.connect(this.delay);
      o.start(t); o.stop(t + 1.7);
    }
  }
}

export const menuMusic = new MenuMusic();
