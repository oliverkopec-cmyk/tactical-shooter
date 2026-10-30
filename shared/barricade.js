// The shape of a barricade: a solid panel of seven thin horizontal wooden planks across a doorway
// or window. A window is covered completely. A door keeps a low gap at the bottom (no plank)
// so a drone can drive under it; the gap is lower than a prone player is tall, so players
// can't get through. Shared so the server and the clients build the same pieces.
//
// Each plank is cut into 3 segments (left, middle, right). A grid section is one column
// and two planks on top of each other (a third of the width, 2 planks tall), starting at any
// plank, so a melee hit makes its hole at the height you aim at. Segment index = plank * 3 + column.
// Two diagonal planks (an X) are drawn over the front; the client cuts them per segment so a hole
// goes through both layers (they have no collision of their own).

import { BARRICADE } from './constants.js';

export const BARRICADE_COLS = 3;
const SECTION_PLANKS = 2;

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
      out.push({ i: plank * BARRICADE_COLS + col, plank, col, min, max });
    }
  }
  return out;
}

/** Segment indices of one grid section: column 0-2 across, `plank` is the lower of its two planks (0 to planks - 2). */
export function sectionSegments(col, plank) {
  const out = [];
  for (let k = 0; k < SECTION_PLANKS; k++) out.push((plank + k) * BARRICADE_COLS + col);
  return out;
}

/** Which grid section a point on the barricade plane is aimed at: { col, plank } (the pair of planks centred on the aim). */
export function sectionAt(o, point) {
  const bottom = o.y0 + (o.window ? 0 : BARRICADE.gap);
  const pitch = (o.y1 - bottom) / BARRICADE.planks;
  const along = o.axis === 'x' ? point[0] : point[2];
  const col = Math.max(0, Math.min(BARRICADE_COLS - 1, Math.floor(((along - o.from) / (o.to - o.from)) * BARRICADE_COLS)));
  const plank = Math.max(0, Math.min(BARRICADE.planks - SECTION_PLANKS, Math.round((point[1] - bottom) / pitch) - 1));
  return { col, plank };
}

/** Which face the X goes on: +1 or -1 along the wall's normal, the side facing away from the map centre. */
export function barricadeFront(o) {
  return o.fixed >= 0 ? 1 : -1;
}
