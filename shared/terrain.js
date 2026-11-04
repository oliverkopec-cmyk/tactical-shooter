// Terrain for the detailed maps (Stage 2L): hills, slopes and paths. The ground is one smooth surface, not boxes:
// people, drones, bots, bullets and grenades all use the same triangles the client draws, so you stand on what you see
// and a hill never has an invisible step. Maps without terrain don't use any of this.
//
//   createTerrain({ half, height(x, z) }) where height is the map's own shape (use the helpers below)
//   t.top(x, z)      the ground's height at a point (what props and spawns stand on), same as t.surface
//   t.rayHit(o, d, maxT)  where a ray first comes down through the ground
//   t.vertex(i, j)   the grid heights the client draws

export const TERRAIN_CELL = 2;     // metres
const FLOOR_Y = -8;                // only the size of the box reported for a ground hit
const RAY_STEP = 0.5;              // metres between samples along a ray

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
  const centre = (i) => -half + (i + 0.5) * TERRAIN_CELL;
  const grid = new Float32Array(n * n);
  let highest = -Infinity;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { const h = height(centre(i), centre(j)); grid[i * n + j] = h; highest = Math.max(highest, h); }
  const at = (i, j) => grid[i * n + j];

  // Which triangle a point is in, split the way the client draws each grid square (corner a to corner c)
  const locate = (x, z) => {
    const fx = Math.max(0, Math.min(n - 1 - 1e-6, (x + half) / TERRAIN_CELL - 0.5));
    const fz = Math.max(0, Math.min(n - 1 - 1e-6, (z + half) / TERRAIN_CELL - 0.5));
    const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j;
    const a = at(i, j), c = at(i + 1, j + 1);
    return u >= v
      ? { a, dx: at(i + 1, j) - a, dz: c - at(i + 1, j), u, v }
      : { a, dx: c - at(i, j + 1), dz: at(i, j + 1) - a, u, v };
  };
  const surface = (x, z) => { const t = locate(x, z); return t.a + t.dx * t.u + t.dz * t.v; };
  const normalAt = (x, z) => {
    const t = locate(x, z), sx = t.dx / TERRAIN_CELL, sz = t.dz / TERRAIN_CELL, len = Math.hypot(sx, 1, sz);
    return [-sx / len, 1 / len, -sz / len];
  };
  const box = { id: -2, kind: 'ground', min: [-half, FLOOR_Y, -half], max: [half, highest, half] };   // what a ray says it hit

  return {
    half, n, cell: TERRAIN_CELL, centre, box, surface, normalAt,
    vertex: at,
    top: surface,
    /** The steepest slope anywhere, in degrees (for checking a map). */
    steepest() {
      let worst = 0;
      for (let i = 0; i + 1 < n; i++) for (let j = 0; j + 1 < n; j++) worst = Math.max(worst, Math.abs(at(i, j) - at(i + 1, j)), Math.abs(at(i, j) - at(i, j + 1)));
      return Math.atan(worst / TERRAIN_CELL) * 180 / Math.PI;
    },
    /** The first place a ray comes down through the ground: its distance, or null. A ray starting underneath passes up through it. */
    rayHit(o, d, maxT) {
      // Only the part of the ray at or below the highest ground needs testing
      let t0 = 0, t1 = maxT;
      if (o[1] > highest) { if (d[1] >= 0) return null; t0 = (highest - o[1]) / d[1]; if (t0 > maxT) return null; }
      else if (d[1] > 0) t1 = Math.min(maxT, (highest - o[1]) / d[1]);
      const gap = (t) => o[1] + d[1] * t - surface(o[0] + d[0] * t, o[2] + d[2] * t);
      const flat = Math.hypot(d[0], d[2]);
      const step = flat > 1e-3 ? RAY_STEP / flat : t1 - t0;
      let a = t0, ga = gap(a);
      while (a < t1) {
        const b = Math.min(t1, a + step), gb = gap(b);
        if (ga >= 0 && gb < 0) {
          let lo = a, hi = b;
          for (let k = 0; k < 12; k++) { const mid = (lo + hi) / 2; if (gap(mid) >= 0) lo = mid; else hi = mid; }
          return hi;
        }
        a = b; ga = gb;
      }
      return null;
    },
  };
}
