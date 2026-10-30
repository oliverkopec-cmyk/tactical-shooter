// The shape of a barricade: a solid panel of six horizontal wooden planks across a doorway
// or window. A window is covered completely. A door keeps a low gap at the bottom (no plank)
// so a drone can drive under it; the gap is lower than a prone player is tall, so players
// can't get through. Shared so the server and the clients build the same planks.

import { BARRICADE } from './constants.js';

/** The planks for an opening (see MAP.openings): [{ i, min, max }] from the lowest plank up. */
export function barricadePlanks(o) {
  const t = BARRICADE.thickness / 2;
  const bottom = o.y0 + (o.window ? 0 : BARRICADE.gap);   // doors: the open gap is below the first plank
  const pitch = (o.y1 - bottom) / BARRICADE.planks;      // spacing between plank bottoms
  const h = pitch;                                         // planks touch: a solid panel
  const planks = [];
  for (let i = 0; i < BARRICADE.planks; i++) {
    const y0 = bottom + i * pitch;
    const min = o.axis === 'x' ? [o.from, y0, o.fixed - t] : [o.fixed - t, y0, o.from];
    const max = o.axis === 'x' ? [o.to, y0 + h, o.fixed + t] : [o.fixed + t, y0 + h, o.to];
    planks.push({ i, min, max });
  }
  return planks;
}
