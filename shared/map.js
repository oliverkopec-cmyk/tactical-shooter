// The maps. Each map is built once from its file in shared/maps/ with the map kit.
// A match uses one map, chosen by the host in the lobby; client and server look
// it up by id, so everything that needs map data takes the map as an argument.

import { buildDockside } from './maps/dockside.js';
import { buildEstate } from './maps/estate.js';

export { findOpening } from './mapkit.js';

export const DEFAULT_MAP_ID = 'dockside';

const builders = { dockside: buildDockside, estate: buildEstate };
const built = new Map();

/** The map with this id (built on first use), or the default map for an unknown id. */
export function getMap(id) {
  const key = builders[id] ? id : DEFAULT_MAP_ID;
  if (!built.has(key)) built.set(key, builders[key]());
  return built.get(key);
}

export const MAP_IDS = Object.keys(builders);

/** What the lobby shows for each map. */
export function mapChoices() {
  return MAP_IDS.map((id) => {
    const m = getMap(id);
    return { id, name: m.name, description: m.description };
  });
}
