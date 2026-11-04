// Pinecrest Lodge (Stage 2L): a two-storey timber mountain lodge above its own car park, in pine woods.
//
//   Footprint x -18..18, z -9..9. The ground round the lodge is flat at y 0. To the south it steps down to the car
//   park (y -1.6), and the road carries on down to the Valley Road at about -3.4; to the north the land climbs to
//   Pine Ridge at about +3. Stone steps climb from the car park to the front door, and an outside wooden stair climbs
//   the east wall to a balcony.
//   Hard walls (stone inside, logs outside; they can't be broken): every outside wall and the stone firewalls.
//   Soft walls (pale panels; they can be broken): the rest. Wall decorations only hang on hard walls.
//
//   Ground floor: lobby in the middle, lounge west, restaurant east, office north-west, games room north, kitchen
//   north-east. First floor: a corridor with four rooms on each side.

import { createMapKit } from '../mapkit.js';
import { createTerrain, shapedHeight, smooth } from '../terrain.js';
import { createFurnisher } from './furnish.js';

export function buildLodge() {
  const kit = createMapKit({ T: 0.3 });
  const { box, wall, door, win, stairs, hatch, hatchHole, wallRope, hatchRope, part, boxes, barriers, openings, details, parts, hatches, ropes } = kit;
  const T = kit.T;
  const F = createFurnisher(kit);
  const { WOOD } = F;

  const F1 = 0, F2 = 3.2, SLAB2 = 3.0, ROOF = 6.0, ROOF_TOP = 6.3, FL0 = 0.02, HALF = 64, LOT = -1.6;
  const BX0 = -18, BX1 = 18, BZ0 = -9, BZ1 = 9;
  const IX0 = BX0 + T / 2, IX1 = BX1 - T / 2, IZ0 = BZ0 + T / 2, IZ1 = BZ1 - T / 2;

  // ---------------------------------------------------------------- the land
  const road = [[44, -54, -3.4], [36, -48, -3.2], [28, -42, -2.8], [16, -38, -2.2], [6, -32, LOT]];
  const ramp = [[12, -26, LOT], [22, -24, -1.2], [27, -18, -0.5], [26, -11, 0]];
  const ridge = [[-30, 52, 3.0], [-22, 40, 2.4], [-8, 32, 1.6], [6, 24, 0.8], [12, 15, 0]];
  const westTrack = [[-52, -8, -0.6], [-38, -6, -0.5], [-26, -4, -0.2], [-20, -2, 0]];
  const height = shapedHeight({
    shape: (x, z) => -3.4 * smooth(-12, -46, z) + 3.4 * smooth(14, 46, z)
      + 2.6 * Math.exp(-((x + 42) ** 2 + (z + 34) ** 2) / 300)             // a knoll south-west of the car park
      + 2.0 * Math.exp(-((x - 46) ** 2 + (z - 10) ** 2) / 260)             // and one to the east
      + 0.2 * Math.sin(x * 0.1 + 2) * Math.cos(z * 0.08),
    paths: [{ pts: road, width: 6, blend: 9 }, { pts: ramp, width: 4.5, blend: 8 }, { pts: ridge, width: 3.5, blend: 8 }, { pts: westTrack, width: 3.5, blend: 8 }],
    flats: [
      { x0: -25, z0: -13, x1: 25, z1: 14, y: 0, blend: 7 },                // the lodge and its yard
      { x0: -24, z0: -36, x1: 12, z1: -22, y: LOT, blend: 6 },             // the car park
      { x0: 39, z0: -60, x1: 52, z1: -48, y: -3.4, blend: 6 },             // the Valley Road
      { x0: -36, z0: 47, x1: -24, z1: 58, y: 3.0, blend: 6 },              // Pine Ridge
      { x0: -58, z0: -14, x1: -46, z1: -2, y: -0.6, blend: 6 },            // the Woodshed
    ],
  });
  const terrain = createTerrain({ half: HALF, height });
  const top = (x, z) => terrain.top(x, z);

  box(IX0, 0, IZ0, IX1, FL0, IZ1, 'floor');
  for (const [a, b, c, d] of [[-HALF, -HALF, HALF, -HALF + 1], [-HALF, HALF - 1, HALF, HALF], [-HALF, -HALF + 1, -HALF + 1, HALF - 1], [HALF - 1, -HALF + 1, HALF, HALF - 1]]) box(a, -8, b, c, 12, d, 'boundary', { hidden: true });

  // ---------------------------------------------------------------- outside walls (hard)
  wall('x', BZ0, BX0, BX1, F1, ROOF, 'exterior', [
    win(-16, -14, F1), win(-11, -9, F1), win(-4.6, -3, F1), door(-1.6, 1.6, F1), win(3, 4.6, F1), win(8.5, 10.5, F1), win(14, 16, F1),
    win(-15, -13, F2), win(-11, -10, F2), win(-6, -3, F2), win(3, 6, F2), win(10.5, 12, F2), win(15, 16.6, F2),
  ], 'south');
  wall('x', BZ1, BX0, BX1, F1, ROOF, 'exterior', [
    win(-15, -13, F1), win(-11, -9.5, F1), win(-1, 1, F1), door(7, 9, F1), win(11, 12.5, F1),
    win(-15, -13, F2), win(-7, -5, F2), win(3, 6, F2), win(13, 15, F2),
  ], 'north');
  wall('z', BX0, IZ0, IZ1, F1, ROOF, 'exterior', [
    win(-7, -5, F1), door(-2, 0, F1), win(4, 6, F1),
    win(-7, -5, F2), win(-1, 1, F2), win(4, 6, F2),
  ], 'west');
  wall('z', BX1, IZ0, IZ1, F1, ROOF, 'exterior', [
    win(-5, -3, F1), win(-0.5, 1, F1), door(4, 6, F1),
    win(-5, -3, F2), door(-1, 1, F2), win(5, 7, F2),
  ], 'east');

  // ---------------------------------------------------------------- stairs, floors, roof, balcony
  const A = { x0: -8 + T / 2, x1: -8 + T / 2 + 16 * 0.35, z0: 6.5, z1: IZ1 };            // games room, along the north wall
  const B = { x0: IX1 - 16 * 0.35, x1: IX1, z0: IZ0, z1: IZ0 + 2.5 };                    // restaurant, along the south wall, rising towards -x
  stairs('x', A.x0, A.z0, A.z1, F1, 16, 0.2, 0.35, 1);
  stairs('x', B.x1, B.z0, B.z1, F1, 16, 0.2, 0.35, -1);
  const FLOOR_HATCHES = [[-13, -5], [12, 5.5]], ROOF_HATCHES = [[-13.5, 5.5], [4.5, -5.5], [0, 0]];
  kit.slab(SLAB2, F2, IX0, IZ0, IX1, IZ1, [[A.x0, A.z0, A.x1, A.z1], [B.x0, B.z0, B.x1, B.z1], ...FLOOR_HATCHES.map((h) => hatchHole(...h))], 'floor');
  for (const h of FLOOR_HATCHES) hatch(...h, SLAB2, F2);
  kit.slab(ROOF, ROOF_TOP, BX0, BZ0, BX1, BZ1, ROOF_HATCHES.map((h) => hatchHole(...h)), 'roof');
  const roofHatches = ROOF_HATCHES.map((h) => hatch(...h, ROOF, ROOF_TOP));
  for (const x of [-14, -3, 12]) wallRope('x', BZ0, x, -1, ROOF_TOP, 2.5);
  for (const x of [-12, 4, 14]) wallRope('x', BZ1, x, 1, ROOF_TOP, 2.5);
  for (const z of [-4, 5]) wallRope('z', BX0, z, -1, ROOF_TOP, 2.5);
  wallRope('z', BX1, 6, 1, ROOF_TOP, 2.5);
  ROOF_HATCHES.forEach((h, i) => hatchRope(roofHatches[i], ...h, ROOF_TOP, F2, [0, 1.2]));
  box(A.x0, F2, A.z0 - 0.12, A.x1 - 0.6, F2 + 1.0, A.z0, 'rail');
  box(B.x0 + 0.6, F2, B.z1, B.x1, F2 + 1.0, B.z1 + 0.12, 'rail');
  // The east balcony, and the wooden stair up to it along the east wall
  box(BX1, SLAB2, -3, BX1 + 2.2, F2, 2, 'floor');
  box(BX1 + 2.06, F2, -3, BX1 + 2.2, F2 + 1.0, 2, 'rail');
  box(BX1, F2, 1.86, BX1 + 2.2, F2 + 1.0, 2, 'rail');
  stairs('z', -3 - 16 * 0.35, BX1 + T / 2, BX1 + 2.2, F1, 16, 0.2, 0.35, 1);

  // ---------------------------------------------------------------- inside walls: soft panels and hard stone
  const inner = (floor, axis, fixed, from, to, doors, name, kind = 'interior') => {
    wall(axis, fixed, from, to, floor === 1 ? F1 : F2, floor === 1 ? SLAB2 : ROOF, kind, doors.map(([a, b]) => door(a, b, floor === 1 ? F1 : F2)), name);
  };
  // Ground floor
  inner(1, 'z', -6, IZ0, 2 - T / 2, [[-5, -3]], 'g-lounge-lobby');
  inner(1, 'z', 6, IZ0, 2 - T / 2, [[-5, -3]], 'g-lobby-restaurant');
  inner(1, 'x', 2, IX0, -6 - T / 2, [[-13.6, -12]], 'g-lounge-office');
  inner(1, 'x', 2, 6 + T / 2, IX1, [[11, 13]], 'g-restaurant-kitchen');
  inner(1, 'x', 2, -6 - T / 2, 6 + T / 2, [[-5, -3.4], [3.4, 5]], 'g-firewall', 'hardwall');
  inner(1, 'z', -8, 2 + T / 2, IZ1, [[3.2, 5]], 'g-office-games', 'hardwall');
  inner(1, 'z', 6, 2 + T / 2, IZ1, [[3.2, 5]], 'g-games-kitchen', 'hardwall');
  // First floor: a corridor (z -2..2) with a stone firewall across the middle of the rooms
  inner(2, 'x', -2, IX0, IX1, [[-14, -12.4], [-5, -3.4], [3, 4.6], [12, 13.6]], 'f-corridor-s');
  inner(2, 'x', 2, IX0, IX1, [[-14, -12.4], [-6, -4.4], [3, 4.6], [12, 13.6]], 'f-corridor-n');
  inner(2, 'z', -9, IZ0, -2 - T / 2, [], 'f-s1-s2');
  inner(2, 'z', 0, IZ0, -2 - T / 2, [], 'f-s2-s3', 'hardwall');
  inner(2, 'z', 9, IZ0, -2 - T / 2, [], 'f-s3-s4');
  inner(2, 'z', -9, 2 + T / 2, IZ1, [], 'f-n1-n2');
  inner(2, 'z', 0, 2 + T / 2, IZ1, [], 'f-n2-n3', 'hardwall');
  inner(2, 'z', 9, 2 + T / 2, IZ1, [], 'f-n3-n4');

  // ---------------------------------------------------------------- objective sites and spawns
  const SITES = [
    { id: 0, name: 'Manager\'s office', where: 'ground floor, north-west', x: -13, y: FL0, z: 5.6, size: 0.9, zoneRadius: 2.5 },
    { id: 1, name: 'Kitchen', where: 'ground floor, north-east', x: 12, y: FL0, z: 4.0, size: 0.9, zoneRadius: 2.5 },
    { id: 2, name: 'Pine suite', where: 'first floor, south-west', x: -13.5, y: F2, z: -5.6, size: 0.9, zoneRadius: 2.5 },
  ];
  for (const s of SITES) box(s.x - s.size / 2, s.y, s.z - s.size / 2, s.x + s.size / 2, s.y + s.size, s.z + s.size / 2, 'site');
  const ring = (site, offsets) => offsets.map(([dx, dz]) => ({ x: site.x + dx, y: site.y, z: site.z + dz, yaw: Math.atan2(dx, dz) }));
  const SITE_SPAWNS = [
    ring(SITES[0], [[2.0, -1.8], [-2.2, -1.6], [2.8, 1.4], [0.4, 2.4], [0, -2.0]]),
    ring(SITES[1], [[-1.6, 1.6], [2.2, 0.4], [-1.7, -1.2], [0.4, -1.3], [3.4, -0.6]]),
    ring(SITES[2], [[2.0, 1.8], [-2.0, 1.8], [2.2, -1.2], [-2.6, -1.4], [0, 2.4]]),
  ];
  const SPAWNS = {
    attack: [
      { name: 'Valley Road', x: 45, y: top(45, -54), z: -54, yaw: Math.PI / 2 + 0.3 },    // the bottom of the road
      { name: 'Woodshed', x: -52, y: top(-52, -8), z: -8, yaw: -Math.PI / 2 },
      { name: 'Pine Ridge', x: -30, y: top(-30, 52), z: 52, yaw: -0.5 },
    ],
    defense: [
      { x: 0, y: FL0, z: -3, yaw: 0 }, { x: -2, y: FL0, z: 4.6, yaw: 0 }, { x: 11, y: FL0, z: -4, yaw: 0 },
      { x: -5, y: F2, z: 0, yaw: 0 }, { x: 7, y: F2, z: 0, yaw: 0 },
    ],
  };

  // ---------------------------------------------------------------- floor finishes
  const finish = (x0, z0, x1, z1, y, color, tex) => part([(x0 + x1) / 2, y + 0.006, (z0 + z1) / 2], [x1 - x0, 0.012, z1 - z0], { color, tex });
  finish(6.15, 2.15, IX1, IZ1, FL0, 0xc8c8c0, 'tiles');         // kitchen
  finish(IX0, -1.85, IX1, 1.85, F2, 0x6a3a2e, 'carpet');        // the corridor upstairs
  finish(IX0, IZ0, -9.15, -2.15, F2, 0x3f5a4a, 'carpet');       // Pine suite
  finish(-8.85, IZ0, -0.15, -2.15, F2, 0x7a6a50, 'carpet');
  finish(0.15, IZ0, 8.85, -2.15, F2, 0x5a6a7a, 'carpet');
  finish(IX0, 2.15, -9.15, IZ1, F2, 0x6a5a3a, 'carpet');
  finish(0.15, 2.15, 8.85, IZ1, F2, 0x6a4a5a, 'carpet');
  finish(9.15, 2.15, IX1, IZ1, F2, 0x4a5a6a, 'carpet');

  // ---------------------------------------------------------------- ground floor
  // Lobby: reception desk, seats, the great stone fireplace on the back wall
  F.fireplace(0, 2 - T / 2 - 0.4, 2, FL0, { stone: 0x8a8680, h: SLAB2 });
  F.counter(-3.6, -5.2, 1, FL0, { len: 3.2, wood: WOOD.walnut, stools: 0 });
  F.couch(2.4, -2.9, 1, FL0, { color: 0x7a3a2a, len: 2.0 });
  F.armchair(-0.8, -2.2, 0, FL0, { color: 0x4a5a3a });
  F.coffeeTable(0.7, -3.2, 1, FL0, { w: 1.0, d: 0.6, wood: WOOD.walnut });
  F.rug(0.6, -4.6, 5, 5, FL0, 0x7a2f2f, 0xc8a860);
  F.plant(-5.2, -8.1, FL0, { big: true });
  F.plant(5.2, -8.1, FL0, { big: true });
  F.painting('x', 2, -2.4, 2.0, -1, { w: 0.8, h: 0.6 });
  F.painting('x', 2, 2.4, 2.0, -1, { w: 0.8, h: 0.6 });
  F.clock('x', BZ0, 4, 2.45, 1);
  F.lightSwitch('x', BZ0, 2.0, 1.25, 1);
  F.ceilingLight(0, -4, SLAB2);
  // Lounge (west)
  F.couch(-14.6, -5.9, 1, FL0, { color: 0x5e6f4c, len: 2.4 });
  F.couch(-11.8, -8.1, 0, FL0, { color: 0x5e6f4c, len: 2.0 });
  F.coffeeTable(-12.4, -5.9, 1, FL0, { wood: WOOD.walnut });
  F.rug(-12.4, -5.6, 4.4, 4, FL0, 0x4a3a2a);
  F.bookshelf(-7, -8.5, 0, FL0, { w: 1.6 });
  F.armchair(-16.6, 0.8, 1, FL0, { color: 0x7a5a3a });
  F.poolTable(-10.6, -0.4, 0, FL0);
  F.floorLamp(-17, -8, FL0);
  F.painting('x', BZ0, -12.5, 2.0, 1);
  F.ceilingLight(-12, -4, SLAB2);
  // Restaurant (east): small tables, a bar along the firewall side
  for (const [x, z] of [[9, -5.2], [13, -4.8], [9, -1.0], [14.8, -1.0]]) F.diningSet(x, z, 0, FL0, { seats: 4, w: 1.5, d: 0.9, wood: WOOD.oak });
  F.counter(7.0, 0.6, 1, FL0, { len: 2.2, stools: 2, wood: WOOD.walnut });
  F.plant(17, 1.2, FL0);
  F.ceilingLight(9, -4, SLAB2);
  F.ceilingLight(15, -2, SLAB2);
  // Manager's office (north-west): a site
  F.desk(-16.6, 7.9, 2, FL0, { wood: WOOD.walnut });
  F.bookshelf(-10.6, 8.6, 2, FL0, { w: 1.6 });
  F.filingCabinet(-17.4, 2.8, 1, FL0);
  F.filingCabinet(-17.4, 3.4, 1, FL0);
  F.armchair(-9.4, 3.0, 3, FL0, { color: 0x5a3a2a });
  F.rug(-13, 5.4, 4, 3, FL0, 0x2f4f7a);
  F.wallShelf('z', -8, 7.6, 2.0, -1);
  F.painting('z', -8, 2.8, 2.0, -1, { w: 0.6, h: 0.5 });
  F.ceilingLight(-13, 5.5, SLAB2);
  // Games room (north, centre): stairs along the north wall
  F.poolTable(1.8, 4.6, 1, FL0);
  F.couch(-5.4, 3.1, 0, FL0, { color: 0x6a4a6a, len: 1.8 });
  F.counter(4.4, 8.0, 2, FL0, { len: 2.2, stools: 2 });
  F.tvStand(-1.8, 2.6 + 0.3, 0, FL0);
  F.poster('z', 6, 7.8, 1.7, -1);
  F.poster('z', -8, 7.0 - 0.2, 1.7, 1);
  F.clock('x', 2, -1.8, 2.45, 1);
  F.ceilingLight(0, 5.5, SLAB2);
  // Kitchen (north-east): a site. Long runs along the east and north walls, a big steel island
  F.kitchenRun(14.2 - 0.3, IZ1 - 0.35, 2, FL0, 7.2, { wood: 0xc8ccd0, top: 0x8d9096 });
  F.kitchenRun(16.8, 2.8, 3 + 0, FL0, 1.0, { sink: false, stove: false, wood: 0xc8ccd0, top: 0x8d9096 });
  F.fridge(7.2, IZ1 - 0.42, 2, FL0);
  F.fridge(8.1, 2.65, 0, FL0);
  F.counter(9.0, 5.2, 1, FL0, { len: 2.0, wood: 0xb8bcc2, top: 0x8d9096, stools: 0 });
  F.crateStack(16.9, 7.5 - 0.3, FL0);
  F.ceilingLight(12, 5.5, SLAB2);

  // ---------------------------------------------------------------- first floor
  // Pine suite (south-west): a site
  F.bed(-16.6, -5.0, 1, F2, { blanket: 0x4a7a5a });
  F.nightstand(-17.4, -3.0, 1, F2);
  F.nightstand(-17.4, -7.0, 1, F2);
  F.wardrobe(-10.0, -8.5, 0, F2);
  F.armchair(-9.9, -3.0, 3, F2, { color: 0x3f5a4a });
  F.rug(-13.5, -5.4, 3, 2.6, F2, 0x7a5a3a);
  F.basin(-12.0, -8.5, 0, F2);
  F.ceilingLight(-13.5, -5.5, ROOF);
  // Room 2 (south)
  F.bed(-7.8, -5.0, 1, F2, { blanket: 0x8a5a3a });
  F.nightstand(-8.4, -3.0, 1, F2);
  F.wardrobe(-1.0, -5, 3, F2);
  F.painting('z', 0, -6.4, 4.9, -1, { w: 0.7, h: 0.5 });
  F.ceilingLight(-4.5, -5.5, ROOF);
  // Room 3 (south)
  F.bed(1.1, -5.0, 1, F2, { blanket: 0x4a5a8a, wide: false });
  F.bed(7.9, -5.0, 3, F2, { blanket: 0x4a5a8a, wide: false });
  F.desk(4.5, -8.3, 0, F2, { wood: WOOD.pine, computer: false, w: 1.2 });
  F.poster('z', 0, -3, 4.9, 1);
  F.ceilingLight(4.5, -5.5, ROOF);
  // Linen room over the restaurant stairs (south-east)
  F.crateStack(10.2, -5.0, F2);
  F.bookshelf(10, -2.6, 2, F2, { wood: WOOD.pine, w: 1.4 });
  F.filingCabinet(17.4, -3.4, 3, F2);
  F.ceilingLight(13, -5, ROOF);
  // Corridor
  for (const x of [-16.6, 16.6]) F.plant(x, x < 0 ? -1.2 : 1.3, F2);
  F.ceilingLight(-9, 0, ROOF);
  F.ceilingLight(9, 0, ROOF);
  // Room 5 (north-west)
  F.bed(-16.6, 5.4, 1, F2, { blanket: 0x7a4a3a });
  F.nightstand(-17.4, 7.4, 1, F2);
  F.wardrobe(-10, 8.5, 2, F2);
  F.armchair(-10.4, 3.2, 2, F2, { color: 0x7a4a3a });
  F.ceilingLight(-13.5, 5.5, ROOF);
  // Upstairs lounge (north, stairs come up here)
  F.couch(-1, 3.0, 3, F2, { color: 0x5a4a3a, len: 1.8 });
  F.bookshelf(-8.4, 3.8, 1, F2, { w: 1.4 });
  F.floorLamp(-1, 5.4, F2);
  F.painting('z', 0, 6.8, 4.9, -1, { w: 0.8, h: 0.6 });
  F.ceilingLight(-4.5, 5, ROOF);
  // Room 7 (north)
  F.bed(1.3, 6.6, 1, F2, { blanket: 0x7a3a6a });
  F.nightstand(0.7, 4.7, 1, F2);
  F.wardrobe(8.1, 6.4, 3, F2);
  F.clock('z', 0, 3.2, 5.0, 1);
  F.ceilingLight(4.5, 5.5, ROOF);
  // Room 8 (north-east)
  F.bed(16.6, 6.0, 3, F2, { blanket: 0x3a6a7a });
  F.desk(11, 8.3, 2, F2, { wood: WOOD.oak, computer: false, w: 1.2 });
  F.armchair(10.1, 3.1, 1, F2, { color: 0x3a6a7a });
  F.ceilingLight(13.5, 5.5, ROOF);

  // Roof: the big stone chimney, vents
  box(-2, ROOF_TOP, 1.0, 2, ROOF_TOP + 1.8, 2.6, 'hardwall', { color: 0x8a8680 });
  for (const [x, z] of [[-9, -6], [10, 6]]) { box(x - 0.6, ROOF_TOP, z - 0.6, x + 0.6, ROOF_TOP + 0.8, z + 0.6, 'appliance', { hidden: true }); part([x, ROOF_TOP + 0.4, z], [1.2, 0.8, 1.2], { color: 0x8a8e94, tex: 'metal' }); }

  F.dressOpenings([0, 0], { frame: 0x3a2a1c, trim: 0x2e2014, curtain: 0x7a3a2a });

  // ---------------------------------------------------------------- outside
  const ribbons = [
    { pts: road.map(([x, z]) => [x, z]), width: 5.4, tex: 'asphalt', color: 0x5a5c60 },
    { pts: ramp.map(([x, z]) => [x, z]), width: 4, tex: 'asphalt', color: 0x5a5c60 },
    { pts: ridge.map(([x, z]) => [x, z]), width: 2.4, tex: 'dirt', color: 0xa08c6c },
    { pts: westTrack.map(([x, z]) => [x, z]), width: 2.6, tex: 'dirt', color: 0xa08c6c },
  ];
  // The car park and its bays
  part([-6, LOT + 0.015, -29], [36, 0.03, 14], { color: 0x54565a, tex: 'asphalt' });
  for (let i = 0; i < 9; i++) part([-22 + i * 3.2, LOT + 0.035, -33], [0.12, 0.02, 5], { color: 0xe8e4dc, fine: true });
  for (let i = 0; i < 9; i++) part([-22 + i * 3.2, LOT + 0.035, -25], [0.12, 0.02, 5], { color: 0xe8e4dc, fine: true });
  // Paving round the lodge
  const pave = (x0, z0, x1, z1) => part([(x0 + x1) / 2, 0.015, (z0 + z1) / 2], [x1 - x0, 0.03, z1 - z0], { color: 0xa8a498, tex: 'stone' });
  pave(-20, -13, 20, -9.15);
  pave(-20, 9.15, 24, 11);
  pave(-20, -9.15, -18.15, 9.15);
  pave(18.15, -9.15, 24, 11);
  // Stone steps from the car park up to the front door, low walls either side
  F.steps('z', -21.4, -2.4, 2.4, LOT, 8, 0.2, 0.9, 1, { color: 0x9a958a });
  F.lowWall(-24, -20.6, -2.8, -20.6, top, { h: 0.9 });
  F.lowWall(2.8, -20.6, 12, -20.6, top, { h: 0.9 });
  F.lowWall(-24, -36, -24, -21, top, { h: 0.8 });
  F.lowWall(-24, -36.4, 6, -36.4, top, { h: 0.8 });
  // Fences at the edges of the woods
  F.fence(-58, 16, -30, 16, top);
  F.fence(26, 16, 52, 16, top);
  F.fence(30, -28, 30, 6, top);
  F.fence(-44, -44, -30, -44, top);
  // The woodshed by the west track: a little hard-walled shack with log piles
  const shed = { x: -49, z: 1.5, y: top(-49, 1.5) };
  box(shed.x - 2.5, shed.y, shed.z - 1.8, shed.x + 2.5, shed.y + 2.6, shed.z + 1.8, 'hardwall', { hidden: true });
  part([shed.x, shed.y + 1.3, shed.z], [5, 2.6, 3.6], { color: 0x6a4a2e, tex: 'wood' });
  part([shed.x, shed.y + 2.72, shed.z], [5.5, 0.24, 4.1], { color: 0x4a3a2e, tex: 'shingle' });
  part([shed.x, shed.y + 1.0, shed.z - 1.82], [1.1, 2, 0.05], { color: 0x3a2a1c, tex: 'wood' });
  for (let i = 0; i < 6; i++) for (let j = 0; j < 3 - (i % 2); j++) {
    part([shed.x - 4.4 - i * 0.1, shed.y + 0.17 + j * 0.3, shed.z - 1.2 + i * 0.5], [1.5, 0.3, 0.3], { color: 0x7a5a3a, tex: 'bark', shape: 'cyl', axis: 'x' });
  }
  box(shed.x - 5.2, shed.y, shed.z - 1.4, shed.x - 3.6, shed.y + 0.95, shed.z + 1.6, 'crate', { hidden: true });
  // Yard furniture, a fire pit and a flagpole
  F.bench(-10, -11.6, 0, 0);
  F.bench(10, -11.6, 0, 0);
  F.planterBox(-5, -10, 0, 0);
  F.planterBox(5, -10, 0, 0);
  F.trashBin(20.6, 9.6, 0);
  F.trashBin(19.4, 10, 0);
  F.diningSet(-14, 12.2, 0, 0, { seats: 4, w: 1.6, d: 0.9, wood: WOOD.pine });
  F.diningSet(-6, 12.6, 0, 0, { seats: 4, w: 1.6, d: 0.9, wood: WOOD.pine });
  box(-22, 0, -6.4, -20.4, 0.4, -4.8, 'concrete', { hidden: true });
  part([-21.2, 0.2, -5.6], [1.6, 0.4, 1.6], { color: 0x8a8680, tex: 'stone', shape: 'cyl' });
  part([-21.2, 0.42, -5.6], [1.1, 0.06, 1.1], { color: 0xff7a2a, glow: 0.8, shape: 'cyl' });
  for (const [a, b] of [[-24, -7], [-19, -8.2]]) F.bench(a, b, a < -21 ? 1 : 2, 0);
  box(9.9, 0, -14.1, 10.1, 7, -13.9, 'rail', { hidden: true });
  part([10, 3.5, -14], [0.1, 7, 0.1], { color: 0xc8ccd0, tex: 'metal', shape: 'cyl' });
  part([10.8, 6.5, -14], [1.5, 0.8, 0.03], { color: 0x2f6a4a, tex: 'fabric' });
  // Lamps on the road and the steps
  for (const [x, z] of [[34, -44], [20, -35], [8, -36], [-14, -21.4], [8, -21.4], [24, -14]]) F.lampPost(x, z, top(x, z));
  // Pines everywhere (the same every time)
  let seed = 23;
  const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const lines = [road, ramp, ridge, westTrack];
  const clearOfPaths = (x, z, r) => lines.every((p) => p.every(([a, b], i) => {
    if (i + 1 === p.length) return true;
    const [c, d] = p[i + 1], dx = c - a, dz = d - b, t = Math.max(0, Math.min(1, ((x - a) * dx + (z - b) * dz) / (dx * dx + dz * dz)));
    return Math.hypot(x - (a + dx * t), z - (b + dz * t)) > r;
  }));
  const offFlat = (x, z, m) => !(x > -26 - m && x < 26 + m && z > -14 - m && z < 15 + m) && !(x > -25 - m && x < 13 + m && z > -37 - m && z < -20 - m + m);
  const offSpawns = (x, z) => SPAWNS.attack.every((s) => Math.hypot(x - s.x, z - s.z) > 7) && Math.hypot(x - shed.x, z - shed.z) > 8;
  let trees = 0, tries = 0;
  while (trees < 74 && tries++ < 900) {
    const x = (rand() - 0.5) * (HALF * 2 - 6), z = (rand() - 0.5) * (HALF * 2 - 6);
    if (!offFlat(x, z, 1) || !clearOfPaths(x, z, 4.5) || !offSpawns(x, z)) continue;
    (rand() < 0.86 ? F.pine : F.tree)(x, z, top(x, z), 0.85 + rand() * 0.7);
    trees++;
  }
  let bushes = 0; tries = 0;
  while (bushes < 44 && tries++ < 800) {
    const x = (rand() - 0.5) * (HALF * 2 - 6), z = (rand() - 0.5) * (HALF * 2 - 6);
    if (!offFlat(x, z, -1) || !clearOfPaths(x, z, 3.2)) continue;
    F.bush(x, z, top(x, z), 0.7 + rand() * 0.7);
    bushes++;
  }
  for (const [x, z] of [[-19.5, -12], [-14, -12.5], [14, -12.5], [20, -12], [-23, 8], [-23, 3], [12, 13], [20, 13]]) F.bush(x, z, 0, 0.9);
  // Parked vehicles
  const lotY = LOT;
  F.vehicle(-20.4, -33, 0, lotY, { type: 'suv', color: 0x3a4a2a });
  F.vehicle(-14, -33, 0, lotY, { type: 'sedan', color: 0x9a2a2a });
  F.vehicle(-7.6, -33, 0, lotY, { type: 'pickup', color: 0x24262a });
  F.vehicle(2, -33, 0, lotY, { type: 'sedan', color: 0xc8c4b8 });
  F.vehicle(-17.2, -25, 2, lotY, { type: 'sedan', color: 0x2a4a7a });
  F.vehicle(-4.4, -25, 2, lotY, { type: 'suv', color: 0x7a2a4a });
  F.vehicle(5.2, -25, 2, lotY, { type: 'sedan', color: 0x4a7a6a });
  F.vehicle(22, 6.6, 0, 0, { type: 'van', color: 0xe0e0d8 });                  // the kitchen's delivery van
  F.vehicle(-46.5, -12.5, 1, top(-46.5, -12.5), { type: 'pickup', color: 0x7a5a2a });
  F.vehicle(-34, 42, 3, top(-34, 42), { type: 'suv', color: 0x4a4a52 });
  F.vehicle(38, -44, 2, top(38, -44), { type: 'van', color: 0x3a6a8a });

  return {
    id: 'lodge',
    name: 'Pinecrest Lodge',
    description: 'A detailed timber lodge in the pine woods, above its own car park, with stone steps, a balcony and a stone fireplace. Three objectives.',
    detailed: true,
    terrain,
    ribbons,
    style: {
      exterior: { out: { tex: 'wood', color: 0x7a5636 }, in: { tex: 'stone', color: 0xa8a298 } },
      hardwall: { tex: 'stone', color: 0x8a8680 },
      floor: { tex: 'wood', color: 0x7a5636, under: 0xe0d8c8 },
      roof: { tex: 'shingle', color: 0x3a4a3a, under: 0xe0d8c8 },
      stairs: { tex: 'wood', color: 0x5e4028 },
      softWall: 0xe8dfca,
      grass: 0x5f7f4c,
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
      { x0: BX1, z0: -3.2, x1: BX1 + 2.4, z1: 2.2 },
    ],
    objective: SITES[0],
    sites: SITES,
    siteSpawns: SITE_SPAWNS,
    spawns: SPAWNS,
    lights: [[0, 2.5, -4], [-12, 2.5, -4], [12, 2.5, -4], [-13, 2.5, 5.5], [0, 2.5, 5.5], [12, 2.5, 5.5], [-9, 5.5, 0], [9, 5.5, 0]],
    shadowExtent: 50,
    size: HALF,
  };
}
