// Player settings. The account's copy is the source of truth once logged in;
// localStorage only keeps the last values so the game has them before login.

import { SETTING_LIMITS, clampSetting, sanitizeSettings } from '../../shared/settings.js';
import { sanitizeKeybinds } from '../../shared/keybinds.js';

const KEY = 'breachline:settings';

function load() {
  try { return sanitizeSettings(JSON.parse(localStorage.getItem(KEY) || '{}')); }
  catch { return sanitizeSettings({}); }
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

/** Replace all keybinds (cleaned: unknown actions dropped, duplicates unbound). */
export function setKeybinds(map) {
  settings.keybinds = sanitizeKeybinds(map);
  cache();
  for (const fn of listeners) fn('keybinds', settings.keybinds);
}

/** Load the settings saved on the account (after logging in). */
export function applyAccountSettings(saved) {
  const clean = sanitizeSettings(saved);
  for (const [name, value] of Object.entries(clean)) {
    if (name !== 'keybinds' && settings[name] !== value) setSetting(name, value);
  }
  if (JSON.stringify(clean.keybinds) !== JSON.stringify(settings.keybinds)) setKeybinds(clean.keybinds);
}

export { SETTING_LIMITS };
