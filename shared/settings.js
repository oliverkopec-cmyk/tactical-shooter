// Player settings: defaults and limits, shared so the server can clean what
// the client asks to save to the account.

import { DEFAULT_KEYBINDS, sanitizeKeybinds } from './keybinds.js';

export const SETTING_DEFAULTS = { sensitivity: 1, volume: 0.5, fov: 78 };
export const SETTING_LIMITS = { sensitivity: [0.2, 3], volume: [0, 1], fov: [60, 100] };

export function clampSetting(name, value) {
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
