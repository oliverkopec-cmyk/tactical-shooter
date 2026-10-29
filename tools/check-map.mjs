// Walkability check for the maps. Run after changing a map:
//   node tools/check-map.mjs            (all maps)
//   node tools/check-map.mjs estate     (one map)
//
// It walks a grid with the same collision code the game uses and reports anything
// a player could not reach: rooms closed off by furniture, stairs that don't connect,
// spawns inside objects, sites or doors that can't be reached from the attackers' entries.

import { getMap, MAP_IDS } from '../shared/map.js';
import { World } from '../shared/world.js';
import { isSpaceFree, sweepDown } from '../shared/movement.js';
import { STEP_HEIGHT } from '../shared/constants.js';

const H = 1.8, STEP = 0.5;
const key = (x, z, y) => `${Math.round(x / STEP)},${Math.round(z / STEP)},${Math.round(y * 5)}`;

/** Every standing position reachable from the starts, walking on `world`. */
function floodFrom(world, starts, limit) {
  const seen = new Map();
  const queue = [];
  const add = (x, z, y) => { const k = key(x, z, y); if (!seen.has(k)) { seen.set(k, { x, z, y }); queue.push({ x, z, y }); } };
  for (const s of starts) add(s.x, s.z, s.y);
  const dirs = [];
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) if (dx || dz) dirs.push([dx * STEP, dz * STEP]);
  while (queue.length) {
    const { x, z, y } = queue.pop();
    for (const [dx, dz] of dirs) {
      const nx = x + dx, nz = z + dz;
      if (Math.abs(nx) > limit || Math.abs(nz) > limit) continue;
      if (!isSpaceFree(world, nx, y + STEP_HEIGHT, nz, H)) continue;
      const down = sweepDown(world, nx, y + STEP_HEIGHT, nz, H, STEP_HEIGHT + 0.5);
      const found = down > y + STEP_HEIGHT - (STEP_HEIGHT + 0.5) + 1e-3;     // a surface was actually hit
      if (!found || down < y - 0.5) continue;
      if (!isSpaceFree(world, nx, down, nz, H)) continue;
      if (!isSpaceFree(world, x + dx / 2, Math.max(y, down), z + dz / 2, H)) continue;
      add(nx, nz, down);
    }
  }
  return seen;
}

function reached(seen, x, z, y, tol = 0.35) {
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
    for (let dy = -2; dy <= 2; dy++) {
      const p = seen.get(`${Math.round(x / STEP) + dx},${Math.round(z / STEP) + dz},${Math.round(y * 5) + dy}`);
      if (p && Math.abs(p.y - y) <= tol) return true;
    }
  }
  return false;
}

export function debugFlood(id, start) {
  const map = getMap(id); const world = new World(map);
  return floodFrom(world, [start], map.size - 2);
}

function check(id) {
  const map = getMap(id);
  const world = new World(map);
  const problems = [];
  // Standing room: open space, and a surface right under the feet (not just air)
  const standable = (x, z, y) => isSpaceFree(world, x, y, z, H) && sweepDown(world, x, y + 0.05, z, H, 0.1) > y - 0.05 + 1e-3;
  const say = (ok, msg) => { if (!ok) problems.push(msg); };

  // Spawns and sites must be on open floor
  map.spawns.attack.forEach((s) => say(standable(s.x, s.z, s.y), `attack spawn ${s.name} (${s.x}, ${s.z}) is not on open floor`));
  map.spawns.defense.forEach((s, i) => say(standable(s.x, s.z, s.y), `defense spawn ${i} (${s.x}, ${s.y}, ${s.z}) is not on open floor`));
  map.siteSpawns.forEach((list, i) => list.forEach((s, j) => say(standable(s.x, s.z, s.y), `site ${i} spawn ${j} (${s.x}, ${s.y}, ${s.z}) is blocked`)));

  // From each attacker entry, everyone must be able to get to every site and every spawn
  const limit = map.size - 2;
  let outside = null;
  for (const s of map.spawns.attack) {
    const seen = floodFrom(world, [{ x: s.x, z: s.z, y: s.y }], limit);
    outside = outside || seen;
    map.sites.forEach((site) => say(reached(seen, site.x - 1.6, site.z, site.y), `from the ${s.name} entry the ${site.name} can't be reached`));
    map.spawns.defense.forEach((d, i) => say(reached(seen, d.x, d.z, d.y), `from the ${s.name} entry defense spawn ${i} can't be reached`));
    map.spawns.attack.forEach((o) => say(reached(seen, o.x, o.z, o.y), `from the ${s.name} entry the ${o.name} entry can't be reached`));
  }

  // Every doorway on the ground floor, from the outside
  const exteriorDoors = map.openings.filter((o) => o.exterior && o.y0 < 0.1);
  for (const o of exteriorDoors) {
    const mid = (o.from + o.to) / 2;
    const out = o.axis === 'x' ? [mid, o.fixed + (o.fixed < 0 ? -1.2 : 1.2)] : [o.fixed + (o.fixed < 0 ? -1.2 : 1.2), mid];
    const inn = o.axis === 'x' ? [mid, o.fixed + (o.fixed < 0 ? 1.2 : -1.2)] : [o.fixed + (o.fixed < 0 ? 1.2 : -1.2), mid];
    say(reached(outside, out[0], out[1], 0), `outside ${o.name} door at ${mid.toFixed(1)}: not reachable from the attackers' entries`);
    say(reached(outside, inn[0], inn[1], 0.02), `inside ${o.name} door at ${mid.toFixed(1)}: not reachable`);
  }

  // Every open standing spot in the building, on each floor: could a player get there?
  const floors = [0.02, 3.2, 6.4];
  const lost = [];
  let total = 0;
  for (const y of floors) {
    for (let x = -19; x <= 19; x += 1) for (let z = -13; z <= 13; z += 1) {
      if (!standable(x, z, y) || (y > 6 && x > -8.2)) continue;
      if (y > 3 && y < 4 && false) continue;
      total++;
      if (!reached(outside, x, z, y)) lost.push({ x, z, y });
    }
  }
  const pct = total ? Math.round((lost.length / total) * 100) : 0;
  return { map, problems, total, lost, pct };
}

if (import.meta.url === `file://${process.argv[1]}`) {
let failed = false;
for (const id of process.argv.slice(2).length ? process.argv.slice(2) : MAP_IDS) {
  const { map, problems, total, lost, pct } = check(id);
  console.log(`\n${map.name} (${id}): ${map.boxes.length} boxes, ${map.openings.length} doors and windows, ${total} open spots checked`);
  for (const p of problems) console.log('  PROBLEM:', p);
  if (lost.length) {
    console.log(`  ${lost.length} open spots (${pct}%) can't be reached from outside, for example:`);
    const byFloor = {};
    for (const s of lost) (byFloor[s.y] ||= []).push(`(${s.x}, ${s.z})`);
    for (const [y, list] of Object.entries(byFloor)) console.log(`    floor y=${y}: ${list.length}: ${list.slice(0, 12).join(' ')}${list.length > 12 ? ' …' : ''}`);
  }
  if (problems.length || pct > 6) failed = true;
  else console.log('  OK: every spawn, site and doorway is reachable');
}
process.exit(failed ? 1 : 0);
}
