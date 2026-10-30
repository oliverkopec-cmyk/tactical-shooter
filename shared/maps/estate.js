// Meridian Hotel: a big three-floor hotel with a large grounds around it.
//
//   Ground floor and first floor cover the whole 40 x 28 m footprint, the second
//   floor is the west wing only. 9 rooms on the ground floor, 13 on the first,
//   3 on the second. Interior walls are destructible; every window and door can
//   be barricaded. Three objective sites on three different floors.
//
//   Layout grid (wall centre lines): x = -20 | -8 | 8 | 20,  z = -14 | -4 | 4 | 14
//   Attackers start outside at the West, South and East entry points.

import { createMapKit } from '../mapkit.js';

export function buildEstate() {
  const kit = createMapKit({ T: 0.3 });
  const { box, wall, door, win, stairs, prop, detail, hatch, hatchHole, wallRope, hatchRope, boxes, barriers, openings, details, hatches, ropes } = kit;
  const T = kit.T;

  // Heights: walking level of each floor, and where each slab starts
  const F1 = 0, F2 = 3.2, F3 = 6.4;
  const SLAB2 = 3.0, SLAB3 = 6.2;
  const CEIL1 = SLAB2, CEIL2 = SLAB3, CEIL3 = 9.4;
  const FL0 = 0.02;                       // ground floor surface (a hair above the grass)
  const HALF = 75;                        // half the size of the grounds

  // Building footprint (wall centre lines)
  const BX0 = -20, BX1 = 20, BZ0 = -14, BZ1 = 14;
  const IX0 = BX0 + T / 2, IX1 = BX1 - T / 2, IZ0 = BZ0 + T / 2, IZ1 = BZ1 - T / 2;

  const floorBase = { 1: F1, 2: F2, 3: F3 };
  const floorWall = { 1: [F1, CEIL1], 2: [F2, CEIL2], 3: [F3, CEIL3] };

  // Areas props must stay out of: doorways, stairs and their landings, spawns, objective boxes
  const keepClear = [];
  const clearRect = (floor, x0, z0, x1, z1) => keepClear.push({ floor, x0: Math.min(x0, x1), z0: Math.min(z0, z1), x1: Math.max(x0, x1), z1: Math.max(z0, z1) });

  /** An interior (destructible) wall on a floor with doorways [[from, to], ...]. */
  function interior(floor, axis, fixed, from, to, doors, name) {
    const [y0, y1] = floorWall[floor];
    wall(axis, fixed, from, to, y0, y1, 'interior', doors.map(([a, b]) => door(a, b, floorBase[floor])), name);
    for (const [a, b] of doors) {
      if (axis === 'x') clearRect(floor, a - 0.4, fixed - 1.4, b + 0.4, fixed + 1.4);
      else clearRect(floor, fixed - 1.4, a - 0.4, fixed + 1.4, b + 0.4);
    }
  }

  /** Subtract rectangular holes from a floor slab and add what is left as boxes. */
  function slab(y0, y1, x0, z0, x1, z1, holes = []) {
    let rects = [[x0, z0, x1, z1]];
    for (const [hx0, hz0, hx1, hz1] of holes) {
      const next = [];
      for (const [a0, b0, a1, b1] of rects) {
        if (hx1 <= a0 || hx0 >= a1 || hz1 <= b0 || hz0 >= b1) { next.push([a0, b0, a1, b1]); continue; }
        if (hx0 > a0) next.push([a0, b0, hx0, b1]);
        if (hx1 < a1) next.push([hx1, b0, a1, b1]);
        const m0 = Math.max(a0, hx0), m1 = Math.min(a1, hx1);
        if (hz0 > b0) next.push([m0, b0, m1, hz0]);
        if (hz1 < b1) next.push([m0, hz1, m1, b1]);
      }
      rects = next;
    }
    for (const [a0, b0, a1, b1] of rects) box(a0, y0, b0, a1, y1, b1, 'floor');
  }

  // ---------------------------------------------------------------- terrain
  box(-HALF, -1, -HALF, HALF, 0, HALF, 'ground');
  box(IX0, 0, IZ0, IX1, FL0, IZ1, 'floor');             // ground floor, a hair above the grass
  box(-HALF, 0, -HALF, HALF, 4, -HALF + 1, 'boundary');
  box(-HALF, 0, HALF - 1, HALF, 4, HALF, 'boundary');
  box(-HALF, 0, -HALF + 1, -HALF + 1, 4, HALF - 1, 'boundary');
  box(HALF - 1, 0, -HALF + 1, HALF, 4, HALF - 1, 'boundary');

  // ---------------------------------------------------------------- exterior walls
  // Windows and doors, per wall and floor. x/z are positions along the wall.
  const S_WIN_G = [[-17, -15], [-13, -11], [-6, -4], [4, 6], [11, 13], [15, 17]];
  const S_WIN_U = [[-17, -15], [-13, -11], [-6, -4], [4, 6], [11, 13], [15, 17]];
  wall('x', BZ0, BX0, BX1, F1, CEIL2, 'exterior', [
    ...S_WIN_G.map(([a, b]) => win(a, b, F1)), door(-2, 2, F1),
    ...S_WIN_U.map(([a, b]) => win(a, b, F2)),
  ], 'south');
  wall('x', BZ1, BX0, BX1, F1, CEIL2, 'exterior', [
    ...[[-17, -15], [-12, -10], [4, 6], [10, 12], [15, 17]].map(([a, b]) => win(a, b, F1)), door(-2, 2, F1),
    ...[[-12, -10], [4, 6], [10, 12], [15, 17]].map(([a, b]) => win(a, b, F2)), door(-3, -1, F2),
  ], 'north');
  wall('z', BX0, IZ0, IZ1, F1, CEIL2, 'exterior', [
    win(-12, -10, F1), win(-8, -6, F1), door(-1, 1, F1), win(6, 8, F1), win(10, 12, F1),
    win(-12, -10, F2), win(-8, -6, F2), win(-1, 1, F2), win(6, 8, F2), win(10, 12, F2),
  ], 'west');
  wall('z', BX1, IZ0, IZ1, F1, CEIL2, 'exterior', [
    win(-8, -6, F1), door(-1, 1, F1), win(6, 8, F1), win(10, 12, F1),
    win(-12, -10, F2), door(-8, -6, F2), win(6, 8, F2), win(10, 12, F2),
  ], 'east');
  // Second floor (west wing only): its own outer walls, and the wall facing the roof
  wall('x', BZ0, BX0, -8 + T / 2, CEIL2, CEIL3, 'exterior', [win(-17, -15, F3), win(-13, -11, F3)], 'south-top');
  wall('x', BZ1, BX0, -8 + T / 2, CEIL2, CEIL3, 'exterior', [win(-12, -10, F3)], 'north-top');
  wall('z', BX0, IZ0, IZ1, CEIL2, CEIL3, 'exterior', [win(-10, -8, F3), win(-1, 1, F3), win(8, 10, F3)], 'west-top');
  wall('z', -8, IZ0, IZ1, CEIL2, CEIL3, 'exterior', [win(-10, -8, F3), win(8, 10, F3)], 'east-top');
  // Exterior doors need room to open
  clearRect(1, -3, BZ0 + 0.1, 3, BZ0 + 2.2); clearRect(1, -3, BZ1 - 2.2, 3, BZ1 - 0.1);
  clearRect(1, BX0 + 0.1, -2, BX0 + 2.2, 2); clearRect(1, BX1 - 2.2, -2, BX1 - 0.1, 2);

  // ---------------------------------------------------------------- stairs and slabs
  // A: ground -> first floor in the west hall (rises towards +x along the north side of the room)
  const A = { x0: IX0, x1: IX0 + 16 * 0.35, z0: 1.05, z1: 3.85 };
  // B: the same on the east side (rises towards -x)
  const B = { x0: IX1 - 16 * 0.35, x1: IX1, z0: 1.05, z1: 3.85 };
  // C: first -> second floor in the north-west room
  const C = { x0: IX0, x1: IX0 + 16 * 0.35, z0: 11.2, z1: 13.85 };
  stairs('x', A.x0, A.z0, A.z1, F1, 16, 0.2, 0.35, 1);
  stairs('x', B.x1, B.z0, B.z1, F1, 16, 0.2, 0.35, -1);
  stairs('x', C.x0, C.z0, C.z1, F2, 16, 0.2, 0.35, 1);
  // Landings and the walkway beside each flight must stay free
  clearRect(1, A.x0 - 0.1, -1.0, A.x1 + 1.2, A.z1); clearRect(2, A.x0 - 0.1, -1.0, A.x1 + 2.2, A.z1);
  clearRect(1, B.x0 - 1.2, -1.0, B.x1 + 0.1, B.z1); clearRect(2, B.x0 - 2.2, -1.0, B.x1 + 0.1, B.z1);
  clearRect(2, C.x0 - 0.1, 9.6, C.x1 + 1.2, C.z1); clearRect(3, C.x0 - 0.1, 9.6, C.x1 + 2.2, C.z1);

  // First-floor slab (holes for stairs A and B), second-floor slab over the west wing (hole for C)
  // Hatches: two in the first-floor slab (drop to the ground floor), three in the roofs (drop to the floor below)
  const FLOOR_HATCHES = [[-17, -1], [9.5, 8]], ROOF_HATCHES = [[-5, 1], [10, 7]], WING_HATCH = [-18, 0];
  slab(SLAB2, F2, IX0, IZ0, IX1, IZ1, [[A.x0, A.z0, A.x1, A.z1], [B.x0, B.z0, B.x1, B.z1], ...FLOOR_HATCHES.map((h) => hatchHole(...h))]);
  for (const h of FLOOR_HATCHES) hatch(...h, SLAB2, F2);
  slab(SLAB3, F3, IX0, IZ0, -8 + T / 2, IZ1, [[C.x0, C.z0, C.x1, C.z1]]);
  // Roofs: flat over the centre and east, higher over the west wing
  kit.slab(CEIL2, CEIL2 + 0.3, -8 + T / 2, BZ0, BX1, BZ1, ROOF_HATCHES.map((h) => hatchHole(...h)), 'roof');
  kit.slab(CEIL3, CEIL3 + 0.2, BX0, BZ0, -8 + T / 2, BZ1, [hatchHole(...WING_HATCH)], 'roof');
  const roofHatches = ROOF_HATCHES.map((h) => hatch(...h, CEIL2, CEIL2 + 0.3));
  const wingHatch = hatch(...WING_HATCH, CEIL3, CEIL3 + 0.2);
  // Ropes from the roof edges down every outside wall (the west wing roof is higher), and down each roof hatch
  const LOW_TOP = CEIL2 + 0.3, HIGH_TOP = CEIL3 + 0.2;
  for (const x of [-14]) wallRope('x', BZ0, x, -1, HIGH_TOP, 2.5);
  for (const x of [-1, 14]) wallRope('x', BZ0, x, -1, LOW_TOP, 2.5);
  for (const x of [-14]) wallRope('x', BZ1, x, 1, HIGH_TOP, 2.5);
  for (const x of [8, 14]) wallRope('x', BZ1, x, 1, LOW_TOP, 2.5);
  for (const z of [-8, 0, 8]) wallRope('z', BX0, z, -1, HIGH_TOP, 2.5);
  for (const z of [2, 10]) wallRope('z', BX1, z, 1, LOW_TOP, 2.5);
  ROOF_HATCHES.forEach((h, i) => hatchRope(roofHatches[i], ...h, LOW_TOP, F2, [0, 1.2]));
  hatchRope(wingHatch, ...WING_HATCH, HIGH_TOP, F3, [0, 1.2]);
  // Railings where the stairs open onto the floor above
  box(A.x0, F2, A.z0 - 0.15, A.x1 - 0.5, F2 + 1.0, A.z0, 'rail');
  box(B.x0 + 0.5, F2, B.z0 - 0.15, B.x1, F2 + 1.0, B.z0, 'rail');
  box(C.x0, F3, C.z0 - 0.15, C.x1 - 0.5, F3 + 1.0, C.z0, 'rail');

  // ---------------------------------------------------------------- balconies with outside stairs
  // East balcony (first floor) reached from the ground by stairs along the east wall
  box(BX1, SLAB2, -9, BX1 + 2.2, F2, -5, 'floor');
  box(BX1 + 2.05, F2, -9, BX1 + 2.2, F2 + 1.0, -4.85, 'rail');
  box(BX1, F2, -5, BX1 + 2.2, F2 + 1.0, -4.85, 'rail');
  stairs('z', -9 - 16 * 0.35, BX1, BX1 + 2.2, F1, 16, 0.2, 0.35, 1);
  // North balcony, stairs along the north wall
  box(-4, SLAB2, BZ1, 0, F2, BZ1 + 2.2, 'floor');
  box(-4, F2, BZ1 + 2.05, 0.15, F2 + 1.0, BZ1 + 2.2, 'rail');
  box(0, F2, BZ1, 0.15, F2 + 1.0, BZ1 + 2.2, 'rail');
  stairs('x', -4 - 16 * 0.35, BZ1, BZ1 + 2.2, F1, 16, 0.2, 0.35, 1);

  // ---------------------------------------------------------------- interior walls
  const WL = IX0, ER = IX1;                      // outer faces of the building inside
  const wSeg = [WL, -8 - T / 2], cSeg = [-8 + T / 2, 8 - T / 2], eSeg = [8 + T / 2, ER];

  // Ground floor: nine rooms (west / centre / east  x  south / middle / north)
  interior(1, 'z', -8, IZ0, IZ1, [[-9, -7], [-1, 1], [7, 9]], 'g-w');
  interior(1, 'z', 8, IZ0, IZ1, [[-9, -7], [-1, 1], [7, 9]], 'g-e');
  interior(1, 'x', -4, ...wSeg, [[-15, -13]], 'g-ws');
  interior(1, 'x', 4, ...wSeg, [[-12, -10]], 'g-wn');
  interior(1, 'x', -4, ...cSeg, [[-2, 2]], 'g-cs');
  interior(1, 'x', 4, ...cSeg, [[-2, 2]], 'g-cn');
  interior(1, 'x', -4, ...eSeg, [[13, 15]], 'g-es');
  interior(1, 'x', 4, ...eSeg, [[10, 12]], 'g-en');

  // First floor: thirteen rooms (the four corner rooms are split in two)
  interior(2, 'z', -8, IZ0, IZ1, [[-9, -7], [-1, 1], [7, 9]], 'f-w');
  interior(2, 'z', 8, IZ0, IZ1, [[-9, -7], [-1, 1], [7, 9]], 'f-e');
  interior(2, 'x', -4, ...wSeg, [[-18, -16], [-12, -10]], 'f-ws');
  interior(2, 'x', 4, ...wSeg, [[-12, -10]], 'f-wn');
  interior(2, 'x', -4, ...cSeg, [[-2, 2]], 'f-cs');
  interior(2, 'x', 4, ...cSeg, [[-2, 2]], 'f-cn');
  interior(2, 'x', -4, ...eSeg, [[10, 12], [16, 18]], 'f-es');
  interior(2, 'x', 4, ...eSeg, [[10, 12]], 'f-en');
  interior(2, 'z', -14, IZ0, -4 - T / 2, [[-9, -7]], 'f-split-ws');
  interior(2, 'z', 14, IZ0, -4 - T / 2, [[-9, -7]], 'f-split-es');
  interior(2, 'z', 14, 4 + T / 2, IZ1, [[8, 10]], 'f-split-en');

  // Second floor (west wing): three rooms
  interior(3, 'x', -4, ...wSeg, [[-15, -13]], 'h-s');
  interior(3, 'x', 4, ...wSeg, [[-15, -13]], 'h-n');

  // ---------------------------------------------------------------- objective sites and spawns
  const SITES = [
    { id: 0, name: 'Kitchen', where: 'ground floor, north', x: 0, y: FL0, z: 9, size: 0.9, zoneRadius: 2.6 },
    { id: 1, name: 'Gallery', where: 'first floor, centre', x: 0, y: F2, z: 0, size: 0.9, zoneRadius: 2.8 },
    { id: 2, name: 'Penthouse suite', where: 'second floor, west wing', x: -14, y: F3, z: 0, size: 0.9, zoneRadius: 2.8 },
  ];
  for (const s of SITES) {
    box(s.x - s.size / 2, s.y, s.z - s.size / 2, s.x + s.size / 2, s.y + s.size, s.z + s.size / 2, 'site');
    const floor = s.y > 6 ? 3 : s.y > 2 ? 2 : 1;
    clearRect(floor, s.x - 1.1, s.z - 1.1, s.x + 1.1, s.z + 1.1);
  }
  const OBJECTIVE = SITES[0];

  // Defenders start in or next to the site they voted for, facing it
  const ring = (site, offsets) => offsets.map(([dx, dz]) => ({
    x: site.x + dx, y: site.y, z: site.z + dz, yaw: Math.atan2(-(site.x - (site.x + dx)), -(site.z - (site.z + dz))),
  }));
  const SITE_SPAWNS = [
    ring(SITES[0], [[-2.2, 0], [2.2, 0.5], [-1.2, 2.2], [1.4, -2.0], [-3.2, -1.8]]),
    ring(SITES[1], [[-2.4, 0.6], [2.4, -0.6], [0, 2.2], [-1.6, -2.0], [2.0, 2.0]]),
    ring(SITES[2], [[-2.4, 0.6], [2.4, -0.6], [0, 2.4], [-1.6, -2.2], [2.2, 2.0]]),
  ];
  for (const list of SITE_SPAWNS) for (const sp of list) clearRect(sp.y > 6 ? 3 : sp.y > 2 ? 2 : 1, sp.x - 0.9, sp.z - 0.9, sp.x + 0.9, sp.z + 0.9);

  const SPAWNS = {
    // Three entry points around the grounds, far from the hotel
    attack: [
      { name: 'West', x: -52, y: 0, z: 2, yaw: -Math.PI / 2 },
      { name: 'South', x: 0, y: 0, z: -52, yaw: Math.PI },
      { name: 'East', x: 52, y: 0, z: 2, yaw: Math.PI / 2 },
    ],
    defense: [
      { x: 0, y: FL0, z: 11, yaw: 0 }, { x: 0, y: F2, z: -2, yaw: 0 }, { x: -11, y: F3, z: 2, yaw: 0 },
      { x: 12, y: FL0, z: 9, yaw: 0 }, { x: -12, y: F2, z: -9, yaw: 0 },
    ],
  };
  for (const sp of SPAWNS.defense) clearRect(sp.y > 6 ? 3 : sp.y > 2 ? 2 : 1, sp.x - 0.9, sp.z - 0.9, sp.x + 0.9, sp.z + 0.9);

  // ---------------------------------------------------------------- furniture
  // Props are scattered on a 3 m grid inside each room, never in doorways, on stairs or on spawns.
  let seed = 7;
  const rand = () => { seed = (seed + 0x6d2b79f5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const CATALOG = {
    desk: ['furniture', 1.8, 0.9, 0.75, 0x7a5c3a], table: ['furniture', 1.6, 1.0, 0.75, 0x8a6a45], sofa: ['furniture', 1.9, 0.9, 0.8, 0x5e6f8c],
    shelf: ['furniture', 1.2, 0.5, 1.9, 0x5b4630], cabinet: ['furniture', 0.9, 0.6, 1.3, 0x6b6f75], bed: ['furniture', 2.0, 2.0, 0.6, 0x6a7fa0],
    wardrobe: ['furniture', 1.0, 1.8, 2.0, 0x5b4630], counter: ['furniture', 2.4, 0.8, 0.95, 0x6b5a45], crate: ['crate', 1.0, 1.0, 1.2, 0x9a7448],
    crateS: ['crate', 0.8, 0.8, 0.9, 0x9a7448], barrel: ['barrel', 0.6, 0.6, 0.9, 0x3d6a9a], column: ['concrete', 0.6, 0.6, 2.9, 0xb8b4aa],
    planter: ['planter', 1.0, 0.8, 0.7, 0x4b3a2b], bench: ['furniture', 1.8, 0.5, 0.5, 0x7a5c3a],
  };
  const STYLES = {
    office: ['desk', 'desk', 'desk', 'cabinet', 'cabinet', 'table', 'crateS', 'shelf'],
    bedroom: ['bed', 'bed', 'wardrobe', 'table', 'sofa', 'cabinet'],
    lounge: ['sofa', 'sofa', 'sofa', 'table', 'table', 'planter', 'bench'],
    storage: ['crate', 'crate', 'crate', 'crateS', 'shelf', 'shelf', 'barrel', 'barrel'],
    kitchen: ['counter', 'counter', 'table', 'table', 'barrel', 'cabinet', 'crateS'],
    dining: ['table', 'table', 'table', 'bench', 'sofa', 'cabinet'],
    lobby: ['counter', 'sofa', 'sofa', 'planter', 'planter', 'column', 'bench'],
    gallery: ['column', 'column', 'planter', 'bench', 'sofa', 'crateS'],
    suite: ['bed', 'sofa', 'sofa', 'table', 'wardrobe', 'desk', 'cabinet'],
    atrium: ['column', 'planter', 'planter', 'bench', 'sofa'],
  };
  const overlaps = (floor, x0, z0, x1, z1) => keepClear.some((c) => c.floor === floor && x0 < c.x1 && x1 > c.x0 && z0 < c.z1 && z1 > c.z0);

  /** Furnish a room whose walls have centre lines cx0..cx1, cz0..cz1. */
  function furnish(floor, cx0, cz0, cx1, cz1, style, density = 0.9) {
    const x0 = cx0 + T / 2 + 0.15, x1 = cx1 - T / 2 - 0.15, z0 = cz0 + T / 2 + 0.15, z1 = cz1 - T / 2 - 0.15;
    const list = STYLES[style];
    const base = floor === 1 ? FL0 : floorBase[floor];
    const cols = Math.max(1, Math.floor((x1 - x0) / 2.6)), rows = Math.max(1, Math.floor((z1 - z0) / 2.6));
    const cw = (x1 - x0) / cols, ch = (z1 - z0) / rows;
    for (let i = 0; i < cols; i++) {
      for (let j = 0; j < rows; j++) {
        if (rand() > density) continue;
        const [kind, w0, d0, h, color] = CATALOG[list[Math.floor(rand() * list.length)]];
        const turned = rand() < 0.5;
        const w = turned ? d0 : w0, d = turned ? w0 : d0;
        if (w > cw || d > ch) continue;
        // Against a wall about half the time (cover and a lived-in look), otherwise anywhere in the cell
        const cx = x0 + (i + 0.5) * cw, cz = z0 + (j + 0.5) * ch;
        const px = Math.min(x1 - w / 2, Math.max(x0 + w / 2, cx + (rand() - 0.5) * (cw - w)));
        const pz = Math.min(z1 - d / 2, Math.max(z0 + d / 2, cz + (rand() - 0.5) * (ch - d)));
        if (overlaps(floor, px - w / 2 - 0.2, pz - d / 2 - 0.2, px + w / 2 + 0.2, pz + d / 2 + 0.2)) continue;
        prop(kind, px, pz, w, d, h, color, base);
      }
    }
    // A rug and a picture or two
    const rugColors = [0x7a2f2f, 0x2f4f7a, 0x4f6f3a, 0x6f3a5a, 0x3a3a46, 0x7a5f2f];
    const cxm = (x0 + x1) / 2, czm = (z0 + z1) / 2;
    detail(cxm, base + 0.01, czm, Math.min(3.4, (x1 - x0) * 0.5), 0.02, Math.min(2.4, (z1 - z0) * 0.5), rugColors[Math.floor(rand() * rugColors.length)]);
    const picColors = [0x4a6fa5, 0xa5764a, 0x6aa56f, 0xa54a6f, 0x4aa5a0, 0xa59a4a];
    for (let k = 0; k < 2; k++) {
      const px = x0 + 1.5 + rand() * (x1 - x0 - 3);
      if (!overlaps(floor, px - 0.6, z1 - 0.3, px + 0.6, z1 + 0.5)) detail(px, base + 1.8, z1 + 0.12, 0.9 + rand() * 0.4, 0.6, 0.04, picColors[Math.floor(rand() * picColors.length)]);
    }
  }

  // Ground floor
  furnish(1, BX0, BZ0, -8, -4, 'office');       // security office
  furnish(1, -8, BZ0, 8, -4, 'lobby', 0.8);     // grand lobby
  furnish(1, 8, BZ0, BX1, -4, 'lounge');        // lounge bar
  furnish(1, BX0, -4, -8, 4, 'storage', 0.55);  // west hall (stairs A)
  furnish(1, -8, -4, 8, 4, 'atrium', 0.6);      // atrium
  furnish(1, 8, -4, BX1, 4, 'storage', 0.55);   // east hall (stairs B)
  furnish(1, BX0, 4, -8, BZ1, 'storage');       // storage
  furnish(1, -8, 4, 8, BZ1, 'kitchen', 0.75);   // kitchen (site)
  furnish(1, 8, 4, BX1, BZ1, 'dining');         // dining room
  // First floor
  furnish(2, BX0, BZ0, -14, -4, 'bedroom');
  furnish(2, -14, BZ0, -8, -4, 'bedroom');
  furnish(2, -8, BZ0, 8, -4, 'lounge');
  furnish(2, 14, BZ0, BX1, -4, 'bedroom');
  furnish(2, 8, BZ0, 14, -4, 'bedroom');
  furnish(2, BX0, -4, -8, 4, 'office', 0.5);
  furnish(2, -8, -4, 8, 4, 'gallery', 0.6);     // gallery (site)
  furnish(2, 8, -4, BX1, 4, 'office', 0.5);
  furnish(2, BX0, 4, -8, BZ1, 'storage');
  furnish(2, -8, 4, 8, BZ1, 'dining');
  furnish(2, 8, 4, 14, BZ1, 'bedroom');
  furnish(2, 14, 4, BX1, BZ1, 'bedroom');
  // Second floor
  furnish(3, BX0, BZ0, -8, -4, 'suite');
  furnish(3, BX0, -4, -8, 4, 'suite', 0.55);    // penthouse suite (site)
  furnish(3, BX0, 4, -8, BZ1, 'lounge');

  // ---------------------------------------------------------------- the grounds
  const outside = (kind, x, z, w, d, h, color, base = 0) => prop(kind, x, z, w, d, h, color, base);
  // Cover in three approaches (west, south, east) and a back garden
  const crates = [
    [-30, -4, 1.2], [-34, 8, 1.4], [-27, 14, 1.2], [-44, -10, 1.4], [-40, 4, 1.2], [-36, -16, 1.2],
    [-12, -30, 1.2], [8, -33, 1.4], [14, -26, 1.2], [-6, -42, 1.4], [4, -44, 1.2], [20, -38, 1.2], [-20, -36, 1.2],
    [30, -6, 1.2], [34, 6, 1.4], [28, 14, 1.2], [42, -12, 1.4], [38, 2, 1.2], [44, 12, 1.2],
    [-24, 26, 1.2], [-6, 30, 1.4], [14, 28, 1.2], [26, 24, 1.2], [0, 40, 1.4],
  ];
  for (const [x, z, s] of crates) outside('crate', x, z, s, s, s, 0x9a7448);
  for (const [x, z, w, d] of [[-34, -22, 6.4, 2.4], [-16, -44, 2.4, 6.4], [22, -46, 6.4, 2.4], [36, -22, 2.4, 6.4], [-32, 24, 6.4, 2.4], [26, 38, 6.4, 2.4], [44, 22, 2.4, 6.4]]) outside('container', x, z, w, d, 2.4, [0x2f6f73, 0x7a3a2f, 0x3a5a7a, 0x6a6a3a][Math.abs(Math.round(x + z)) % 4]);
  for (const [x, z, w, d] of [[-24, -12, 3, 0.5], [-26, 6, 0.5, 3], [-10, -22, 3, 0.5], [10, -20, 3, 0.5], [26, -10, 0.5, 3], [28, 8, 0.5, 3], [-14, 26, 3, 0.5], [12, 24, 3, 0.5], [-2, -28, 3, 0.5], [2, 34, 3, 0.5]]) outside('concrete', x, z, w, d, 0.9, 0x9a9a98);
  for (const [x, z] of [[-28, -8], [-27.3, -8.6], [-8, -26], [-7.3, -26.6], [30, -2], [30.7, -2.6], [18, 30], [18.7, 30.6], [-18, 30], [-17.3, 30.6], [8, -48], [8.7, -48.6]]) outside('barrel', x, z, 0.6, 0.6, 0.9, 0x3d6a9a);
  for (const [x, z] of [[-4, -20], [16, -22], [-22, -26], [34, 12], [-38, -4]]) { outside('pallet', x, z, 1.2, 1.2, 0.5, 0xb08a58); outside('pallet', x, z, 1.0, 1.0, 0.5, 0xa77f4d, 0.5); }
  // Vehicles
  outside('car', -14, -18, 4.2, 1.8, 1.35, 0x8b2f2f);
  outside('car', 18, -16, 4.2, 1.8, 1.35, 0x46607a);
  outside('car', -32, 18, 1.8, 4.2, 1.35, 0x2f6a4a);
  outside('car', 30, 20, 1.8, 4.2, 1.35, 0x6a6a72);
  outside('car', 34, -14, 6.5, 2.4, 2.2, 0xd9d4c8);          // delivery vans
  outside('car', -36, -12, 2.4, 6.5, 2.2, 0xc8d0d9);
  // Front courtyard: planters, benches and a fountain basin
  for (const x of [-6, 6]) outside('planter', x, -16, 2.4, 0.9, 0.7, 0x4b3a2b);
  for (const x of [-9, 9]) outside('planter', x, -16.5, 1.0, 1.0, 0.7, 0x4b3a2b);
  outside('concrete', 0, -22, 4.0, 4.0, 0.7, 0xa8a8a4);
  outside('concrete', 0, -22, 2.4, 2.4, 1.1, 0x8a8a88);
  // Back garden
  for (const [x, z] of [[-10, 20], [-4, 22], [4, 21], [10, 19], [0, 18], [16, 22]]) outside('planter', x, z, 2.0, 0.8, 0.8, 0x3f5a3a);
  outside('furniture', -14, 22, 2.0, 0.9, 0.75, 0x8a6a45); outside('furniture', 8, 24, 2.0, 0.9, 0.75, 0x8a6a45);

  // Visual details outside
  for (const [x, z, w] of [[-14, -18, 4.2], [18, -16, 4.2]]) {
    detail(x, 1.12, z, w * 0.5, 0.45, 1.84, 0x1a2230);        // car windows
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) detail(x + sx * w * 0.32, 0.22, z + sz * 0.9, 0.7, 0.44, 0.1, 0x16181b);   // wheels
  }
  detail(0, 0.76, -22, 3.8, 0.04, 3.8, 0x4a7a9a);              // fountain water
  for (const [x, z] of [[-16, -15.4], [16, -15.4], [-16, 15.4], [16, 15.4]]) detail(x, 1.2, z, 0.8, 2.0, 0.8, 0x3f7a3a);   // topiary by the corners
  detail(0, 2.6, BZ0 - 0.2, 4.4, 0.5, 0.12, 0xd9a824, true);   // hotel sign over the front door

  return {
    id: 'estate',
    name: 'Meridian Hotel',
    description: 'A big three-floor hotel with 25 rooms, two balconies, a large garden and three objectives on three floors. Longer rounds.',
    boxes,
    barriers,
    openings,
    details,
    hatches,
    ropes,
    // "In the building": the main footprint plus the two balconies
    building: [
      { x0: BX0 - 0.2, z0: BZ0 - 0.2, x1: BX1 + 0.2, z1: BZ1 + 0.2 },
      { x0: BX1, z0: -9.2, x1: BX1 + 2.4, z1: -4.8 },
      { x0: -4.2, z0: BZ1, x1: 0.2, z1: BZ1 + 2.4 },
    ],
    objective: OBJECTIVE,
    sites: SITES,
    siteSpawns: SITE_SPAWNS,
    spawns: SPAWNS,
    lights: [[-14, 2.6, 0], [0, 2.6, -9], [0, 2.6, 9], [14, 2.6, 0], [-14, 5.8, 0], [0, 5.8, 0], [14, 5.8, 0], [-14, 9.0, 0]],
    shadowExtent: 50,
    size: HALF,
  };
}
