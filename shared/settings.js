// Player settings: defaults and limits, shared so the server can clean what
// the client asks to save to the account.

import { DEFAULT_KEYBINDS, sanitizeKeybinds } from './keybinds.js';

export const SETTING_DEFAULTS = {
  sensitivity: 1, aimSensitivity: 1, volume: 0.5, fov: 78, voice: 0.8, menuMusic: 0.4, leanMode: 'toggle', aimMode: 'hold',
  // Graphics (Stage 2J): a preset, and the separate options it sets (used when the preset is 'custom')
  graphics: 'auto', gShadows: 'high', gResolution: '1.5', gEffects: 'high', gDistance: 'long', gAA: 'on', showFps: 'on',
  lastSeenUpdate: '',   // the newest "What's new" entry this account has been shown
};
export const SETTING_LIMITS = { sensitivity: [0.2, 3], aimSensitivity: [0.2, 2], volume: [0, 1], fov: [60, 100], voice: [0, 1], menuMusic: [0, 1] };
// Settings that are one of a few words (the first is the default). graphics 'auto' picks low on weak devices.
export const SETTING_CHOICES = {
  leanMode: ['toggle', 'hold'], aimMode: ['hold', 'toggle'],
  graphics: ['auto', 'low', 'medium', 'high', 'ultra', 'custom'],   // auto = low on weak devices, else high
  gShadows: ['off', 'low', 'high'], gResolution: ['0.75', '1', '1.5', '2'], gEffects: ['low', 'medium', 'high'],
  gDistance: ['short', 'medium', 'long'], gAA: ['off', 'on'], showFps: ['on', 'off'],
};
// Free text settings, with their longest allowed length
export const SETTING_TEXT = { lastSeenUpdate: 16 };

export function clampSetting(name, value) {
  if (SETTING_TEXT[name]) return String(value ?? '').replace(/[^A-Za-z0-9._-]/g, '').slice(0, SETTING_TEXT[name]);
  if (SETTING_CHOICES[name]) return SETTING_CHOICES[name].includes(value) ? value : SETTING_DEFAULTS[name];
  const [lo, hi] = SETTING_LIMITS[name];
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : SETTING_DEFAULTS[name];
}

/**
 * Keep only known settings, clamped to their limits, plus cleaned keybinds.
 * Unknown or missing ones fall back to defaults.
 */
export function sanitizeSettings(raw) {
  const out = { ...SETTING_DEFAULTS, keybinds: { ...DEFAULT_KEYBINDS } };
  if (!raw || typeof raw !== 'object') return out;
  for (const name of Object.keys(SETTING_DEFAULTS)) {
    if (name in raw) out[name] = clampSetting(name, raw[name]);
  }
  out.keybinds = sanitizeKeybinds(raw.keybinds);
  return out;
}
