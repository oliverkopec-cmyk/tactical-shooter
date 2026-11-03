// Placing things takes time (Stage 27). Every gadget that is put down (claymores, wire, cameras,
// jammers, shields, breach charges, barricades, reinforcements, and the Stage 16 / E gadgets) is
// placed by holding its key while a circle fills. The server times it; the client draws the circle
// and a ghost of the item where it will go, white if the spot is valid and red if it isn't.
//
// Shared so the ghost on the client and the check the server makes when placing starts agree.

import {
  WIRE, CAMERA_REACH, GADGET_REACH, CHARGE_REACH, REINFORCE_REACH, REINFORCE_TIME_MS, BARRICADE, SHIELD,
} from './constants.js';
import { UTIL_STATS, ABILITY_STATS } from './utilities.js';
import { getEyePosition, forwardVec } from './movement.js';
import { aimDirection } from './weapons.js';
import { raycastWorld } from './raycast.js';
import { findOpening } from './mapkit.js';

/**
 * What can be placed, keyed by the utility id, ability id or action:
 *   label   shown under the circle       ms      how long the circle takes
 *   surface where it goes: 'floor', 'floorWall' (not a ceiling), 'any', 'panel' (a breakable wall,
 *           barricade or armour panel), 'section' (a wall to reinforce), 'opening' (a doorway or window),
 *           'battery' (a reinforced wall, hatch or armour panel), 'front' (stands in front of you)
 *   reach   metres                       ghost   size of the ghost [width, height, depth] (flat on a floor)
 *   pose    'floor' (kneel) or 'wall' (reach forward); 'auto' picks by the surface aimed at
 */
export const PLACE = {
  claymore: { label: 'Claymore', ms: 1000, surface: 'floorWall', reach: UTIL_STATS.claymore.reach, ghost: [0.26, 0.14, 0.06], pose: 'auto' },
  barbedWire: { label: 'Barbed wire', ms: 1000, surface: 'floor', reach: WIRE.reach, ghost: [WIRE.size, 0.35, WIRE.size], pose: 'floor' },
  camera: { label: 'Camera', ms: 1000, surface: 'any', reach: CAMERA_REACH, ghost: [0.17, 0.12, 0.22], pose: 'wall' },
  jammerDevice: { label: 'Signal jammer', ms: 1500, surface: 'any', reach: GADGET_REACH, ghost: [0.28, 0.2, 0.12], pose: 'auto' },
  shield: { label: 'Deployable shield', ms: 1000, surface: 'front', reach: SHIELD.distance, ghost: [SHIELD.width, SHIELD.height, SHIELD.thickness], pose: 'wall' },
  breach: { label: 'Breach charge', ms: 1500, surface: 'panel', reach: CHARGE_REACH, ghost: [0.5, 0.5, 0.05], pose: 'wall' },
  heavyBreach: { label: 'Heavy breach charge', ms: 1500, surface: 'panel', reach: CHARGE_REACH, ghost: [0.7, 0.7, 0.06], pose: 'wall' },
  barricade: { label: 'Barricade', ms: BARRICADE.channelMs, surface: 'opening', reach: BARRICADE.reach, pose: 'wall' },
  reinforce: { label: 'Reinforcing', ms: REINFORCE_TIME_MS, surface: 'section', reach: REINFORCE_REACH, pose: 'wall' },
  masonReinforce: { label: 'Reinforcing', ms: REINFORCE_TIME_MS, surface: 'section', reach: REINFORCE_REACH, pose: 'wall' },
  shockTrap: { label: 'Shock trap', ms: 1000, surface: 'floor', reach: ABILITY_STATS.shock.reach, ghost: [0.9, 0.06, 0.9], pose: 'floor' },
  healField: { label: 'Healing field', ms: 1000, surface: 'floor', reach: ABILITY_STATS.heal.reach, ghost: [6, 0.04, 6], pose: 'floor' },
  alarmSensor: { label: 'Alarm sensor', ms: 1000, surface: 'floorWall', reach: ABILITY_STATS.sensor.reach, ghost: [0.18, 0.1, 0.05], pose: 'auto' },
  shockWire: { label: 'Shock wire', ms: 1500, surface: 'battery', reach: ABILITY_STATS.wire.reach, ghost: [0.2, 0.26, 0.1], pose: 'wall' },
  armorPanel: { label: 'Armour panel', ms: ABILITY_STATS.armor.channelMs, surface: 'opening', reach: ABILITY_STATS.armor.reach, pose: 'wall' },
  interceptor: { label: 'Interceptor', ms: 1000, surface: 'floorWall', reach: ABILITY_STATS.intercept.reach, ghost: [0.24, 0.24, 0.08], pose: 'auto' },
};

