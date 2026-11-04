// Walkability check for the maps. Run after changing a map:
//   node tools/check-map.mjs            (all maps)
//   node tools/check-map.mjs estate     (one map)
//
// It walks a grid with the same collision code the game uses and reports anything
// a player could not reach: rooms closed off by furniture, stairs that don't connect,
// spawns inside objects, sites or doors that can't be reached from the attackers' entries.

import { getMap, MAP_IDS } from '../shared/map.js';
import { World } from '../shared/world.js';
import { isSpaceFree, sweepDown, createPlayerState, stepPlayer } from '../shared/movement.js';
import { DRONE, createDroneState, stepDrone } from '../shared/drone.js';
import { STEP_HEIGHT, KEY } from '../shared/constants.js';

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

/** Every spot a rolling drone can reach from the starts, without hopping. */
function droneFlood(world, starts, limit) {
  const seen = new Map();
  const queue = [];
  const add = (x, z, y) => { const k = key(x, z, y); if (!seen.has(k)) { seen.set(k, { x, z, y }); queue.push({ x, z, y }); } };
  for (const s of starts) add(s.x, s.z, s.y);
  const { radius: r, height: h, stepHeight } = DRONE;
  while (queue.length) {
    const { x, z, y } = queue.pop();
    for (const [dx, dz] of [[STEP, 0], [-STEP, 0], [0, STEP], [0, -STEP]]) {
      const nx = x + dx, nz = z + dz;
      if (Math.abs(nx) > limit || Math.abs(nz) > limit) continue;
      // A box lower than a drone step is climbed; the ground's surface always lifts it (sweepDown)
      const lift = y + stepHeight;
      if (!isSpaceFree(world, nx, lift, nz, h, r) || !isSpaceFree(world, x + dx / 2, lift, z + dz / 2, h, r)) continue;
      const down = sweepDown(world, nx, lift, nz, h, stepHeight + 0.5, r);
      if (down <= lift - stepHeight - 0.5 + 1e-3) continue;
      add(nx, nz, down);
    }
  }
  return seen;
}

/** Drive a person or a drone along a line with the real movement code. Returns null if it arrives, or where it stopped. */
function drive(world, agent, pts) {
  const [x, z] = pts[0], y = world.ground.surface(x, z) + 0.05, dt = 1 / 60;
  const s = agent === 'drone' ? createDroneState(x, y, z, 0) : createPlayerState({ x, y, z, yaw: 0 });
  let i = 1, best = Infinity, since = 0;
  for (let t = 0; t < 180 && i < pts.length; t += dt) {
    const dx = pts[i][0] - s.x, dz = pts[i][1] - s.z, d = Math.hypot(dx, dz);
    if (d < 1.2) { i++; best = Infinity; since = 0; continue; }
    const input = { keys: KEY.FORWARD, yaw: Math.atan2(-dx, -dz), pitch: 0 };
    if (agent === 'drone') stepDrone(s, input, dt, world.droneView); else stepPlayer(s, input, dt, world);
    if (d < best - 0.02) { best = d; since = 0; } else if ((since += dt) > 2.5) break;
  }
  return i >= pts.length ? null : `(${s.x.toFixed(1)}, ${s.y.toFixed(1)}, ${s.z.toFixed(1)})`;
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
    say(reached(outside, out[0], out[1], map.terrain ? map.terrain.top(out[0], out[1]) : 0, 0.6), `outside ${o.name} door at ${mid.toFixed(1)}: not reachable from the attackers' entries`);
    say(reached(outside, inn[0], inn[1], 0.02), `inside ${o.name} door at ${mid.toFixed(1)}: not reachable`);
  }

  // Every open standing spot in the building, on each floor: could a player get there?
  // (the floors and the footprint come from the map's own boxes, so this fits every map)
  const floorBoxes = map.boxes.filter((b) => b.kind === 'floor');
  const floors = [...new Set(floorBoxes.map((b) => Math.round(b.max[1] * 100) / 100))].sort((a, b) => a - b);
  const main = map.building[0];
  const onFloorBox = (x, z, y) => floorBoxes.some((b) => Math.abs(b.max[1] - y) < 0.05 && x >= b.min[0] && x <= b.max[0] && z >= b.min[2] && z <= b.max[2]);
  const lost = [];
  let total = 0;
  for (const y of floors) {
    for (let x = Math.ceil(main.x0) + 1; x <= main.x1 - 1; x += 1) for (let z = Math.ceil(main.z0) + 1; z <= main.z1 - 1; z += 1) {
      if (!onFloorBox(x, z, y) || !standable(x, z, y)) continue;
      total++;
      if (!reached(outside, x, z, y)) lost.push({ x, z, y });
    }
  }
  if (map.terrain) {
    // Parts of the grounds that can't be walked to (inside the fence line): a cliff or a closed-off corner
    let cells = 0, cut = 0;
    const samples = [];
    for (let x = -map.size + 6; x <= map.size - 6; x += 4) for (let z = -map.size + 6; z <= map.size - 6; z += 4) {
      const y = map.terrain.top(x, z);
      if (!standable(x, z, y)) continue;
      cells++;
      if (!reached(outside, x, z, y, 0.6)) { cut++; if (samples.length < 10) samples.push(`(${x}, ${z}, y ${y.toFixed(1)})`); }
    }
    if (cut / Math.max(1, cells) > 0.03) problems.push(`${cut} of ${cells} ground spots can't be walked to, e.g. ${samples.join(' ')}`);
    // Every path, walked and driven uphill for real, and a drone must be able to roll to the building from each spawn
    for (const r of map.ribbons || []) {
      const pts = Math.hypot(...r.pts[0]) < Math.hypot(...r.pts.at(-1)) ? [...r.pts].reverse() : r.pts;
      for (const agent of ['person', 'drone']) {
        const stopped = drive(world, agent, pts);
        if (stopped) problems.push(`a ${agent} going up the path from (${pts[0]}) stops at ${stopped}`);
      }
    }
    if (map.terrain.steepest() > 35) problems.push(`the ground is too steep in places: ${map.terrain.steepest().toFixed(0)} degrees`);
    for (const s of map.spawns.attack) {
      const seen = droneFlood(world, [{ x: s.x, z: s.z, y: s.y }], limit);
      const atDoor = exteriorDoors.some((o) => {
        const mid = (o.from + o.to) / 2;
        const out = o.axis === 'x' ? [mid, o.fixed + (o.fixed < 0 ? -1.2 : 1.2)] : [o.fixed + (o.fixed < 0 ? -1.2 : 1.2), mid];
        return reached(seen, out[0], out[1], map.terrain.surface(out[0], out[1]), 0.6);
      });
      say(atDoor, `a drone from the ${s.name} entry can't roll to any door`);
    }
    console.log(`  steepest slope: ${map.terrain.steepest().toFixed(0)} degrees; ${cut} of ${cells} ground spots out of reach`);
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
