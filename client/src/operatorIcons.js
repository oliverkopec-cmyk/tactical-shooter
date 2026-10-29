// Operator icons, drawn in code: a bold white (or dark, on light colours) symbol of the
// operator's ability on a rounded square in the operator's colour. Original artwork.

import { OPERATORS } from '../../shared/operators.js';

// Each symbol is drawn in a 64 x 64 box. {c} is replaced by the symbol colour.
const SYMBOLS = {
  // attackers
  spark: '<polygon points="32,6 38,24 56,18 44,32 58,44 38,40 32,58 26,40 6,44 20,32 8,18 26,24" fill="{c}"/>',                       // breach blast
  hawk: '<path d="M6 32 Q32 8 58 32 Q32 56 6 32 Z" fill="none" stroke="{c}" stroke-width="5" stroke-linejoin="round"/><circle cx="32" cy="32" r="8" fill="{c}"/>',   // watching eye
  bulwark: '<path d="M32 6 L54 14 V32 C54 44 44 52 32 58 C20 52 10 44 10 32 V14 Z" fill="{c}"/>',                                     // shield
  flash: '<path d="M32 4 L38 26 L60 32 L38 38 L32 60 L26 38 L4 32 L26 26 Z" fill="{c}"/>',                                             // bright flash
  tremor: '<circle cx="32" cy="32" r="6" fill="{c}"/><circle cx="32" cy="32" r="16" fill="none" stroke="{c}" stroke-width="5"/><circle cx="32" cy="32" r="27" fill="none" stroke="{c}" stroke-width="5" stroke-dasharray="14 8"/>',   // pulse waves
  cinder: '<path d="M32 4 C36 16 52 22 52 40 C52 52 43 60 32 60 C21 60 12 52 12 40 C12 32 18 28 20 22 C24 28 26 30 28 30 C28 20 28 12 32 4 Z" fill="{c}"/>',   // flame
  surge: '<circle cx="32" cy="32" r="25" fill="none" stroke="{c}" stroke-width="5"/><polygon points="36,10 20,34 30,34 26,54 44,28 33,28" fill="{c}"/>',    // EMP bolt in a ring
  recruit_atk: '<polyline points="12,40 32,18 52,40" fill="none" stroke="{c}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/><polyline points="12,54 32,32 52,54" fill="none" stroke="{c}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>',
  // defenders
  warden: '<line x1="10" y1="10" x2="54" y2="54" stroke="{c}" stroke-width="5" stroke-linecap="round"/><line x1="54" y1="10" x2="10" y2="54" stroke="{c}" stroke-width="5" stroke-linecap="round"/><g fill="{c}"><polygon points="32,14 36,22 28,22"/><polygon points="32,50 36,42 28,42"/><polygon points="14,32 22,28 22,36"/><polygon points="50,32 42,28 42,36"/></g>',   // barbed wire
  jammer: '<path d="M14 40 Q32 14 50 40" fill="none" stroke="{c}" stroke-width="5" stroke-linecap="round"/><path d="M22 44 Q32 30 42 44" fill="none" stroke="{c}" stroke-width="5" stroke-linecap="round"/><circle cx="32" cy="50" r="4" fill="{c}"/><line x1="8" y1="8" x2="56" y2="56" stroke="{c}" stroke-width="6" stroke-linecap="round"/>',   // blocked signal
  lookout: '<rect x="8" y="18" width="38" height="28" rx="5" fill="{c}"/><polygon points="46,28 58,20 58,44 46,36" fill="{c}"/><circle cx="27" cy="32" r="7" fill="none" stroke="#000" stroke-opacity="0.45" stroke-width="3"/>',   // camera
  mason: '<g fill="{c}"><rect x="6" y="10" width="24" height="14" rx="2"/><rect x="34" y="10" width="24" height="14" rx="2"/><rect x="20" y="26" width="24" height="14" rx="2"/><rect x="6" y="26" width="10" height="14" rx="2"/><rect x="48" y="26" width="10" height="14" rx="2"/><rect x="6" y="42" width="24" height="14" rx="2"/><rect x="34" y="42" width="24" height="14" rx="2"/></g>',   // bricks
  volt: '<ellipse cx="32" cy="52" rx="22" ry="7" fill="none" stroke="{c}" stroke-width="5"/><polygon points="36,6 18,34 30,34 26,50 46,24 34,24" fill="{c}"/>',   // shock pad with bolt
  tonic: '<path d="M24 8 H40 V24 H56 V40 H40 V56 H24 V40 H8 V24 H24 Z" fill="{c}"/>',                                                  // cross
  picket: '<circle cx="12" cy="32" r="6" fill="{c}"/><line x1="18" y1="32" x2="58" y2="32" stroke="{c}" stroke-width="4" stroke-linecap="round"/><line x1="17" y1="28" x2="56" y2="12" stroke="{c}" stroke-width="4" stroke-linecap="round"/><line x1="17" y1="36" x2="56" y2="52" stroke="{c}" stroke-width="4" stroke-linecap="round"/>',   // laser fan
  recruit_def: '<polyline points="12,24 32,46 52,24" fill="none" stroke="{c}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/><polyline points="12,10 32,32 52,10" fill="none" stroke="{c}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>',
};

