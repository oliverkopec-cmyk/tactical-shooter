// Tools for building a map. Every solid thing is an axis-aligned box; the client
// renders them and the server and client both collide against them. Units are
// metres, +y is up. A map file creates a kit, adds boxes with it, and returns
// the finished map with kit.finish().

import { HATCH } from './constants.js';

export function createMapKit({ T = 0.3 } = {}) {
  const boxes = [];
  const openings = [];   // every door and window gap in a wall (barricades go here)
  const hatches = [];    // square breakable covers in floors and roofs (each is also a 'hatch' box)
  const ropes = [];      // rope anchors: where players can rappel (see shared/movement.js)
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
    const push = (a, b, py0, py1) => {
      if (b - a < 1e-3 || py1 - py0 < 1e-3) return;
      const piece = axis === 'x'
        ? box(a, py0, fixed - T / 2, b, py1, fixed + T / 2, kind)
        : box(fixed - T / 2, py0, a, fixed + T / 2, py1, b, kind);
      piece.wallAxis = axis;
      piece.wallName = name;
      pieces.push(piece);
    };
    // Carve slice by slice so openings stacked on different floors (same running range) don't fill each other in
    const cuts = [...new Set([from, to, ...sorted.flatMap((op) => [op.from, op.to])])].filter((c) => c >= from && c <= to).sort((a, b) => a - b);
    for (let i = 0; i + 1 < cuts.length; i++) {
      const a = cuts[i], b = cuts[i + 1], mid = (a + b) / 2;
      let low = y0;
      for (const op of sorted.filter((q) => q.from < mid && q.to > mid).sort((p, q) => p.y0 - q.y0)) {
        push(a, b, low, op.y0);
        low = Math.max(low, op.y1);
      }
      push(a, b, low, y1);
    }
    for (const op of sorted) {
      openings.push({
        id: openings.length, axis, fixed, from: op.from, to: op.to, y0: op.y0, y1: op.y1,
        exterior: kind === 'exterior', window: !!op.window, name,
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
  const win = (from, to, base = 0) => ({ from, to, y0: base + 1.0, y1: base + 2.2, window: true });

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

  /** A floor or roof slab with rectangular holes ([x0, z0, x1, z1]) cut out of it. */
  function slab(y0, y1, x0, z0, x1, z1, holes = [], kind = 'floor') {
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
    for (const [a0, b0, a1, b1] of rects) box(a0, y0, b0, a1, y1, b1, kind);
  }

  /** The hole rectangle of a hatch centred at (cx, cz). */
  const hatchHole = (cx, cz, size = HATCH.size) => [cx - size / 2, cz - size / 2, cx + size / 2, cz + size / 2];

  /** A breakable hatch cover filling a hole in a slab (y0 to y1 is the slab's thickness). */
  function hatch(cx, cz, y0, y1, kind = 'floor', size = HATCH.size) {
    const [hx0, hz0, hx1, hz1] = hatchHole(cx, cz, size);
    const b = box(hx0, y0, hz0, hx1, y1, hz1, 'hatch');
    hatches.push({ boxId: b.id, x: cx, z: cz, y0, y1, size, on: kind });
    return b;
  }

  /**
   * A rope hanging down an outside wall from the roof edge. `axis` is the wall's running axis ('x' or 'z'),
   * `fixed` its coordinate, `along` where on the wall the rope hangs, `sign` which way is outside (+1 or -1).
   */
  function wallRope(axis, fixed, along, sign, top, range = 2.5, bottom = 0) {
    const out = fixed + sign * T / 2;
    const r = axis === 'x'
      ? { x: along, z: out, nx: 0, nz: sign, tx: 1, tz: 0, exit: [0, -sign * 1.0] }
      : { x: out, z: along, nx: sign, nz: 0, tx: 0, tz: 1, exit: [-sign * 1.0, 0] };
    ropes.push({ kind: 'wall', wallAxis: axis, wallFixed: fixed, top, bottom, range, ...r });
  }

  /** A rope hanging down through an open roof hatch (dropped into the room below, which has its floor at `bottom`). */
  function hatchRope(hatchBox, x, z, top, bottom, exit = [0, 1.2]) {
    ropes.push({ kind: 'hatch', hatchBox: hatchBox.id, x, z, nx: 0, nz: 0, tx: 0, tz: 0, range: 0, top, bottom, exit });
  }

  return { T, box, wall, door, win, stairs, prop, detail, slab, hatch, hatchHole, wallRope, hatchRope, boxes, openings, barriers, details, hatches, ropes };
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
