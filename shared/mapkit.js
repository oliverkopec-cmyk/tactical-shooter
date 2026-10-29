// Tools for building a map. Every solid thing is an axis-aligned box; the client
// renders them and the server and client both collide against them. Units are
// metres, +y is up. A map file creates a kit, adds boxes with it, and returns
// the finished map with kit.finish().

export function createMapKit({ T = 0.3 } = {}) {
  const boxes = [];
  const openings = [];   // every door and window gap in a wall (barricades go here)
  const barriers = [];   // invisible plugs in exterior openings; only defenders in prep collide with them
  const details = [];    // visual only (rugs, pictures, monitors, plants, car windows)
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
   * Each solid piece becomes its own box; 'interior' pieces become destructible panel grids.
   */
  function wall(axis, fixed, from, to, y0, y1, kind, ops = [], name = '') {
    const sorted = [...ops].sort((a, b) => a.from - b.from);
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
    for (const op of sorted) {
      push(cursor, op.from, y0, y1);
      push(op.from, op.to, y0, op.y0);   // below the opening (window sill)
      push(op.from, op.to, op.y1, y1);   // above the opening (lintel)
      cursor = op.to;
    }
    push(cursor, to, y0, y1);
    for (const op of sorted) {
      openings.push({
        id: openings.length, axis, fixed, from: op.from, to: op.to, y0: op.y0, y1: op.y1,
        exterior: kind === 'exterior', name,
      });
    }
    if (kind === 'exterior') {
      for (const op of sorted) {
        const [bx0, bz0, bx1, bz1] = axis === 'x'
          ? [op.from, fixed - T / 2, op.to, fixed + T / 2]
          : [fixed - T / 2, op.from, fixed + T / 2, op.to];
        barriers.push({ id: -(barriers.length + 1), kind: 'barrier', min: [bx0, op.y0, bz0], max: [bx1, op.y1, bz1] });
      }
    }
    return pieces;
  }

  const door = (from, to, base = 0) => ({ from, to, y0: base, y1: base + 2.4 });
  const win = (from, to, base = 0) => ({ from, to, y0: base + 1.0, y1: base + 2.2 });

  /**
   * Stairs: solid steps filled down to `base`. dir +1 rises towards +axis starting at `start`,
   * dir -1 rises towards -axis (start is then the high-numbered end).
   */
  function stairs(axis, start, a0, a1, base, steps, rise, run, dir = 1) {
    for (let i = 0; i < steps; i++) {
      const s0 = start + dir * i * run, s1 = s0 + dir * run, top = base + (i + 1) * rise;
      if (axis === 'x') box(s0, base, a0, s1, top, a1, 'stairs');
      else box(a0, base, s0, a1, top, s1, 'stairs');
    }
  }

  /** Centred solid prop. */
  function prop(kind, cx, cz, w, d, h, color, base = 0) {
    return box(cx - w / 2, base, cz - d / 2, cx + w / 2, base + h, cz + d / 2, kind, { color });
  }
  /** Visual-only box (no collision). */
  function detail(cx, cy, cz, w, h, d, color, emissive = false) {
    details.push({ min: [cx - w / 2, cy - h / 2, cz - d / 2], max: [cx + w / 2, cy + h / 2, cz + d / 2], color, emissive });
  }

  return { T, box, wall, door, win, stairs, prop, detail, boxes, openings, barriers, details };
}

/**
 * The door/window opening a ray passes through within `reach`, or null.
 * Used by the server to place barricades and by the client for the aim prompt.
 */
export function findOpening(map, origin, dir, reach) {
  let best = null;
  for (const o of map.openings) {
    const [n, a, di, da] = o.axis === 'x' ? [2, 0, dir[2], dir[0]] : [0, 2, dir[0], dir[2]];
    if (Math.abs(di) < 1e-6) continue;
    const t = (o.fixed - origin[n]) / di;
    if (t <= 0 || t > reach || (best && t >= best.t)) continue;
    const along = origin[a] + da * t, y = origin[1] + dir[1] * t;
    if (along >= o.from - 0.05 && along <= o.to + 0.05 && y >= o.y0 - 0.05 && y <= o.y1 + 0.05) best = { o, t };
  }
  return best ? best.o : null;
}
