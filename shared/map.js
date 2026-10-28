// The map ("Dockside House"): a small two-storey building with an outdoor approach.
// Every solid thing is an axis-aligned box; client renders them, server and client
// both collide against them. Units are metres, +y is up, attackers spawn at -z.

const T = 0.3;            // wall thickness
const GROUND_TOP = 0;
const SLAB_BOTTOM = 3.0;  // ceiling of the ground floor
const FLOOR2 = 3.2;       // walking height of the upper floor
const ROOF_BOTTOM = 6.0;
const ROOF_TOP = 6.2;

// Building footprint (outer faces of exterior walls)
const BX0 = -12, BX1 = 12, BZ0 = -8, BZ1 = 8;
const IX0 = BX0 + T / 2, IX1 = BX1 - T / 2, IZ0 = BZ0 + T / 2, IZ1 = BZ1 - T / 2;

const boxes = [];
const barriers = [];   // invisible plugs in exterior openings; only defenders in prep collide with them
let nextId = 1;

function box(x0, y0, z0, x1, y1, z1, kind, extra = {}) {
  const b = {
    id: nextId++,
    min: [Math.min(x0, x1), Math.min(y0, y1), Math.min(z0, z1)],
    max: [Math.max(x0, x1), Math.max(y0, y1), Math.max(z0, z1)],
    kind,
    ...extra,
  };
  boxes.push(b);
  return b;
}

/**
 * A straight wall with rectangular openings (doors / windows).
 * axis 'x': wall runs along x at z = fixed. axis 'z': runs along z at x = fixed.
 * openings: [{ from, to, y0, y1 }] in the wall's running coordinate.
 * Each solid piece becomes its own box; interior pieces are tagged with a wallId
 * so later stages can turn them into destructible panel grids.
 */
function wall(axis, fixed, from, to, y0, y1, kind, openings = [], name = '') {
  const ops = [...openings].sort((a, b) => a.from - b.from);
  const pieces = [];
  let cursor = from;
  const push = (a, b, py0, py1) => {
    if (b - a < 1e-3 || py1 - py0 < 1e-3) return;
    const piece = axis === 'x'
      ? box(a, py0, fixed - T / 2, b, py1, fixed + T / 2, kind)
      : box(fixed - T / 2, py0, a, fixed + T / 2, py1, b, kind);
    piece.wallAxis = axis;
    piece.wallName = name;
    pieces.push(piece);
  };
  for (const op of ops) {
    push(cursor, op.from, y0, y1);
    push(op.from, op.to, y0, op.y0);   // below opening (window sill)
    push(op.from, op.to, op.y1, y1);   // above opening (lintel)
    cursor = op.to;
  }
  push(cursor, to, y0, y1);
  if (kind === 'exterior') {
    for (const op of ops) {
      const [bx0, bz0, bx1, bz1] = axis === 'x'
        ? [op.from, fixed - T / 2, op.to, fixed + T / 2]
        : [fixed - T / 2, op.from, fixed + T / 2, op.to];
      barriers.push({ id: -(barriers.length + 1), kind: 'barrier', min: [bx0, op.y0, bz0], max: [bx1, op.y1, bz1] });
    }
  }
  return pieces;
}

const door = (from, to, base = GROUND_TOP) => ({ from, to, y0: base, y1: base + 2.4 });
const win = (from, to, base = GROUND_TOP) => ({ from, to, y0: base + 1.0, y1: base + 2.2 });
const upDoor = (from, to) => door(from, to, FLOOR2);
const upWin = (from, to) => win(from, to, FLOOR2);

// Stairs: solid steps filled down to `base`, rising along +x or +z.
function stairs(axis, start, a0, a1, base, steps, rise, run) {
  for (let i = 0; i < steps; i++) {
    const s0 = start + i * run, s1 = s0 + run, top = base + (i + 1) * rise;
    if (axis === 'x') box(s0, base, a0, s1, top, a1, 'stairs');
    else box(a0, base, s0, a1, top, s1, 'stairs');
  }
}

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

// ---------------------------------------------------------------- objective & spawns
export const OBJECTIVE = { x: 7.5, y: FLOOR2, z: 2.5, size: 0.9, zoneRadius: 2.5 };
box(OBJECTIVE.x - OBJECTIVE.size / 2, FLOOR2, OBJECTIVE.z - OBJECTIVE.size / 2,
  OBJECTIVE.x + OBJECTIVE.size / 2, FLOOR2 + OBJECTIVE.size, OBJECTIVE.z + OBJECTIVE.size / 2, 'objective');

// yaw 0 faces -z, yaw PI faces +z
export const SPAWNS = {
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

export const MAP = {
  name: 'Dockside House',
  boxes,
  barriers,
  objective: OBJECTIVE,
  spawns: SPAWNS,
};
