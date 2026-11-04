// Hillside Villa (Stage 2L): a modern two-storey villa on a hill, with gardens falling away to the south.
//
//   Footprint x -15..15, z -11..11, two floors and a roof. The ground around the house is flat at y 0; the land
//   drops to about -3.4 at the Lower Gate (bottom of the winding drive) and climbs to about +3 on the north ridge.
//   Hard walls (brick, they can't be broken): every outside wall and the brick core in the middle of the house.
//   Soft walls (pale panels, they can be broken): most of the other inside walls.
//   Wall decorations only hang on hard walls, so nothing is left floating when a soft wall is blown out.
//
//   Layout (wall centre lines): x = -15 | -5 | 5 | 15,  z = -11 | -1 | 4 | 11

import { createMapKit } from '../mapkit.js';
import { createTerrain, shapedHeight, smooth } from '../terrain.js';
import { createFurnisher } from './furnish.js';

export function buildVilla() {
  const kit = createMapKit({ T: 0.3 });
  const { box, wall, door, win, stairs, hatch, hatchHole, wallRope, hatchRope, part, boxes, barriers, openings, details, parts, hatches, ropes } = kit;
  const T = kit.T;
  const F = createFurnisher(kit);
  const { WOOD } = F;

  const F1 = 0, F2 = 3.2, SLAB2 = 3.0, ROOF = 6.0, ROOF_TOP = 6.3, FL0 = 0.02, HALF = 62;
  const BX0 = -15, BX1 = 15, BZ0 = -11, BZ1 = 11;
  const IX0 = BX0 + T / 2, IX1 = BX1 - T / 2, IZ0 = BZ0 + T / 2, IZ1 = BZ1 - T / 2;
  const floorY = { 1: FL0, 2: F2 };
  const floorWall = { 1: [F1, SLAB2], 2: [F2, ROOF] };

  // ---------------------------------------------------------------- the land
  const drive = [[18, -52, -3.4], [8, -50, -3.2], [-12, -46, -2.7], [-24, -38, -2.1], [-20, -30, -1.6], [2, -27, -1.0], [4, -23, -0.5], [0, -19, 0]];
  const westPath = [[-50, -6, -1.0], [-36, -8, -0.8], [-24, -6, -0.3], [-17, -4, 0]];
  const northPath = [[-8, 50, 3.0], [-12, 38, 2.4], [-4, 28, 1.2], [2, 20, 0.4], [2.4, 13, 0]];
  const height = shapedHeight({
    shape: (x, z) => -3.4 * smooth(-16, -48, z) + 3.2 * smooth(18, 46, z)
      + 2.2 * Math.exp(-((x - 44) ** 2 + (z + 14) ** 2) / 260)            // a hill to the east
      - 1.0 * smooth(-18, -46, x)                                          // the orchard side is a little lower
      + 0.2 * Math.sin(x * 0.11 + 1) * Math.cos(z * 0.09),                 // a gentle roll
    paths: [{ pts: drive, width: 5, blend: 9 }, { pts: westPath, width: 3.5, blend: 8 }, { pts: northPath, width: 3.5, blend: 8 }],
    flats: [
      { x0: -22, z0: -18, x1: 22, z1: 18, y: 0, blend: 7 },                // the house and its terrace
      { x0: 16, z0: -28, x1: 31, z1: -14, y: 0, blend: 6 },                // the car park beside the house
      { x0: 12, z0: -58, x1: 26, z1: -47, y: -3.4, blend: 6 },             // the Lower Gate
      { x0: -56, z0: -11, x1: -46, z1: -1, y: -1.0, blend: 6 },            // the Orchard Gate
      { x0: -14, z0: 46, x1: -2, z1: 56, y: 3.0, blend: 6 },               // the Ridge Trail
    ],
  });
  const terrain = createTerrain({ half: HALF, height });
  const top = (x, z) => terrain.top(x, z);

  box(IX0, 0, IZ0, IX1, FL0, IZ1, 'floor');
  for (const [a, b, c, d] of [[-HALF, -HALF, HALF, -HALF + 1], [-HALF, HALF - 1, HALF, HALF], [-HALF, -HALF + 1, -HALF + 1, HALF - 1], [HALF - 1, -HALF + 1, HALF, HALF - 1]]) box(a, -8, b, c, 12, d, 'boundary', { hidden: true });

  // ---------------------------------------------------------------- outside walls (hard)
  wall('x', BZ0, BX0, BX1, F1, ROOF, 'exterior', [
    win(-13, -11, F1), win(-9, -7, F1), win(-3.6, -2.2, F1), door(-1.2, 1.2, F1), win(2.2, 3.6, F1), win(7, 9, F1), win(11, 13, F1),
    win(-13.6, -12.2, F2), door(-11, -9, F2), win(-7.6, -6.2, F2), win(-1, 1, F2), win(7, 9, F2), win(11, 13, F2),
  ], 'south');
  wall('x', BZ1, BX0, BX1, F1, ROOF, 'exterior', [
    win(-13, -11, F1), win(-9, -7, F1), win(-4, -2, F1), door(1.4, 3.4, F1),
    win(-13, -11, F2), win(-9, -7, F2), win(-3, -1, F2), win(1, 3, F2), win(8, 10, F2), win(12, 14, F2),
  ], 'north');
  wall('z', BX0, IZ0, IZ1, F1, ROOF, 'exterior', [
    win(-8, -6, F1), door(-5, -3, F1), win(3, 5, F1), win(7, 9, F1),
    win(-8, -6, F2), win(-3.5, -2, F2), win(3, 5, F2), win(7, 9, F2),
  ], 'west');
  wall('z', BX1, IZ0, IZ1, F1, ROOF, 'exterior', [
    win(-8, -6, F1), win(-4, -2.5, F1), door(2, 4, F1), win(7, 9, F1),
    win(-8, -6, F2), win(-4, -2.5, F2), win(1, 3, F2), win(7, 9, F2),
  ], 'east');

  // ---------------------------------------------------------------- stairs, floors, roof
  const A = { x0: -5 + T / 2, x1: -5 + T / 2 + 16 * 0.35, z0: -3.7, z1: -1 - T / 2 };   // hall: rises towards +x along the core wall
  const B = { x0: -5 + T / 2, x1: -5 + T / 2 + 16 * 0.35, z0: 8.45, z1: IZ1 };           // sunroom: rises towards +x along the north wall
  stairs('x', A.x0, A.z0, A.z1, F1, 16, 0.2, 0.35, 1);
  stairs('x', B.x0, B.z0, B.z1, F1, 16, 0.2, 0.35, 1);
  const FLOOR_HATCHES = [[13, -3], [-13, 1.5]], ROOF_HATCHES = [[0, -7], [-11.5, 7], [11, 7]];
  kit.slab(SLAB2, F2, IX0, IZ0, IX1, IZ1, [[A.x0, A.z0, A.x1, A.z1], [B.x0, B.z0, B.x1, B.z1], ...FLOOR_HATCHES.map((h) => hatchHole(...h))], 'floor');
  for (const h of FLOOR_HATCHES) hatch(...h, SLAB2, F2);
  kit.slab(ROOF, ROOF_TOP, BX0, BZ0, BX1, BZ1, ROOF_HATCHES.map((h) => hatchHole(...h)), 'roof');
  const roofHatches = ROOF_HATCHES.map((h) => hatch(...h, ROOF, ROOF_TOP));
  for (const x of [-12, -3, 8]) wallRope('x', BZ0, x, -1, ROOF_TOP, 2.5);
  for (const x of [-10, 0, 11]) wallRope('x', BZ1, x, 1, ROOF_TOP, 2.5);
  for (const z of [-6, 6]) wallRope('z', BX0, z, -1, ROOF_TOP, 2.5);
  for (const z of [-5, 8]) wallRope('z', BX1, z, 1, ROOF_TOP, 2.5);
  ROOF_HATCHES.forEach((h, i) => hatchRope(roofHatches[i], ...h, ROOF_TOP, F2, [0, 1.2]));
  box(A.x0, F2, A.z0 - 0.12, A.x1 - 0.6, F2 + 1.0, A.z0, 'rail');
  box(B.x0, F2, B.z0 - 0.12, B.x1 - 0.6, F2 + 1.0, B.z0, 'rail');
  // South balcony off the master bedroom
  box(-13, SLAB2, BZ0 - 2.2, -7, F2, BZ0, 'floor');
  box(-13, F2, BZ0 - 2.2, -7, F2 + 1.0, BZ0 - 2.06, 'rail');
  box(-13, F2, BZ0 - 2.06, -12.86, F2 + 1.0, BZ0, 'rail');
  box(-7.14, F2, BZ0 - 2.06, -7, F2 + 1.0, BZ0, 'rail');

  // ---------------------------------------------------------------- inside walls: soft panels, and the hard brick core
  const inner = (floor, axis, fixed, from, to, doors, name, kind = 'interior') => {
    const [y0, y1] = floorWall[floor];
    wall(axis, fixed, from, to, y0, y1, kind, doors.map(([a, b]) => door(a, b, floor === 1 ? F1 : F2)), name);
  };
  const W = [IX0, -5 - T / 2], E = [5 + T / 2, IX1], C = [-5 - T / 2, 5 + T / 2];
  // Ground floor
  inner(1, 'z', -5, IZ0, -1 - T / 2, [[-7.5, -5.5]], 'g-living-hall');
  inner(1, 'z', 5, IZ0, -1 - T / 2, [[-7.5, -5.5]], 'g-hall-dining');
  inner(1, 'x', -1, ...W, [[-11, -9]], 'g-living-study');
  inner(1, 'x', -1, ...E, [[9, 11]], 'g-dining-kitchen');
  inner(1, 'x', -1, ...C, [[1.6, 3.4]], 'g-core-s', 'hardwall');
  inner(1, 'z', -5, -1 + T / 2, 4 - T / 2, [[1, 2.6]], 'g-core-w', 'hardwall');
  inner(1, 'z', 5, -1 + T / 2, 4 - T / 2, [[1, 2.6]], 'g-core-e', 'hardwall');
  inner(1, 'x', 4, ...C, [[-1, 1]], 'g-core-n', 'hardwall');
  inner(1, 'z', -5, 4 + T / 2, IZ1, [[5.4, 7.2]], 'g-study-sun');
  inner(1, 'z', 5, 4 + T / 2, IZ1, [[5.4, 7.2]], 'g-sun-kitchen');
  // First floor
  inner(2, 'z', -5, IZ0, -1 - T / 2, [[-7.5, -5.5]], 'f-master-hall');
  inner(2, 'z', 5, IZ0, -1 - T / 2, [[-7.5, -5.5]], 'f-hall-kid');
  inner(2, 'x', -1, ...W, [[-11, -9]], 'f-master-library');
  inner(2, 'x', -1, ...E, [[9, 11]], 'f-kid-guest');
  inner(2, 'x', -1, ...C, [[1.6, 3.4]], 'f-core-s', 'hardwall');
  inner(2, 'z', -5, -1 + T / 2, 4 - T / 2, [[1, 2.6]], 'f-core-w', 'hardwall');
  inner(2, 'z', 5, -1 + T / 2, 4 - T / 2, [[1, 2.6]], 'f-core-e', 'hardwall');
  inner(2, 'x', 4, ...C, [[-1, 1]], 'f-core-n');
  inner(2, 'z', -5, 4 + T / 2, IZ1, [[5.4, 7.2]], 'f-library-lounge');
  inner(2, 'z', 5, 4 + T / 2, IZ1, [[5.4, 7.2]], 'f-lounge-office');
  inner(2, 'x', 4, ...E, [[9, 11]], 'f-guest-office');

  // ---------------------------------------------------------------- objective sites and spawns
  const SITES = [
    { id: 0, name: 'Study', where: 'ground floor, north-west', x: -10, y: FL0, z: 4.6, size: 0.9, zoneRadius: 2.8 },
    { id: 1, name: 'Kitchen', where: 'ground floor, north-east', x: 10, y: FL0, z: 5, size: 0.9, zoneRadius: 2.8 },
    { id: 2, name: 'Master bedroom', where: 'first floor, south-west', x: -9.5, y: F2, z: -5, size: 0.9, zoneRadius: 2.8 },
  ];
  for (const s of SITES) box(s.x - s.size / 2, s.y, s.z - s.size / 2, s.x + s.size / 2, s.y + s.size, s.z + s.size / 2, 'site');
  const ring = (site, offsets) => offsets.map(([dx, dz]) => ({ x: site.x + dx, y: site.y, z: site.z + dz, yaw: Math.atan2(dx, dz) }));
  const SITE_SPAWNS = [
    ring(SITES[0], [[-2.2, 0.4], [2.2, -0.6], [0.2, 2.2], [-1.4, -2.2], [1.8, 2.0]]),
    ring(SITES[1], [[-2.2, 0.4], [2.2, -0.6], [0, -2.2], [-1.8, 2.0], [1.9, 1.8]]),
    ring(SITES[2], [[-2.2, 1.0], [2.2, -0.6], [0.2, 2.3], [-0.6, -2.2], [1.9, 2.2]]),
  ];
  const SPAWNS = {
    attack: [
      { name: 'Lower Gate', x: 19, y: top(19, -53), z: -53, yaw: Math.PI - 0.3 },     // the bottom of the winding drive
      { name: 'Orchard Gate', x: -51, y: top(-51, -6), z: -6, yaw: -Math.PI / 2 },
      { name: 'Ridge Trail', x: -8, y: top(-8, 51), z: 51, yaw: 0.2 },
    ],
    defense: [
      { x: -10, y: FL0, z: 8.5, yaw: 0 }, { x: 10, y: FL0, z: 1.8, yaw: 0 }, { x: -9, y: F2, z: -2.6, yaw: 0 },
      { x: 2, y: FL0, z: -6, yaw: 0 }, { x: 10, y: F2, z: 2, yaw: 0 },
    ],
  };

  // ---------------------------------------------------------------- floor finishes (thin, drawn on top of the slabs)
  const finish = (x0, z0, x1, z1, y, color, tex) => part([(x0 + x1) / 2, y + 0.006, (z0 + z1) / 2], [x1 - x0, 0.012, z1 - z0], { color, tex });
  finish(5.15, -0.85, IX1, IZ1, FL0, 0xd8d4c8, 'tiles');              // kitchen
  finish(-4.85, -0.85, 4.85, 3.85, FL0, 0xb8b4a8, 'tiles');           // laundry and pantry
  finish(-4.85, 4.15, 4.85, 8.3, FL0, 0xc8bca8, 'tiles');             // sunroom
  finish(-4.85, -0.85, 4.85, 3.85, F2, 0xdce4e8, 'tiles');            // bathroom
  finish(IX0, IZ0, -5.15, -1.15, F2, 0x7a6a78, 'carpet');             // master bedroom
  finish(5.15, IZ0, IX1, -1.15, F2, 0x6a8a9a, 'carpet');              // bedroom
  finish(5.15, -0.85, IX1, 3.85, F2, 0x8a8a6a, 'carpet');             // guest room
  finish(IX0, -0.85, -5.15, IZ1, F2, 0x8a4a3a, 'carpet');             // library

  // ---------------------------------------------------------------- ground floor
  // Living room (south-west)
  F.rug(-10, -6.4, 4.4, 3.2, FL0, 0x7a2f2f);
  F.couch(-10.3, -8.9, 0, FL0, { color: 0x5e6f8c, len: 2.6 });
  F.armchair(-13.1, -6.6, 1, FL0, { color: 0x7a5a3a });
  F.armchair(-7.2, -8.2, 3, FL0, { color: 0x7a5a3a });
  F.coffeeTable(-10.2, -6.6, 0, FL0);
  F.tvStand(-5.7, -3.2, 3, FL0);
  F.floorLamp(-14.2, -10.1, FL0);
  F.plant(-14.2, -1.8, FL0, { big: true });
  F.bookshelf(-14.6, -8.8, 1, FL0, { w: 1.2 });
  F.painting('x', BZ0, -10, 2.0, 1);
  F.ceilingLight(-10, -6, SLAB2);
  // Entrance hall (south, centre)
  F.rug(0, -7.8, 2.6, 4.6, FL0, 0x2f4f7a);
  F.plant(-4.2, -10.2, FL0);
  F.plant(4.2, -10.2, FL0);
  F.bench(3.9, -3.2, 3, FL0);
  F.poster('x', -1, 4.2, 1.7, -1);
  F.clock('x', BZ0, 4.2, 2.4, 1);
  F.lightSwitch('x', BZ0, -1.8, 1.25, 1);
  F.ceilingLight(0, -6.5, SLAB2);
  // Dining room (south-east)
  F.rug(10, -6.2, 5, 3.2, FL0, 0x4f6f3a);
  F.diningSet(10, -6.2, 0, FL0, { seats: 6, wood: WOOD.walnut, w: 2.6 });
  F.counter(14.2, -8.8, 3, FL0, { len: 1.8, stools: 0 });
  F.bookshelf(5.6, -2.0, 1, FL0, { w: 1.0 });
  F.plant(14.2, -10.2, FL0);
  F.armchair(6.4, -9.6, 0, FL0, { color: 0x4f6f3a });
  F.painting('x', BZ0, 10, 2.0, 1);
  F.ceilingLight(10, -6, SLAB2);
  // Study (north-west): a site
  F.rug(-10, 4.6, 5, 4, FL0, 0x6f3a5a);
  F.desk(-13.2, 10.2, 2, FL0);
  F.desk(-6.9, 10.2, 2, FL0, { wood: WOOD.walnut, w: 1.4 });
  F.bookshelf(-14.6, 1.0, 1, FL0);
  F.filingCabinet(-14.6, 6.1, 1, FL0);
  F.bookshelf(-5.6, 0.6, 3, FL0, { w: 1.0 });
  F.armchair(-13.8, 3.2, 1, FL0, { color: 0x5a3a2a });
  F.wallShelf('x', BZ1, -10, 2.0, -1);
  F.painting('z', BX0, 1, 2.0, 1, { w: 0.9, h: 0.65 });
  F.ceilingLight(-10, 5, SLAB2);
  // Pantry and laundry: the brick core
  F.bookshelf(-4.5, 3.4, 2, FL0, { w: 0.9 });
  F.fridge(-4.3, -0.4, 1, FL0);
  F.crateStack(4.2, 3.2, FL0);
  F.filingCabinet(4.4, -0.3, 3, FL0);
  F.clock('x', 4, -3, 2.3, -1);
  F.ceilingLight(0, 1.5, SLAB2);
  // Sunroom (north, centre): stairs along the north wall
  F.couch(2.6, 7.6, 2, FL0, { color: 0x9a8a5a, len: 2.0 });
  F.armchair(-1.0, 6.4, 0, FL0, { color: 0x6a7a5a });
  F.plant(4.3, 10.3, FL0, { big: true });
  F.plant(4.3, 4.6, FL0);
  F.coffeeTable(2.0, 5.6, 0, FL0, { w: 1.0, d: 0.6 });
  F.ceilingLight(1, 6.5, SLAB2);
  // Kitchen (north-east): a site
  F.kitchenRun(10.4, IZ1 - 0.35, 2, FL0, 6, { wood: WOOD.white });
  F.fridge(6.2, IZ1 - 0.42, 2, FL0);
  F.kitchenRun(IX1 - 0.34, 5.4, 3, FL0, 2.4, { stove: false, wood: WOOD.white });
  F.counter(7.2, 1.0, 1, FL0, { len: 1.8, stools: 2 });
  F.diningSet(12.7, 0.6, 1, FL0, { seats: 2, w: 1.0, d: 0.8, wood: WOOD.pine });
  F.ceilingLight(10, 5, SLAB2);

  // ---------------------------------------------------------------- first floor
  // Master bedroom (south-west): a site, with the balcony
  F.rug(-12.2, -4.0, 2.8, 3.4, F2, 0x3a3a4a);
  F.bed(-13.5, -3.8, 1, F2, { blanket: 0x6a3a4a });
  F.nightstand(-14.6, -5.6, 1, F2);
  F.nightstand(-14.6, -2.0, 1, F2);
  F.wardrobe(-5.5, -9.7, 3, F2);
  F.armchair(-6.4, -2.0, 3, F2, { color: 0x7a5a6a });
  F.couch(-6.0, -4.0 + 0.6, 3, F2, { color: 0x8a6a7a, len: 1.8 });
  F.desk(-11.6, -10.2, 0, F2, { wood: WOOD.walnut, computer: false, w: 1.4 });
  F.floorLamp(-6, -10.2 + 3, F2);
  F.bookshelf(-14.6, -7.6, 1, F2, { w: 1.0 });
  F.basin(-14.6, -9.4, 1, F2);
  F.ceilingLight(-10, -6, ROOF);
  // Landing (south, centre)
  F.bench(3.8, -3.4, 3, F2);
  F.bookshelf(-4.4, -9.5, 1, F2, { w: 1.2 });
  F.plant(4.2, -10.2, F2);
  F.poster('x', -1, 4.2, 4.9, -1);
  F.ceilingLight(0, -6, ROOF);
  // Bedroom (south-east)
  F.bed(13.9, -4.2, 3, F2, { blanket: 0x3a7a9a, wide: false });
  F.nightstand(14.5, -2.4, 3, F2, WOOD.pine);
  F.desk(9.0, -10.1, 0, F2, { wood: WOOD.pine, w: 1.3 });
  F.wardrobe(6.0, -2.2, 1, F2, WOOD.pine);
  F.poster('x', BZ0, 10.0, 4.9, 1);
  F.rug(10.5, -5.6, 2.6, 2.2, F2, 0xd8a04a);
  F.bookshelf(14.5, -8.6, 3, F2, { w: 1.2, wood: WOOD.pine });
  F.crateStack(6.4, -9.6, F2);
  F.armchair(11.8, -2.0, 2, F2, { color: 0x3a7a9a });
  F.ceilingLight(10, -6, ROOF);
  // Library (north-west)
  for (const [x, z] of [[-14.6, 1.2], [-14.6, 6.1], [-14.6, 10.0]]) F.bookshelf(x, z, 1, F2);
  for (const x of [-11.9, -10.0, -6.6]) F.bookshelf(x, IZ1 - 0.22, 2, F2, { w: 1.2 });
  F.armchair(-10.6, 3.8, 0, F2, { color: 0x4a3a2a });
  F.armchair(-7.8, 3.8, 0, F2, { color: 0x4a3a2a });
  F.coffeeTable(-9.2, 5.4, 0, F2, { wood: WOOD.walnut });
  F.rug(-9.2, 5.0, 4.2, 3.2, F2, 0x2f4f7a);
  F.floorLamp(-6, 1, F2);
  F.ceilingLight(-10, 5, ROOF);
  // Bathroom: the brick core upstairs
  F.bathtub(-3.9, 3.3, 0, F2);
  F.toilet(4.2, 0, 3, F2);
  F.basin(-4.5, 0.2, 1, F2);
  F.clock('x', -1, -3.4, 5.1, 1);
  F.ceilingLight(0, 1.5, ROOF);
  // Upstairs lounge (north, centre)
  F.couch(2.4, 6.0, 3, F2, { color: 0x6a4a6a, len: 2.1 });
  F.poolTable(-1.4, 6.3, 0, F2);
  F.plant(4.3, 10.3, F2);
  F.floorLamp(4.3, 4.6, F2);
  F.ceilingLight(0, 6.5, ROOF);
  // Guest room (east, middle)
  F.bed(13.6, 1.6, 3, F2, { blanket: 0x6a7a3a });
  F.nightstand(14.5, 3.3, 3, F2);
  F.wardrobe(5.9, 3.2, 1, F2);
  F.ceilingLight(10, 1.5, ROOF);
  F.desk(9.6, 3.3, 2, F2, { wood: WOOD.oak, computer: false, w: 1.2 });
  // Home office (north-east)
  F.desk(11, IZ1 - 0.5, 2, F2, { wood: WOOD.walnut });
  F.filingCabinet(14.5, 5.2, 3, F2);
  F.filingCabinet(14.5, 5.9, 3, F2);
  F.bookshelf(6.0, 10.2, 1, F2, { w: 1.2 });
  F.armchair(8.0, 5.0, 0, F2, { color: 0x5a6a7a });
  F.wallShelf('z', BX1, 10.2, 5.0, -1);
  F.ceilingLight(10, 7.5, ROOF);
  // Balcony
  F.bench(-10, -12.65, 0, F2);

  // Roof: a chimney over the brick core, vents and solar panels
  box(-1.2, ROOF_TOP, 1.2, 1.2, ROOF_TOP + 1.6, 2.6, 'hardwall', { color: 0x8a4a3a });
  box(7, ROOF_TOP, -7, 9, ROOF_TOP + 0.9, -5.4, 'appliance', { hidden: true });
  part([8, ROOF_TOP + 0.45, -6.2], [2, 0.9, 1.6], { color: 0x8a8e94, tex: 'metal' });
  part([8, ROOF_TOP + 0.95, -6.2], [1.0, 0.1, 1.0], { color: 0x4a4c50, shape: 'cyl' });
  for (let i = 0; i < 4; i++) part([-11 + i * 1.8, ROOF_TOP + 0.25, -4], [1.6, 0.06, 2.4], { color: 0x1a2a4a, tex: 'metal', rot: [-0.22, 0, 0] });

  F.dressOpenings([0, 0], { frame: 0xf0ece4, trim: 0x4a3a2a, curtain: 0xa85a4a });

  // ---------------------------------------------------------------- outside: paths, walls, plants and cars
  const ribbons = [
    { pts: drive.map(([x, z]) => [x, z]), width: 4.2, tex: 'dirt', color: 0xb8a078 },
    { pts: westPath.map(([x, z]) => [x, z]), width: 2.2, tex: 'dirt', color: 0xa89878 },
    { pts: northPath.map(([x, z]) => [x, z]), width: 2.2, tex: 'dirt', color: 0xa89878 },
  ];
  // The terrace: paving all round the house
  const pave = (x0, z0, x1, z1, color = 0xb8b4a8) => part([(x0 + x1) / 2, 0.015, (z0 + z1) / 2], [x1 - x0, 0.03, z1 - z0], { color, tex: 'tiles' });
  pave(-17, -15, 17, -11.15);
  pave(-17, 11.15, 17, 13.5);
  pave(-17, -11.15, -15.15, 11.15);
  pave(15.15, -11.15, 17, 11.15);
  part([23.5, 0.015, -21], [15, 0.03, 14], { color: 0x54565a, tex: 'asphalt' });      // car park
  for (let i = 0; i < 4; i++) part([18.2 + i * 3.4, 0.035, -21], [0.12, 0.02, 5.6], { color: 0xe8e4dc, fine: true });   // bays

  // Stone steps up to the front terrace, with low walls either side
  const sy = top(0, -22);
  F.steps('z', -22, -2.2, 2.2, sy, 5, Math.max(0.1, -sy / 5), 0.8, 1);
  F.lowWall(-11, -17.6, -2.8, -17.6, top, { h: 0.95 });
  F.lowWall(2.8, -17.6, 15, -17.6, top, { h: 0.95 });
  F.lowWall(-22, -12, -22, -7.5, top, { h: 0.9 });       // with a gap where the west path comes through
  F.lowWall(-22, -2.5, -22, 8, top, { h: 0.9 });
  F.lowWall(-22, -18, -11, -18, top, { h: 0.9 });
  // Terraces on the way up the drive
  F.lowWall(-34, -33, -24, -33, top);
  F.lowWall(-12, -38, 12, -38, top, { h: 0.85 });
  F.lowWall(-3, -30, 24, -30, top, { h: 0.85 });
  // Fences round the grounds, with gaps for the paths
  F.fence(-44, -48, -28, -48, top);
  F.fence(30, -46, 46, -46, top);
  F.fence(-54, 14, -24, 14, top);
  F.fence(-46, 18, -46, 40, top);
  F.fence(10, 30, 42, 30, top);
  F.fence(40, 0, 40, 24, top);
  // Garden furniture
  F.bench(-18.6, -15.2, 0, 0);
  F.bench(8, 16, 2, 0);
  F.planterBox(-6, -12.6, 0, 0);
  F.planterBox(6, -12.6, 0, 0);
  F.planterBox(-5, 12.5, 2, 0);
  F.planterBox(6, 12.5, 2, 0);
  F.diningSet(16, 15, 0, 0, { seats: 4, wood: WOOD.white, w: 1.5, d: 0.9 });
  // The pool, behind the house: shallow water in a low stone rim (you can wade through it)
  const pool = { x0: -20, z0: 13, x1: -10, z1: 17.5 };
  for (const [a, b, c, d] of [[pool.x0, pool.z0, pool.x1, pool.z0 + 0.3], [pool.x0, pool.z1 - 0.3, pool.x1, pool.z1], [pool.x0, pool.z0, pool.x0 + 0.3, pool.z1], [pool.x1 - 0.3, pool.z0, pool.x1, pool.z1]]) {
    box(a, 0, b, c, 0.18, d, 'concrete', { hidden: true });
    part([(a + c) / 2, 0.09, (b + d) / 2], [c - a, 0.18, d - b], { color: 0xd8d4c8, tex: 'tiles' });
  }
  part([(pool.x0 + pool.x1) / 2, 0.1, (pool.z0 + pool.z1) / 2], [pool.x1 - pool.x0 - 0.6, 0.04, pool.z1 - pool.z0 - 0.6], { color: 0x4aa8c8, glow: 0.25 });
  for (const x of [-22 + 3.5, -8]) F.bench(x, 19, 2, 0);
  // Lamps along the drive
  for (const [x, z] of [[4, -48], [-16, -44], [-26, -32], [-6, -25], [6, -20]]) F.lampPost(x, z, top(x, z));
  // Trees and bushes (the same every time)
  let seed = 11;
  const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const clearOfPaths = (x, z, r) => [drive, westPath, northPath].every((p) => p.every(([a, b], i) => {
    if (i + 1 === p.length) return true;
    const [c, d] = p[i + 1], dx = c - a, dz = d - b, t = Math.max(0, Math.min(1, ((x - a) * dx + (z - b) * dz) / (dx * dx + dz * dz)));
    return Math.hypot(x - (a + dx * t), z - (b + dz * t)) > r;
  }));
  const offPad = (x, z, m) => !(x > -22 - m && x < 22 + m && z > -18 - m && z < 18 + m) && !(x > 15 - m && x < 32 + m && z > -29 - m && z < -13 + m) && !(x > 11 - m && x < 27 + m && z > -59 - m && z < -46 + m);
  const offSpawns = (x, z) => SPAWNS.attack.every((s) => Math.hypot(x - s.x, z - s.z) > 7);
  let trees = 0, tries = 0;
  while (trees < 46 && tries++ < 600) {
    const x = (rand() - 0.5) * (HALF * 2 - 6), z = (rand() - 0.5) * (HALF * 2 - 6);
    if (!offPad(x, z, 1) || !clearOfPaths(x, z, 4.5) || !offSpawns(x, z)) continue;
    (z > 16 && rand() < 0.6 ? F.pine : F.tree)(x, z, top(x, z), 0.8 + rand() * 0.5);
    trees++;
  }
  let bushes = 0; tries = 0;
  while (bushes < 60 && tries++ < 800) {
    const x = (rand() - 0.5) * (HALF * 2 - 6), z = (rand() - 0.5) * (HALF * 2 - 6);
    if (!offPad(x, z, -1) || !clearOfPaths(x, z, 3.2)) continue;
    F.bush(x, z, top(x, z), 0.7 + rand() * 0.7);
    bushes++;
  }
  for (const [x, z] of [[-16.5, -16.4], [-10, -16.4], [16.5, -16.4], [-20, 4], [-20, -4], [20, 4], [20, 9], [4, 16.2], [-3, 16.4], [12, 17]]) F.bush(x, z, 0, 0.9);
  // Parked cars
  F.vehicle(19, -22, 0, 0, { type: 'suv', color: 0x2a3a4a });
  F.vehicle(22.4, -21.4, 0, 0, { type: 'sedan', color: 0x8b2f2f });
  F.vehicle(28.4, -21, 0, 0, { type: 'van', color: 0xd8d4c8 });
  F.vehicle(23, -50, 2, top(23, -50), { type: 'pickup', color: 0x4a6a3a });
  F.vehicle(-47, -2.5, 1, top(-47, -2.5), { type: 'sedan', color: 0x46607a });
  F.vehicle(-6, 44, 1, top(-6, 44), { type: 'pickup', color: 0x7a3a2a });
  F.vehicle(-9.6, -24, 1, top(-9.6, -24), { type: 'sedan', color: 0xc8b070 });

  return {
    id: 'villa',
    name: 'Hillside Villa',
    description: 'A detailed two-storey villa on a hill, with a winding drive, gardens, a pool and a brick core. Three objectives.',
    detailed: true,
    terrain,
    ribbons,
    style: {
      exterior: { out: { tex: 'plaster', color: 0xe8e0cc }, in: { tex: 'brick', color: 0xb8a898 } },
      hardwall: { tex: 'brick', color: 0xa86a4a },
      floor: { tex: 'wood', color: 0xa87a4a, under: 0xf0ece4 },
      roof: { tex: 'shingle', color: 0x6a4a3a, under: 0xf0ece4 },
      stairs: { tex: 'wood', color: 0x8a6240 },
      softWall: 0xefe8da,
    },
    boxes,
    barriers,
    openings,
    details,
    parts,
    hatches,
    ropes,
    building: [
      { x0: BX0 - 0.2, z0: BZ0 - 0.2, x1: BX1 + 0.2, z1: BZ1 + 0.2 },
      { x0: -13.2, z0: BZ0 - 2.4, x1: -6.8, z1: BZ0 },
    ],
    objective: SITES[0],
    sites: SITES,
    siteSpawns: SITE_SPAWNS,
    spawns: SPAWNS,
    lights: [[-10, 2.5, -6], [0, 2.5, -6], [10, 2.5, -6], [-10, 2.5, 5], [10, 2.5, 5], [-10, 5.5, -6], [10, 5.5, -6], [0, 5.5, 5]],
    shadowExtent: 45,
    size: HALF,
  };
}
