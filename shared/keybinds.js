// Rebindable controls. Each action has one binding: a KeyboardEvent.code
// ('KeyW', 'Space', 'ShiftLeft', ...) or a mouse button ('Mouse0' left,
// 'Mouse1' middle, 'Mouse2' right, 'Mouse3'/'Mouse4' side buttons).
// Shared so the server can clean the keybinds saved to an account.

export const BIND_ACTIONS = [
  { id: 'forward', label: 'Move forward', group: 'Movement', key: 'KeyW' },
  { id: 'back', label: 'Move back', group: 'Movement', key: 'KeyS' },
  { id: 'left', label: 'Move left', group: 'Movement', key: 'KeyA' },
  { id: 'right', label: 'Move right', group: 'Movement', key: 'KeyD' },
  { id: 'sprint', label: 'Sprint', group: 'Movement', key: 'ShiftLeft' },
  { id: 'jump', label: 'Jump', group: 'Movement', key: 'Space' },
  { id: 'crouch', label: 'Crouch (hold)', group: 'Movement', key: 'KeyC' },
  { id: 'prone', label: 'Prone (toggle)', group: 'Movement', key: 'KeyZ' },
  { id: 'leanLeft', label: 'Lean left', group: 'Movement', key: 'KeyQ' },
  { id: 'leanRight', label: 'Lean right', group: 'Movement', key: 'KeyE' },
  { id: 'rappel', label: 'Rappel: attach / let go', group: 'Movement', key: 'KeyN' },
  { id: 'flip', label: 'Flip upside down (hold, rappelling)', group: 'Movement', key: 'KeyM' },
  { id: 'fire', label: 'Fire / drone ping', group: 'Combat', key: 'Mouse0' },
  { id: 'melee', label: 'Melee', group: 'Combat', key: 'Mouse2' },
  { id: 'reload', label: 'Reload', group: 'Combat', key: 'KeyR' },
  { id: 'primary', label: 'Primary weapon', group: 'Combat', key: 'Digit1' },
  { id: 'secondary', label: 'Secondary weapon', group: 'Combat', key: 'Digit2' },
  { id: 'utility', label: 'Use utility', group: 'Combat', key: 'Digit4' },
  { id: 'ability', label: 'Operator ability', group: 'Combat', key: 'KeyF' },
  { id: 'breach', label: 'Breach charge (attack)', group: 'Gadgets', key: 'KeyG' },
  { id: 'droneNext', label: 'Switch drone (attack)', group: 'Gadgets', key: 'KeyX' },
  { id: 'reinforce', label: 'Reinforce wall (defense)', group: 'Gadgets', key: 'KeyV' },
  { id: 'barricade', label: 'Barricade (defense)', group: 'Gadgets', key: 'KeyB' },
  { id: 'camView', label: 'Cameras (defense)', group: 'Gadgets', key: 'KeyT' },
  { id: 'scoreboard', label: 'Scoreboard (hold)', group: 'Interface', key: 'Tab' },
  { id: 'toggleHint', label: 'Show / hide key hints', group: 'Interface', key: 'KeyH' },
];

export const DEFAULT_KEYBINDS = Object.fromEntries(BIND_ACTIONS.map((a) => [a.id, a.key]));

/**
 * Keys that always keep their own job: Esc (pause). Keys 1-3 also choose the
 * entry point while you're an attacker in prep, whatever they're bound to.
 */
export const RESERVED_CODES = new Set(['Escape']);

const CODE_RE = /^[A-Za-z0-9]{1,24}$/;

export function isBindableCode(code) {
  return typeof code === 'string' && CODE_RE.test(code) && !RESERVED_CODES.has(code);
}

/**
 * Known actions only; anything missing or invalid gets its default. A code may
 * only be used once: later duplicates become unbound ('').
 */
export function sanitizeKeybinds(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const out = {};
  const used = new Set();
  for (const { id, key } of BIND_ACTIONS) {
    let code = id in src ? src[id] : key;
    if (code !== '' && !isBindableCode(code)) code = key;
    if (code && used.has(code)) code = '';
    if (code) used.add(code);
    out[id] = code;
  }
  return out;
}

const NAMED = {
  Mouse0: 'Left click', Mouse1: 'Middle click', Mouse2: 'Right click', Mouse3: 'Mouse back', Mouse4: 'Mouse forward',
  Space: 'Space', Tab: 'Tab', Enter: 'Enter', Backspace: 'Backspace', CapsLock: 'Caps Lock',
  ShiftLeft: 'Left Shift', ShiftRight: 'Right Shift', ControlLeft: 'Left Ctrl', ControlRight: 'Right Ctrl',
  AltLeft: 'Left Alt', AltRight: 'Right Alt', MetaLeft: 'Left Cmd', MetaRight: 'Right Cmd',
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
  Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\',
  Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/',
};

/** Short, readable name for a binding, e.g. 'KeyW' -> 'W'. */
export function keyLabel(code) {
  if (!code) return 'Unbound';
  if (NAMED[code]) return NAMED[code];
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (code.startsWith('Numpad')) return `Num ${code.slice(6)}`;
  if (/^Mouse\d+$/.test(code)) return `Mouse ${Number(code.slice(5)) + 1}`;
  return code;
}
