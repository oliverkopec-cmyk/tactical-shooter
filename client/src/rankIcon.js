// Rank icons, drawn as inline SVG (no image files): a shield in the rank's
// colour with one, two or three chevrons for the tier, or a star for Champion.

import { rankInfo } from '../../shared/progression.js';

/** points: rank points (or an object from rankInfo). Returns an SVG string. */
export function rankIcon(points, size = 40) {
  const info = typeof points === 'number' ? rankInfo(points) : points;
  const c = info.color;
  let mark;
  if (info.tier === 0) {
    // Champion: a five-point star
    mark = `<polygon points="24,14 27.6,23.4 37.6,24 29.8,30.2 32.4,40 24,34.4 15.6,40 18.2,30.2 10.4,24 20.4,23.4" fill="${c}"/>`;
  } else {
    mark = Array.from({ length: info.tier }, (_, i) => {
      const y = 38 - i * 9 - (3 - info.tier) * 2.5;
      return `<path d="M14 ${y} L24 ${y - 8} L34 ${y}" fill="none" stroke="${c}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>`;
    }).join('');
  }
  return `<svg class="rank-icon" width="${size}" height="${Math.round(size * 1.1)}" viewBox="0 0 48 54" role="img" aria-label="${info.label}">
    <path d="M24 2 L44 9 V27 C44 39 35 47 24 52 C13 47 4 39 4 27 V9 Z" fill="#12161c" stroke="${c}" stroke-width="3" stroke-linejoin="round"/>
    <path d="M24 7 L39 12.5 V27 C39 36 32 43 24 47 C16 43 9 36 9 27 V12.5 Z" fill="${c}" fill-opacity="0.14"/>
    ${mark}
  </svg>`;
}
