// Player settings. The account's copy is the source of truth once logged in;
// localStorage only keeps the last values so the game has them before login.

import { SETTING_DEFAULTS, SETTING_LIMITS, clampSetting, sanitizeSettings } from '../../shared/settings.js';

const KEY = 'breachline:settings';

function load() {
  try { return sanitizeSettings(JSON.parse(localStorage.getItem(KEY) || '{}')); }
  catch { return { ...SETTING_DEFAULTS }; }
}

function cache() {
  try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* storage unavailable */ }
}

export const settings = load();
const listeners = new Set();

export function onSettingsChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function setSetting(name, value) {
  settings[name] = clampSetting(name, value);
  cache();
  for (const fn of listeners) fn(name, settings[name]);
}

/** Load the settings saved on the account (after logging in). */
export function applyAccountSettings(saved) {
  for (const [name, value] of Object.entries(sanitizeSettings(saved))) {
    if (settings[name] !== value) setSetting(name, value);
  }
}

export { SETTING_LIMITS };
