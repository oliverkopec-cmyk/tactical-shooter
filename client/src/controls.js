// Looks up the player's current keybinds: which action a key/button triggers,
// and what to call the key for an action in hints and prompts.

import { settings, onSettingsChange } from './settings.js';
import { keyLabel } from '../../shared/keybinds.js';

let byCode = new Map();

function rebuild() {
  byCode = new Map();
  for (const [action, code] of Object.entries(settings.keybinds)) if (code) byCode.set(code, action);
}
rebuild();
onSettingsChange((name) => { if (name === 'keybinds') rebuild(); });

/** Action bound to a KeyboardEvent.code or 'MouseN', or undefined. */
export const actionFor = (code) => byCode.get(code);

export const mouseCode = (button) => `Mouse${button}`;

/** Display name of the key bound to an action, e.g. 'G' or 'Left click'. */
export const keyFor = (action) => keyLabel(settings.keybinds[action]);

/** Replace {action} placeholders in text with the bound key, e.g. 'press {ability} again'. */
export const fillKeys = (text) => String(text).replace(/\{(\w+)\}/g, (m, a) => (a in settings.keybinds ? keyFor(a) : m));
