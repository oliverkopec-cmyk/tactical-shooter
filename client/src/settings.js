// Player settings, saved in localStorage (silently falls back to defaults if storage is unavailable).

const KEY = 'breachline:settings';
const DEFAULTS = { sensitivity: 1, volume: 0.5, fov: 78 };
const LIMITS = { sensitivity: [0.2, 3], volume: [0, 1], fov: [60, 100] };

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || '{}');
    return { ...DEFAULTS, ...saved };
  } catch { return { ...DEFAULTS }; }
}

export const settings = load();
const listeners = new Set();

export function onSettingsChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function setSetting(name, value) {
  const [lo, hi] = LIMITS[name];
  settings[name] = Math.max(lo, Math.min(hi, Number(value)));
  try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* storage unavailable */ }
  for (const fn of listeners) fn(name, settings[name]);
}

export const SETTING_LIMITS = LIMITS;
