// Terrain for the detailed maps (Stage 2L): hills, slopes and paths. Everything solid in the game is a box, so the
// ground you collide with is a grid of columns whose tops go up in small steps (at most a walkable step between
// neighbours on anything meant to be walked), merged into as few boxes as possible. On top of that the client draws
// a smooth surface through the same heights, so it looks like a hillside and walks like one.
//
//   createTerrain({ half, height(x, z) }) where height is the map's own shape (use the helpers below)
//   t.top(x, z)      the ground's height at a point (what props and spawns stand on)
//   t.addColliders(kit)
//   t.samples()      the grid heights the client draws

export const TERRAIN_CELL = 2;     // metres
export const TERRAIN_STEP = 0.2;   // heights are multiples of this
const FLOOR_Y = -8;                // the bottom of the ground columns

export const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
export const lerp = (a, b, t) => a + (b - a) * t;

/** Distance from a point to a polyline, and the interpolated value `v` (3rd number of each point) at the nearest spot. */
export function nearestOnPath(pts, x, z) {
  let best = Infinity, val = pts[0][2];
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, az, av] = pts[i], [bx, bz, bv] = pts[i + 1];
    const dx = bx - ax, dz = bz - az, len2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / len2));
    const d = Math.hypot(x - (ax + dx * t), z - (az + dz * t));
    if (d < best) { best = d; val = av + (bv - av) * t; }
  }
  return { d: best, v: val };
}

/** Distance from a point to a rectangle (0 inside). */
export const rectDistance = (r, x, z) => Math.hypot(Math.max(r.x0 - x, 0, x - r.x1), Math.max(r.z0 - z, 0, z - r.z1));

/**
 * The usual recipe: start from `shape(x, z)`, carve each path into it (the path keeps its own heights, blending into
 * the land over `blend` metres), then level each flat area (with its own blend). Later things win over earlier ones.
 */
export function shapedHeight({ shape, paths = [], flats = [] }) {
  return (x, z) => {
    let h = shape(x, z);
    for (const p of paths) {
      const { d, v } = nearestOnPath(p.pts, x, z);
      h = lerp(v, h, smooth(p.width / 2, p.width / 2 + p.blend, d));
    }
    for (const f of flats) h = lerp(f.y, h, smooth(0, f.blend, rectDistance(f, x, z)));
    return h;
  };
}

export function createTerrain({ half, height }) {
  const n = Math.ceil((half * 2) / TERRAIN_CELL);
  const cellOf = (v) => Math.max(0, Math.min(n - 1, Math.floor((v + half) / TERRAIN_CELL)));
  const centre = (i) => -half + (i + 0.5) * TERRAIN_CELL;
  // The quantised height of every cell
  const grid = new Float32Array(n * n);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) grid[i * n + j] = Math.round(height(centre(i), centre(j)) / TERRAIN_STEP) * TERRAIN_STEP;
  const at = (i, j) => grid[i * n + j];

  return {
    half, n, cell: TERRAIN_CELL, centre, at,
    top: (x, z) => at(cellOf(x), cellOf(z)),
    /** Whether the terrain is walkable between neighbouring cells here (for checking a map). */
    steepest() {
      let worst = 0;
      for (let i = 0; i + 1 < n; i++) for (let j = 0; j + 1 < n; j++) worst = Math.max(worst, Math.abs(at(i, j) - at(i + 1, j)), Math.abs(at(i, j) - at(i, j + 1)));
      return worst;
    },
    /** One box per merged rectangle of cells with the same height. */
    addColliders(kit) {
      const done = new Uint8Array(n * n);
      let count = 0;
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          if (done[i * n + j]) continue;
          const y = at(i, j);
          let dj = 1;
          while (j + dj < n && !done[i * n + j + dj] && at(i, j + dj) === y) dj++;
          let di = 1;
          outer: while (i + di < n) {
            for (let k = 0; k < dj; k++) if (done[(i + di) * n + j + k] || at(i + di, j + k) !== y) break outer;
            di++;
          }
          for (let a = 0; a < di; a++) for (let b = 0; b < dj; b++) done[(i + a) * n + j + b] = 1;
          kit.box(-half + i * TERRAIN_CELL, FLOOR_Y, -half + j * TERRAIN_CELL, -half + (i + di) * TERRAIN_CELL, y, -half + (j + dj) * TERRAIN_CELL, 'ground', { hidden: true });
          count++;
        }
      }
      return count;
    },
  };
}
