// Dockside House: a small two-storey building with an outdoor approach (the original map).
// Attackers spawn at -z. Built with the map kit in shared/mapkit.js.

import { createMapKit } from '../mapkit.js';

export function buildDockside() {
  const kit = createMapKit({ T: 0.3 });
  const { box, wall, door, win, stairs, prop, detail, boxes, barriers, openings, details } = kit;
  const T = kit.T;
  const GROUND_TOP = 0;
  const SLAB_BOTTOM = 3.0;  // ceiling of the ground floor
  const FLOOR2 = 3.2;       // walking height of the upper floor
  const ROOF_BOTTOM = 6.0;
  const ROOF_TOP = 6.2;

  // Building footprint (outer faces of exterior walls)
  const BX0 = -12, BX1 = 12, BZ0 = -8, BZ1 = 8;
  const IX0 = BX0 + T / 2, IX1 = BX1 - T / 2, IZ0 = BZ0 + T / 2, IZ1 = BZ1 - T / 2;
  const upDoor = (from, to) => door(from, to, FLOOR2);
  const upWin = (from, to) => win(from, to, FLOOR2);

  // ---------------------------------------------------------------- terrain
  box(-46, -1, -46, 46, GROUND_TOP, 46, 'ground');
  // Indoor floor sits 2cm proud of the grass so it reads as a different surface.
  box(IX0, GROUND_TOP, IZ0, IX1, GROUND_TOP + 0.02, IZ1, 'floor');

  // Map boundary
  box(-46, 0, -46, 46, 4, -45, 'boundary');
  box(-46, 0, 45, 46, 4, 46, 'boundary');
  box(-46, 0, -45, -45, 4, 45, 'boundary');
  box(45, 0, -45, 46, 4, 45, 'boundary');

  // ---------------------------------------------------------------- exterior walls
  // Each runs the full building height; openings are placed per floor.
  wall('x', BZ0, BX0, BX1, 0, ROOF_BOTTOM, 'exterior', [
    win(-8, -6), door(-1, 1), win(6, 8),
    upWin(-7, -5), upWin(5, 7),
  ], 'south');
  wall('x', BZ1, BX0, BX1, 0, ROOF_BOTTOM, 'exterior', [
    win(-6, -4), door(6, 8),
    upWin(-2, 2),
  ], 'north');
  wall('z', BX0, IZ0, IZ1, 0, ROOF_BOTTOM, 'exterior', [
    door(-1, 1),
    upWin(2, 4),
  ], 'west');
  wall('z', BX1, IZ0, IZ1, 0, ROOF_BOTTOM, 'exterior', [
    win(-6.5, -4.5),
    upDoor(3, 5),
  ], 'east');

  // ---------------------------------------------------------------- upper floor slab (with stair hole)
  const HOLE_X0 = -10.5, HOLE_X1 = -4.9, HOLE_Z0 = 5.85;
  box(IX0, SLAB_BOTTOM, IZ0, IX1, FLOOR2, HOLE_Z0, 'floor');
  box(IX0, SLAB_BOTTOM, HOLE_Z0, HOLE_X0, FLOOR2, IZ1, 'floor');
  box(HOLE_X1, SLAB_BOTTOM, HOLE_Z0, IX1, FLOOR2, IZ1, 'floor');
  // Roof
  box(BX0, ROOF_BOTTOM, BZ0, BX1, ROOF_TOP, BZ1, 'roof');

  // Interior staircase in the west room, rising toward +x along the north wall.
  stairs('x', HOLE_X0, HOLE_Z0, IZ1, GROUND_TOP, 16, 0.2, 0.35);
  // Railings around the stair hole on the upper floor
  box(HOLE_X0 + 0.1, FLOOR2, HOLE_Z0 - 0.15, HOLE_X1 - 0.6, FLOOR2 + 1.0, HOLE_Z0, 'rail');
  box(HOLE_X0 - 0.15, FLOOR2, HOLE_Z0 - 0.15, HOLE_X0, FLOOR2 + 1.0, IZ1, 'rail');

  // ---------------------------------------------------------------- interior walls, ground floor
  // (kind 'interior' = destructible in later stages)
  wall('z', -4, IZ0, IZ1, 0, SLAB_BOTTOM, 'interior', [door(-3.5, -2)], 'g-west');
  wall('z', 4, IZ0, IZ1, 0, SLAB_BOTTOM, 'interior', [door(-5, -3.5), door(3, 4.5)], 'g-east');
  wall('x', 1, -4 + T / 2, 4 - T / 2, 0, SLAB_BOTTOM, 'interior', [door(-0.75, 0.75)], 'g-center');

  // ---------------------------------------------------------------- interior walls, upper floor
  wall('z', -4, IZ0, IZ1, FLOOR2, ROOF_BOTTOM, 'interior', [upDoor(-1, 0.5)], 'u-west');
  wall('z', 3, IZ0, IZ1, FLOOR2, ROOF_BOTTOM, 'interior', [upDoor(-6, -4.5), upDoor(2, 3.5)], 'u-east');
  wall('x', -2, 3 + T / 2, IX1, FLOOR2, ROOF_BOTTOM, 'interior', [upDoor(6.5, 8)], 'u-objective');

  // ---------------------------------------------------------------- east balcony + exterior stairs
  const BAL_X0 = BX1, BAL_X1 = BX1 + 2.2, BAL_Z0 = 2, BAL_Z1 = 6;
  box(BAL_X0, SLAB_BOTTOM, BAL_Z0, BAL_X1, FLOOR2, BAL_Z1, 'floor');
  box(BAL_X1, FLOOR2, BAL_Z0, BAL_X1 + 0.15, FLOOR2 + 1.0, BAL_Z1 + 0.15, 'rail');
  box(BAL_X0, FLOOR2, BAL_Z1, BAL_X1, FLOOR2 + 1.0, BAL_Z1 + 0.15, 'rail');
  stairs('z', BAL_Z0 - 16 * 0.35, BAL_X0, BAL_X1, GROUND_TOP, 16, 0.2, 0.35);

  // ---------------------------------------------------------------- outdoor cover
  const crates = [
    [-6, -16, 1.2], [5, -14, 1.2], [14, -11, 1.4], [-16, -6, 1.2], [-19, 9, 1.4],
    [19, 12, 1.2], [0, -24, 1.0], [-9, -27, 1.4], [9, -28, 1.2], [1, 18, 1.4],
    [-10, 17, 1.2], [-3, -12, 0.9], [22, -2, 1.2], [-24, -14, 1.4],
  ];
  for (const [x, z, s] of crates) box(x - s / 2, 0, z - s / 2, x + s / 2, s, z + s / 2, 'crate');
  // A long low container near the attacker approach
  box(-15, 0, -20, -9, 2.4, -17.6, 'container');
  box(10, 0, 20, 16, 2.4, 22.4, 'container');

  // ---------------------------------------------------------------- furniture and props
  // Solid props block movement and bullets, so the waist-high ones work as cover.
  // `details` are visual only (rugs, pictures, monitors, plants, car windows).
  const FL0 = 0.02;   // ground-floor walking height

  // --- ground floor: west room
  prop('furniture', -8.2, -5, 2.0, 1.0, 0.75, 0x8a6a45, FL0);        // table
  prop('furniture', -11.55, -5.8, 0.5, 2.8, 1.9, 0x5b4630, FL0);     // shelf on the west wall
  prop('furniture', -7.7, 2.05, 1.8, 0.9, 0.8, 0x5e6f8c, FL0);       // sofa
  prop('crate', -5.1, -6.9, 1.0, 1.0, 1.2, 0x9a7448, FL0);
  prop('barrel', -11.1, 3.3, 0.6, 0.6, 0.9, 0x3d6a9a, FL0);
  // --- ground floor: lobby
  prop('furniture', -2.6, -7.05, 1.8, 0.9, 0.8, 0x8c5e5e, FL0);      // sofa by the front door
  prop('furniture', 2.8, -1.4, 1.8, 0.9, 1.0, 0x6b5a45, FL0);        // reception counter
  prop('crate', -3.0, -0.5, 1.0, 1.0, 1.0, 0x9a7448, FL0);
  // --- ground floor: back room
  prop('furniture', -2.7, 7.1, 1.8, 0.9, 0.75, 0x7a5c3a, FL0);       // desk on the north wall
  prop('furniture', 3.15, 7.5, 1.1, 0.5, 1.9, 0x5b4630, FL0);        // bookshelf
  prop('furniture', 0, 5.7, 1.6, 1.0, 0.75, 0x8a6a45, FL0);          // table
  prop('crate', 3.3, 1.8, 0.8, 0.8, 0.9, 0x9a7448, FL0);
  // --- ground floor: east side
  prop('furniture', 11.4, -1.7, 0.8, 3.4, 0.9, 0x6b5a45, FL0);       // kitchen counter on the east wall
  prop('furniture', 7.8, -1.95, 1.6, 0.9, 0.75, 0x8a6a45, FL0);      // table
  prop('crate', 9.8, 6.8, 1.2, 1.2, 1.2, 0x9a7448, FL0);
  prop('barrel', 5.2, -6.6, 0.6, 0.6, 0.9, 0x3d6a9a, FL0);
  prop('barrel', 5.9, -6.9, 0.6, 0.6, 0.9, 0x9a3d3d, FL0);
  // --- upper floor: west room
  prop('furniture', -10.4, -6.0, 2.0, 2.0, 0.6, 0x6a7fa0, FLOOR2);    // bed
  prop('furniture', -11.3, -1.0, 1.0, 2.0, 2.0, 0x5b4630, FLOOR2);    // wardrobe
  prop('furniture', -7.2, -3.5, 1.5, 1.0, 0.75, 0x8a6a45, FLOOR2);    // table
  prop('crate', -5.4, -7.0, 1.0, 1.0, 1.2, 0x9a7448, FLOOR2);
  // --- upper floor: middle
  prop('furniture', -2.4, -7.05, 2.0, 0.9, 0.8, 0x5e8c6f, FLOOR2);    // couch
  prop('furniture', -2.5, 7.0, 1.8, 0.9, 0.75, 0x7a5c3a, FLOOR2);     // desk
  prop('furniture', 0.1, 0.1, 1.4, 0.9, 0.75, 0x8a6a45, FLOOR2);      // table
  prop('crate', 2.1, 4.3, 0.9, 0.9, 0.9, 0x9a7448, FLOOR2);
  // --- upper floor: north-east room
  prop('furniture', 8.5, -6.0, 1.8, 1.0, 0.75, 0x8a6a45, FLOOR2);     // table
  prop('crate', 11.1, -7.1, 1.0, 1.0, 1.2, 0x9a7448, FLOOR2);
  prop('furniture', 3.45, -3.2, 0.5, 1.2, 1.9, 0x5b4630, FLOOR2);     // shelf
  prop('furniture', 10.3, -3.0, 1.0, 0.6, 1.3, 0x6b6f75, FLOOR2);     // filing cabinet
  // --- upper floor: objective room (cover around the zone)
  prop('furniture', 4.9, 6.4, 1.2, 1.2, 0.75, 0x7a5c3a, FLOOR2);      // desk
  prop('furniture', 11.3, 6.8, 0.8, 1.8, 1.6, 0x5b4630, FLOOR2);      // shelf
  prop('crate', 5.8, 0.9, 0.9, 0.9, 0.9, 0x9a7448, FLOOR2);
  prop('crate', 9.6, 4.9, 0.9, 0.9, 1.0, 0x9a7448, FLOOR2);
  prop('furniture', 3.7, 6.7, 0.7, 0.9, 1.3, 0x6b6f75, FLOOR2);       // filing cabinet

  // --- outside
  prop('planter', -2.1, -8.9, 1.0, 0.8, 0.7, 0x4b3a2b);              // flank the front door
  prop('planter', 2.1, -8.9, 1.0, 0.8, 0.7, 0x4b3a2b);
  prop('concrete', -8.0, -13.0, 3.0, 0.5, 0.9, 0x9a9a98);
  prop('concrete', 8.5, -19.0, 3.0, 0.5, 0.9, 0x9a9a98);
  prop('concrete', -20.5, 3.2, 0.5, 3.0, 0.9, 0x9a9a98);
  prop('concrete', 19.5, -7.8, 3.0, 0.5, 0.9, 0x9a9a98);
  for (const [x, z] of [[-2, -19], [-1.3, -19.6], [16, -5], [16.7, -5.4], [-18, 14], [-17.3, 14.6]]) prop('barrel', x, z, 0.6, 0.6, 0.9, 0x3d6a9a);
  prop('pallet', 4, -20, 1.2, 1.2, 0.5, 0xb08a58);
  prop('pallet', 4, -20, 1.0, 1.0, 0.5, 0xa77f4d, 0.5);
  prop('pallet', -6, -31, 1.2, 1.2, 0.5, 0xb08a58);
  prop('pallet', 28, -12, 1.2, 1.2, 0.5, 0xb08a58);
  prop('car', 4.1, 13.5, 4.2, 1.8, 1.35, 0x8b2f2f);                  // parked sedan
  prop('car', -24, -6, 4.2, 1.8, 1.35, 0x46607a);
  prop('car', 25.2, 7.8, 6.5, 2.4, 2.2, 0xd9d4c8);                   // delivery van
  prop('furniture', -14, 19.5, 2.0, 0.9, 0.75, 0x8a6a45);            // picnic tables
  prop('furniture', 18, -24, 2.0, 0.9, 0.75, 0x8a6a45);

  // --- visual details
  detail(-0.2, FL0 + 0.01, -3.8, 4.0, 0.02, 3.0, 0x7a2f2f);          // lobby rug
  detail(-8, FL0 + 0.01, -0.5, 3.4, 0.02, 2.4, 0x2f4f7a);            // west room rug
  detail(0, FL0 + 0.01, 3.9, 3.0, 0.02, 2.2, 0x4f6f3a);              // back room rug
  detail(-7.5, FLOOR2 + 0.01, -0.5, 3.4, 0.02, 2.4, 0x6f3a5a);       // upper west rug
  detail(0.3, FLOOR2 + 0.01, 1.6, 3.0, 0.02, 2.0, 0x2f4f7a);         // upper middle rug
  detail(7.5, FLOOR2 + 0.01, 2.5, 3.6, 0.02, 3.6, 0x3a3a46);         // objective room rug
  detail(-2.6, 0.62, -7.55, 1.7, 0.4, 0.15, 0x6e4747);               // sofa back cushions
  detail(-7.7, 0.64, 2.45, 1.7, 0.36, 0.14, 0x4b5a74);
  detail(-2.4, FLOOR2 + 0.62, -7.55, 1.9, 0.4, 0.15, 0x4a7358);
  detail(-8.2, 0.8, -5, 0.18, 0.1, 0.18, 0xe8d9a8, true);            // table lamps
  detail(0, 0.8, 5.7, 0.18, 0.1, 0.18, 0xe8d9a8, true);
  detail(8.5, FLOOR2 + 0.8, -6, 0.18, 0.1, 0.18, 0xe8d9a8, true);
  detail(-2.7, 1.0, 7.3, 0.6, 0.4, 0.05, 0x1c2433, true);            // monitors
  detail(-2.5, FLOOR2 + 1.0, 7.2, 0.6, 0.4, 0.05, 0x1c2433, true);
  detail(4.9, FLOOR2 + 1.0, 6.6, 0.6, 0.4, 0.05, 0x1c2433, true);
  for (const [x, y, z, w, d, c] of [
    [-6.2, 1.8, -7.78, 1.0, 0.04, 0x4a6fa5], [-8.8, 1.7, -7.78, 0.7, 0.04, 0xa5764a], [-9.6, 1.8, 7.78, 0.9, 0.04, 0x6aa56f],
    [3.5, 1.8, -7.78, 0.8, 0.04, 0xa54a6f], [8, 1.8, -7.78, 1.0, 0.04, 0x4aa5a0], [-1.0, 1.8, 7.78, 1.1, 0.04, 0xa59a4a],
  ]) detail(x, y, z, w, 0.6, d, c);                                    // pictures on walls (ground floor)
  for (const [x, z, c] of [[-6.2, -7.78, 0x6aa56f], [0, 7.78, 0xa54a4a], [8.3, -7.78, 0x4a6fa5]]) detail(x, FLOOR2 + 1.8, z, 1.0, 0.6, 0.04, c);
  for (const [x, z] of [[-2.1, -8.9], [2.1, -8.9]]) detail(x, 1.0, z, 0.8, 0.6, 0.6, 0x3f7a3a);   // plants
  detail(-11.4, 0.5, -7.4, 0.5, 1.0, 0.5, 0x3f7a3a);
  detail(11.4, 0.5, 7.4, 0.5, 1.0, 0.5, 0x3f7a3a);
  for (const [x, z, w, c] of [[4.1, 13.5, 4.2, 0x8b2f2f], [-24, -6, 4.2, 0x46607a]]) {
    detail(x, 1.12, z, w * 0.5, 0.45, 1.84, 0x1a2230);               // car windows
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) detail(x + sx * w * 0.32, 0.22, z + sz * 0.9, 0.7, 0.44, 0.1, 0x16181b);   // wheels
  }
  detail(25.2, 1.55, 7.8, 6.7, 0.5, 2.5, 0x1a2230);                  // van window strip
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) detail(25.2 + sx * 2.2, 0.28, 7.8 + sz * 1.2, 0.8, 0.56, 0.1, 0x16181b);

  // ---------------------------------------------------------------- objective & spawns
  // Three possible objective sites in different rooms on both floors. Each round the
  // defenders vote on one; attackers aren't told which and must find it with drones.
  // All three boxes look identical so the box itself gives nothing away.
  const SITES = [
    { id: 0, name: 'Upstairs office', where: 'upper floor, east side', x: 7.5, y: FLOOR2, z: 2.5, size: 0.9, zoneRadius: 2.5 },
    { id: 1, name: 'Back room', where: 'ground floor, rear', x: -1.0, y: FL0, z: 4.2, size: 0.9, zoneRadius: 2.2 },
    { id: 2, name: 'Upstairs west room', where: 'upper floor, west side', x: -8.0, y: FLOOR2, z: 1.8, size: 0.9, zoneRadius: 2.3 },
  ];
  for (const site of SITES) {
    box(site.x - site.size / 2, site.y, site.z - site.size / 2, site.x + site.size / 2, site.y + site.size, site.z + site.size / 2, 'site');
  }
  const OBJECTIVE = SITES[0];   // kept for older callers; use SITES

  // Where the defenders start once a site has been voted for: in or right next to its
  // zone, facing the objective. (They spawn at SPAWNS.defense until the vote is decided.)
  const SITE_SPAWN_XZ = [
    [[6.2, 4.2], [8.8, 1.4], [7.5, 5.2], [9.0, 3.8], [6.4, 1.8]],        // upstairs office
    [[-2.6, 3.4], [0.7, 3.6], [-2.2, 5.4], [1.8, 4.8], [-0.9, 2.4]],     // back room
    [[-9.5, 3.0], [-6.5, 1.0], [-8.0, 3.6], [-9.6, 0.6], [-6.5, 3.0]],   // upstairs west room
  ];
  const SITE_SPAWNS = SITES.map((site, i) => SITE_SPAWN_XZ[i].map(([x, z]) => ({
    x, y: site.y, z, yaw: Math.atan2(-(site.x - x), -(site.z - z)),
  })));

  // yaw 0 faces -z, yaw PI faces +z
  const SPAWNS = {
    // Three entry points around the outside of the map, far from the building.
    // Attackers choose one (keys 1-3) while flying their drone in prep.
    attack: [
      { name: 'West', x: -38, y: 0, z: 2, yaw: -Math.PI / 2 },
      { name: 'South', x: 0, y: 0, z: -40, yaw: Math.PI },
      { name: 'East', x: 38, y: 0, z: 2, yaw: Math.PI / 2 },
    ],
    defense: [
      { x: 7.5, y: FLOOR2, z: 5.5, yaw: 0 }, { x: 9.5, y: FLOOR2, z: 0, yaw: 0 },
      { x: 0, y: FLOOR2, z: 3, yaw: 0 }, { x: 0, y: 0.02, z: 4, yaw: 0 },
      { x: 8, y: 0.02, z: 2, yaw: 0 },
    ],
  };


  return {
    id: 'dockside',
    name: 'Dockside House',
    description: 'A compact two-storey house with a yard. Fast rounds.',
    boxes,
    barriers,
    openings,
    details,
    objective: OBJECTIVE,
    sites: SITES,
    siteSpawns: SITE_SPAWNS,
    spawns: SPAWNS,
    // Soft fill lights so the building interior isn't pitch black under the roof
    lights: [[-8, 2.6, 0], [0, 2.6, -3], [0, 2.6, 4.5], [8, 2.6, 0], [-8, 5.6, 0], [0, 5.6, 0], [8, 5.6, -5]],
    size: 46,
  };
}
