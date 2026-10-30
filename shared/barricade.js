// The shape of a barricade: a solid panel of six horizontal wooden planks across a doorway
// or window. A window is covered completely. A door keeps a low gap at the bottom (no plank)
// so a drone can drive under it; the gap is lower than a prone player is tall, so players
// can't get through. Shared so the server and the clients build the same pieces.
//
// Each plank is cut into 3 segments (left, middle, right), so the panel is a grid of
// 3 columns x 3 rows, each row 2 planks tall. A grid section is one column of one row
// (a third of the width, 2 planks tall). Segment index = plank * 3 + column.

import { BARRICADE } from './constants.js';

export const BARRICADE_COLS = 3;
export const BARRICADE_ROWS = BARRICADE.planks / 2;
const PLANKS_PER_ROW = 2;

/** The segments for an opening (see MAP.openings): [{ i, plank, col, row, min, max }], lowest plank first. */
export function barricadePlanks(o) {
  const t = BARRICADE.thickness / 2;
  const bottom = o.y0 + (o.window ? 0 : BARRICADE.gap);   // doors: the open gap is below the first plank
  const pitch = (o.y1 - bottom) / BARRICADE.planks;       // planks touch: a solid panel
  const w = (o.to - o.from) / BARRICADE_COLS;
  const out = [];
  for (let plank = 0; plank < BARRICADE.planks; plank++) {
    const y0 = bottom + plank * pitch;
    for (let col = 0; col < BARRICADE_COLS; col++) {
      const a = o.from + col * w, b = a + w;
      const min = o.axis === 'x' ? [a, y0, o.fixed - t] : [o.fixed - t, y0, a];
      const max = o.axis === 'x' ? [b, y0 + pitch, o.fixed + t] : [o.fixed + t, y0 + pitch, b];
      out.push({ i: plank * BARRICADE_COLS + col, plank, col, row: Math.floor(plank / PLANKS_PER_ROW), min, max });
    }
  }
  return out;
}

/** Segment indices of one grid section (column 0-2 across, row 0-2 from the bottom). */
export function sectionSegments(col, row) {
  const out = [];
  for (let k = 0; k < PLANKS_PER_ROW; k++) out.push((row * PLANKS_PER_ROW + k) * BARRICADE_COLS + col);
  return out;
}