export const PLACE_SLOW = 0.4;   // walking speed multiplier while placing

/**
 * Where an item would go if placing started now: { ok, reason, point, normal, pose, opening, box }.
 * world: the World (client or server copy); map: the map; s: the player's state.
 * Only the geometry is checked here; the server checks the rest (charges, phase, who's in the way).
 */
export function placementTarget(kind, world, map, s) {
  const P = PLACE[kind];
  if (!P) return { ok: false, reason: '' };
  const e = getEyePosition(s, world), eye = [e.x, e.y, e.z];
  const dir = aimDirection(s.yaw, s.pitch);
  if (P.surface === 'front') {
    const [fx, fz] = forwardVec(s.yaw);
    return { ok: true, point: [s.x + fx * P.reach, s.y, s.z + fz * P.reach], normal: [-fx, 0, -fz], pose: 'wall' };
  }
  if (P.surface === 'opening') {
    const o = findOpening(map, eye, dir, P.reach);
    if (!o) return { ok: false, reason: 'Aim at a doorway or window close by.' };
    return { ok: true, opening: o, pose: 'wall' };
  }
  const hit = raycastWorld(world, eye, dir, P.reach);
  const far = `within ${P.reach} m`;
  if (!hit) {
    const miss = { floor: `Aim at the floor ${far}.`, floorWall: `Aim at a floor or wall ${far}.`, any: `Aim at a surface ${far}.` }[P.surface];
    return { ok: false, reason: miss || `Aim at a wall ${far}.`, point: eye.map((v, i) => v + dir[i] * P.reach), normal: [0, 1, 0], pose: 'wall' };
  }
  const { point, normal, box } = hit;
  const pose = P.pose === 'auto' ? (normal[1] > 0.5 ? 'floor' : 'wall') : P.pose;
  const out = { ok: true, point, normal, box, pose };
  const no = (reason) => ({ ...out, ok: false, reason });
  switch (P.surface) {
    case 'floor': return normal[1] > 0.7 ? out : no(`Aim at the floor ${far}.`);
    case 'floorWall': return normal[1] >= -0.5 ? out : no('Not on a ceiling.');
    case 'panel': {
      if (box.kind === 'barricade' || box.kind === 'armor') return out;
      if (box.kind !== 'panel') return no(`Aim at a breakable wall ${far}.`);
      if (kind === 'breach' && world.isReinforcedPanel(box.id)) return no('That wall is reinforced. Only a heavy charge breaks it.');
      return out;
    }
    case 'section': {
      if (box.kind !== 'panel') return no(`Aim at a breakable wall ${far}.`);
      const section = world.sections[box.sectionId];
      if (!section.reinforceable) return no('That piece of wall is too small to reinforce.');
      if (world.reinforced[section.id]) return no('Already reinforced.');
      if (!world.sectionIntact(section.id)) return no('Damaged walls can\'t be reinforced.');
      return { ...out, section };
    }
    case 'battery': {
      if (box.kind === 'armor') return out;
      if (box.kind === 'panel' && (world.panels[box.id].hatch || world.isReinforcedPanel(box.id))) return out;
      return no('Shock wires go on reinforced walls, hatches and armour panels.');
    }
    default: return out;
  }
}
