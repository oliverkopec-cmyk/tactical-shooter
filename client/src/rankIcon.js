// Rank icons, drawn as inline SVG (no image files): a shield in the rank's colour with its
// own emblem, getting grander up the ladder.

import { rankInfo } from '../../shared/progression.js';

const line = (c, d, w = 4) => `<path d="${d}" fill="none" stroke="${c}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;
const STAR = '24,12 27.4,21.2 37.2,21.8 29.6,28 32.2,37.6 24,32.2 15.8,37.6 18.4,28 10.8,21.8 20.6,21.2';
const EMBLEM = {
  bronze: (c) => line(c, 'M14 34 L24 25 L34 34', 5),                                                     // one chevron
  silver: (c) => line(c, 'M14 30 L24 21 L34 30', 4) + line(c, 'M14 38 L24 29 L34 38', 4),                // two chevrons
  gold: (c) => `<polygon points="${STAR}" fill="${c}"/>`,                                                // a star
  platinum: (c) => `<polygon points="24,12 35,18.5 35,31.5 24,38 13,31.5 13,18.5" fill="${c}" fill-opacity="0.3" stroke="${c}" stroke-width="3" stroke-linejoin="round"/>${line(c, 'M24 12 V25 M13 18.5 L24 25 L35 18.5', 2)}`,   // a cut gem
  diamond: (c) => `<polygon points="16,14 32,14 39,22 24,40 9,22" fill="${c}" fill-opacity="0.32" stroke="${c}" stroke-width="3" stroke-linejoin="round"/>${line(c, 'M9 22 H39 M18 22 L24 40 L30 22 M16 14 L18 22 L24 14 L30 22 L32 14', 1.8)}`,   // a diamond
  champion: (c) => `<polygon points="10,31 8,15 17,22 24,10 31,22 40,15 38,31" fill="${c}" stroke="${c}" stroke-width="2" stroke-linejoin="round"/><rect x="11" y="34" width="26" height="4" rx="1.5" fill="${c}"/><circle cx="24" cy="26" r="2.6" fill="#12161c"/>`,   // a crown
};

/** points: rank points (or an object from rankInfo). Returns an SVG string. */
export function rankIcon(points, size = 40) {
  const info = typeof points === 'number' ? rankInfo(points) : points;
  const c = info.color;
  const mark = (EMBLEM[info.id] || EMBLEM.bronze)(c);
  return `<svg class="rank-icon" width="${size}" height="${Math.round(size * 1.1)}" viewBox="0 0 48 54" role="img" aria-label="${info.label}">
    <path d="M24 2 L44 9 V27 C44 39 35 47 24 52 C13 47 4 39 4 27 V9 Z" fill="#12161c" stroke="${c}" stroke-width="3" stroke-linejoin="round"/>
    <path d="M24 7 L39 12.5 V27 C39 36 32 43 24 47 C16 43 9 36 9 27 V12.5 Z" fill="${c}" fill-opacity="0.14"/>
    ${mark}
  </svg>`;
}
