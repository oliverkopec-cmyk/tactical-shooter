// Phase rules shared by client prediction and server authority.

import { KEY, PHASE } from './constants.js';

/**
 * Which inputs count in the current phase.
 * Intro and round end: nobody moves or fires. Prep: attackers wait in spawn
 * (they scout with drones from stage 5), defenders may move and shoot.
 */
export function maskKeys(keys, team, phase) {
  switch (phase) {
    case PHASE.ACTION: return keys;
    case PHASE.PREP: return team === 'defense' ? keys : keys & KEY.RELOAD;
    default: return keys & KEY.RELOAD;
  }
}

/** The objective zone: horizontal radius around the box, on the objective's floor. */
export function inObjectiveZone(objective, state) {
  const dx = state.x - objective.x, dz = state.z - objective.z;
  return Math.hypot(dx, dz) <= objective.zoneRadius && Math.abs(state.y - objective.y) < 2.2;
}
