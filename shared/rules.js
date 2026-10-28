// Phase rules shared by client prediction and server authority.

import { KEY, PHASE } from './constants.js';
import { MAP } from './map.js';

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

/**
 * Where an attacker appears: their chosen entry point (1-3), spread sideways so
 * attackers who picked the same point don't overlap. slot/count are the
 * attacker's index among those sharing the point.
 */
export function attackSpawnPoint(choice, slot = 0, count = 1) {
  const base = MAP.spawns.attack[(Math.max(1, Math.min(MAP.spawns.attack.length, choice | 0)) - 1)];
  const off = (slot - (count - 1) / 2) * 1.5;
  // Sideways = perpendicular to facing; yaw 0 faces -z, right vector is (cos, -sin)
  return { x: base.x + Math.cos(base.yaw) * off, y: base.y, z: base.z - Math.sin(base.yaw) * off, yaw: base.yaw };
}

/** The objective zone: horizontal radius around the box, on the objective's floor. */
export function inObjectiveZone(objective, state) {
  const dx = state.x - objective.x, dz = state.z - objective.z;
  return Math.hypot(dx, dz) <= objective.zoneRadius && Math.abs(state.y - objective.y) < 2.2;
}
