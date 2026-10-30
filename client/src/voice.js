// Operator voice lines (the text and voices are in shared/voiceLines.js). The server tells us who said
// what and where they stood; we speak it with the browser's speech synthesis in that operator's voice,
// quieter the further away they are. Speech synthesis can't be placed in 3D, so the direction is shown
// instead: each line also appears on screen with an arrow pointing to whoever said it.
// The "Voice lines" volume in the settings turns it down or off (0).

import { VOICE_LINES, voiceFor } from '../../shared/voiceLines.js';
import { OPERATORS } from '../../shared/operators.js';
import { settings } from './settings.js';

const HEAR_RANGE = 40;   // metres: beyond this teammates are too far to hear

export class VoicePlayer {
  constructor(ui) {
    this.ui = ui;
    this.synth = typeof window !== 'undefined' ? window.speechSynthesis : null;
    this.audio = new Map();     // recorded clips, once a line has `audio`
  }

  /** e: { id, key, op, pos }. listener: { x, y, z, yaw }. self: it was me. name: the speaker's name. */
  say(e, listener, self, name) {
    const entry = VOICE_LINES[e.key];
    if (!entry) return;
    const i = Math.floor(Math.random() * entry.lines.length);
    const text = entry.lines[i];
    const dx = e.pos[0] - listener.x, dz = e.pos[2] - listener.z;
    const dist = self ? 0 : Math.hypot(dx, e.pos[1] - listener.y, dz);
    // On screen: who said it and which way they are (self: no arrow)
    let arrow = '';
    if (!self) {
      const ang = Math.atan2(dx, dz) - (listener.yaw + Math.PI);   // 0 = straight ahead
      const a = Math.atan2(Math.sin(ang), Math.cos(ang));
      arrow = ['↓', '↙', '←', '↖', '↑', '↗', '→', '↘'][Math.round(((-a + Math.PI) / (Math.PI * 2)) * 8) % 8];
    }
    const opName = OPERATORS[e.op]?.name || name || 'Teammate';
    this.ui.addVoiceLine(`${arrow ? `${arrow} ` : ''}${opName}: ${text}`, self);
    const volume = (settings.voice ?? 0.8) * (self ? 1 : Math.max(0, 1 - dist / HEAR_RANGE));
    if (volume <= 0.02) return;
    if (entry.audio?.[i]) return this.playClip(entry.audio[i], volume);
    if (!this.synth) return;
    if (this.synth.speaking && this.synth.pending) return;          // already one waiting: drop this one rather than pile up
    const u = new SpeechSynthesisUtterance(text);
    const v = voiceFor(e.op);
    u.pitch = Math.max(0, Math.min(2, v.pitch));
    u.rate = Math.max(0.5, Math.min(2, v.rate * 1.08));
    u.volume = Math.min(1, volume);
    this.synth.speak(u);
  }

  playClip(url, volume) {
    let a = this.audio.get(url);
    if (!a) { a = new Audio(url); this.audio.set(url, a); }
    a.volume = Math.min(1, volume);
    a.currentTime = 0;
    a.play().catch(() => {});
  }

  stop() { this.synth?.cancel(); }
}
