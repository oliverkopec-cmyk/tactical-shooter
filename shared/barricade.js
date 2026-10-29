// The shape of a barricade: six parallel wooden planks across a doorway or window, evenly
// spaced, with the bottom left open (no plank) so a drone can drive under it. The gap is
// lower than a prone player is tall, and the gaps between planks are smaller still, so
// players can't get through. Shared so the server and the clients build the same planks.

import { BARRICADE } from './constants.js';

/** The planks for an opening (see MAP.openings): [{ i, min, max }] from the lowest plank up. */
export function barricadePlanks(o) {
  const t = BARRICADE.thickness / 2;
  const bottom = o.y0 + BARRICADE.gap;                   // the open gap is below the first plank
  const pitch = (o.y1 - bottom) / BARRICADE.planks;      // spacing between plank bottoms
  const h = pitch * 0.7;
  const planks = [];
  for (let i = 0; i < BARRICADE.planks; i++) {
    const y0 = bottom + i * pitch;
    const min = o.axis === 'x' ? [o.from, y0, o.fixed - t] : [o.fixed - t, y0, o.from];
    const max = o.axis === 'x' ? [o.to, y0 + h, o.fixed + t] : [o.fixed + t, y0 + h, o.to];
    planks.push({ i, min, max });
  }
  return planks;
}
