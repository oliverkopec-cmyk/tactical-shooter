// Graphics (Stage 2J): a preset (Low, Medium, High, Ultra, or Auto, which is Low on weak devices and High otherwise)
// or Custom, with separate options for shadows, render resolution, effects, view distance and anti-aliasing.
// quality() is what is actually used; the menu and the game both read it.

import { settings, setSetting } from './settings.js';

export const PRESETS = {
  low: { shadows: 'off', resolution: '0.75', effects: 'low', distance: 'short', aa: 'off' },
  medium: { shadows: 'low', resolution: '1', effects: 'medium', distance: 'medium', aa: 'off' },
  high: { shadows: 'high', resolution: '1.5', effects: 'high', distance: 'long', aa: 'on' },
  ultra: { shadows: 'high', resolution: '2', effects: 'high', distance: 'long', aa: 'on' },
};

// What each option means
export const DISTANCES = { short: { far: 110, fog: [35, 85] }, medium: { far: 180, fog: [50, 120] }, long: { far: 300, fog: [60, 140] } };
export const SHADOWS = { low: { size: 1024 }, high: { size: 2048 } };
export const EFFECT_LEVELS = { low: { decals: 40, debris: 60, smoke: false, casings: false, light: false }, medium: { decals: 90, debris: 160, smoke: true, casings: true, light: true }, high: { decals: 150, debris: 300, smoke: true, casings: true, light: true } };

function weakDevice() {
  const mem = navigator.deviceMemory, cores = navigator.hardwareConcurrency;
  return (mem !== undefined && mem <= 4) || (cores !== undefined && cores <= 2) || /Mobi|Android/i.test(navigator.userAgent);
}

/** The options in use: { shadows, resolution, effects, distance, aa }. */
export function quality() {
  const g = settings.graphics;
  if (PRESETS[g]) return PRESETS[g];
  if (g === 'auto') return weakDevice() ? PRESETS.low : PRESETS.high;
  return { shadows: settings.gShadows, resolution: settings.gResolution, effects: settings.gEffects, distance: settings.gDistance, aa: settings.gAA };
}

/** True when the menu and the world should be turned right down. */
export const lowGraphics = () => {
  const q = quality();
  return q.shadows === 'off' && q.effects === 'low';
};

/** The renderer's pixel ratio for a resolution option: never above the screen's own, but 0.75 draws fewer pixels than the screen has. */
export function pixelRatioFor(resolution, devicePixelRatio = window.devicePixelRatio || 1) {
  const r = Number(resolution);
  return r <= 1 ? r : Math.min(r, Math.max(1, devicePixelRatio));
}

const KEYS = { shadows: 'gShadows', resolution: 'gResolution', effects: 'gEffects', distance: 'gDistance', aa: 'gAA' };

/** Pick a preset (or 'auto' / 'custom'): the separate options show what it sets. */
export function choosePreset(name) {
  setSetting('graphics', name);
  const q = PRESETS[name] || (name === 'auto' ? quality() : null);
  if (q) for (const [k, s] of Object.entries(KEYS)) setSetting(s, q[k]);
}

/** Change one option: the preset becomes Custom (starting from what was in use). */
export function chooseOption(setting, value) {
  if (settings.graphics !== 'custom') {
    const q = quality();
    for (const [k, s] of Object.entries(KEYS)) setSetting(s, q[k]);
    setSetting('graphics', 'custom');
  }
  setSetting(setting, value);
}

/** Does the set of options match a preset exactly? (so the menu can say which one) */
export function presetMatching(q) {
  return Object.entries(PRESETS).find(([, p]) => Object.keys(KEYS).every((k) => p[k] === q[k]))?.[0] || null;
}