const hex = (n) => `#${n.toString(16).padStart(6, '0')}`;
const luminance = (n) => (((n >> 16) & 255) * 0.299 + ((n >> 8) & 255) * 0.587 + (n & 255) * 0.114) / 255;

/**
 * The icon for an operator as an SVG string, or a "?" icon for id null (an enemy not seen yet).
 * dead: crossed out and darkened.
 */
export function operatorIcon(id, size = 56, { dead = false } = {}) {
  const op = OPERATORS[id];
  if (!op) {
    return `<svg class="op-icon unknown${dead ? ' dead' : ''}" width="${size}" height="${size}" viewBox="0 0 64 64" role="img" aria-label="Unknown operator">
      <rect x="2" y="2" width="60" height="60" rx="10" fill="#2a303a"/><text x="32" y="44" text-anchor="middle" font-size="38" font-weight="800" fill="#7d8794" font-family="system-ui, sans-serif">?</text>
      ${dead ? '<line x1="8" y1="8" x2="56" y2="56" stroke="#e8604a" stroke-width="6" stroke-linecap="round"/>' : ''}</svg>`;
  }
  const bg = hex(op.color), fg = luminance(op.color) > 0.72 ? '#12161c' : '#ffffff';
  const symbol = (SYMBOLS[id] || SYMBOLS.recruit_atk).replace(/\{c\}/g, fg);
  return `<svg class="op-icon${dead ? ' dead' : ''}" width="${size}" height="${size}" viewBox="0 0 64 64" role="img" aria-label="${op.name}">
    <defs><linearGradient id="g-${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${bg}"/><stop offset="1" stop-color="${bg}" stop-opacity="0.72"/></linearGradient></defs>
    <rect x="2" y="2" width="60" height="60" rx="10" fill="url(#g-${id})"/><rect x="2" y="2" width="60" height="60" rx="10" fill="none" stroke="rgba(255,255,255,0.25)" stroke-width="2"/>
    <g transform="translate(8 8) scale(0.75)">${symbol}</g>
    ${dead ? '<rect x="2" y="2" width="60" height="60" rx="10" fill="rgba(0,0,0,0.62)"/><line x1="8" y1="8" x2="56" y2="56" stroke="#e8604a" stroke-width="6" stroke-linecap="round"/>' : ''}
  </svg>`;
}

/** Big faint symbols behind each side's section of the Operators tab. */
export function sideSymbol(team) {
  return team === 'attack'
    ? '<svg viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round"><circle cx="50" cy="50" r="30"/><line x1="50" y1="6" x2="50" y2="30"/><line x1="50" y1="70" x2="50" y2="94"/><line x1="6" y1="50" x2="30" y2="50"/><line x1="70" y1="50" x2="94" y2="50"/><circle cx="50" cy="50" r="4" fill="currentColor"/></svg>'
    : '<svg viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="5" stroke-linejoin="round"><path d="M50 6 L86 20 V48 C86 70 70 86 50 94 C30 86 14 70 14 48 V20 Z"/><path d="M50 22 L72 31 V49 C72 61 63 70 50 76 C37 70 28 61 28 49 V31 Z"/></svg>';
}
