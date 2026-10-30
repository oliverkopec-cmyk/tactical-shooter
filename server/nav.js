// Navigation for bots: a walkable grid built once per map (shared by every room on that map), and
// distance fields ("which way is closer to X") computed on demand and cached.
//
// The grid is a flood fill from the spawn points with the same collision rules the game uses (a 0.5 m
// step, small ledges climbed, short drops allowed), so anywhere a node exists a player can stand. Building
// it is spread over many short slices so the server never freezes; bots wait until it is ready.
// Memory: typed arrays, a few MB for the big hotel map.

import { World } from '../shared/world.js';
import { STEP_HEIGHT } from '../shared/constants.js';

const STEP = 0.5, H = 1.8, R = 0.33, CELL = 2;
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
const MAX_NODES = 220000;

const grids = new Map();     // map id -> NavGrid

export function navFor(map) {
  if (!grids.has(map.id)) grids.set(map.id, new NavGrid(map));
  return grids.get(map.id);
}

class NavGrid {
  constructor(map) {
    this.map = map;
    this.ready = false;
    this.x = new Float32Array(MAX_NODES); this.y = new Float32Array(MAX_NODES); this.z = new Float32Array(MAX_NODES);
    this.adj = new Int32Array(MAX_NODES * 8).fill(-1);
    this.count = 0;
    this.index = new Map();          // packed cell key -> node
    this.fields = new Map();         // target key -> Int32Array of distances (a few cached)
    this.build();
  }

  key(x, y, z) {
    return ((Math.round(x / STEP) + 2048) * 4096 + (Math.round(z / STEP) + 2048)) * 256 + Math.max(0, Math.min(255, Math.round(y * 5) + 20));
  }

  // ---------------------------------------------------------------- collision (bucketed, for speed)

  bucketize(boxes) {
    this.buckets = new Map();
    for (const b of boxes) {
      for (let cx = Math.floor(b.min[0] / CELL); cx <= Math.floor(b.max[0] / CELL); cx++) {
        for (let cz = Math.floor(b.min[2] / CELL); cz <= Math.floor(b.max[2] / CELL); cz++) {
          const k = cx * 100000 + cz;
          if (!this.buckets.has(k)) this.buckets.set(k, []);
          this.buckets.get(k).push(b);
        }
      }
    }
  }

  near(x, z) {
    return this.buckets.get(Math.floor(x / CELL) * 100000 + Math.floor(z / CELL)) || [];
  }

  free(x, y, z, h = H) {
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      for (const b of this.near(x + dx * R, z + dz * R)) {
        if (b.max[0] > x - R && b.min[0] < x + R && b.max[2] > z - R && b.min[2] < z + R && b.max[1] > y + 1e-3 && b.min[1] < y + h - 1e-3) return false;
      }
    }
    return true;
  }

  /** The highest surface under (x, z) between y - dist and y, or -Infinity. */
  floorBelow(x, y, z, dist) {
    let best = -Infinity;
    for (const b of this.near(x, z)) {
      if (b.max[0] > x - R && b.min[0] < x + R && b.max[2] > z - R && b.min[2] < z + R && b.max[1] <= y + 1e-3 && b.max[1] >= y - dist) best = Math.max(best, b.max[1]);
    }
    return best;
  }

  // ---------------------------------------------------------------- building (in slices)

  build() {
    const world = new World(this.map);
    this.bucketize(world.boxes);
    const starts = [...this.map.spawns.attack, ...this.map.spawns.defense, ...this.map.siteSpawns.flat()];
    this.queue = [];
    for (const s of starts) this.add(s.x, s.y, s.z);
    this.limit = (this.map.size || 46) - 2;
    const slice = () => {
      const until = Date.now() + 8;                 // ~8 ms of work at a time
      while (this.queue.length && Date.now() < until) this.expand(this.queue.pop());
      if (this.queue.length && this.count < MAX_NODES) setImmediate(slice);
      else { this.queue = null; this.buckets = null; this.reverse(); this.ready = true; }
    };
    setImmediate(slice);
  }

  add(x, y, z) {
    const k = this.key(x, y, z);
    if (this.index.has(k)) return this.index.get(k);
    if (this.count >= MAX_NODES) return -1;
    const i = this.count++;
    this.x[i] = x; this.y[i] = y; this.z[i] = z;
    this.index.set(k, i);
    this.queue.push(i);
    return i;
  }

  expand(i) {
    const x = this.x[i], y = this.y[i], z = this.z[i];
    DIRS.forEach(([dx, dz], d) => {
      const nx = x + dx * STEP, nz = z + dz * STEP;
      if (Math.abs(nx) > this.limit || Math.abs(nz) > this.limit) return;
      if (!this.free(nx, y + STEP_HEIGHT, nz)) return;
      const down = this.floorBelow(nx, y + STEP_HEIGHT, nz, STEP_HEIGHT + 0.5);
      if (down === -Infinity || down < y - 0.5) return;
      if (!this.free(nx, down, nz)) return;
      if (dx && dz && (!this.free(x + dx * STEP, Math.max(y, down), z, H) || !this.free(x, Math.max(y, down), z + dz * STEP, H))) return;   // no corner cutting
      const j = this.add(nx, down, nz);
      if (j >= 0) { this.adj[i * 8 + d] = j; }
    });
  }

  // ---------------------------------------------------------------- queries

  /** The node nearest to a position (within about a metre), or -1. */
  nearest(x, y, z) {
    let best = -1, bd = Infinity;
    const cx = Math.round(x / STEP), cz = Math.round(z / STEP);
    for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
      for (let dy = -4; dy <= 4; dy++) {
        const k = ((cx + dx + 2048) * 4096 + (cz + dz + 2048)) * 256 + Math.max(0, Math.min(255, Math.round(y * 5) + 20 + dy));
        const i = this.index.get(k);
        if (i === undefined) continue;
        const d = Math.hypot(this.x[i] - x, (this.y[i] - y) * 2, this.z[i] - z);
        if (d < bd) { bd = d; best = i; }
      }
    }
    return best;
  }

  /** Distances (in steps) from every node to the nearest of `targets` (node ids). Cached by key. */
  field(key, targets) {
    if (this.fields.has(key)) return this.fields.get(key);
    if (typeof targets === 'function') targets = targets();   // worked out only when not cached
    const dist = new Int32Array(this.count).fill(-1);
    const q = new Int32Array(this.count);
    let head = 0, tail = 0;
    for (const t of targets) if (t >= 0 && dist[t] < 0) { dist[t] = 0; q[tail++] = t; }
    while (head < tail) {
      const j = q[head++];
      for (const i of this.rev[j]) if (dist[i] < 0) { dist[i] = dist[j] + 1; q[tail++] = i; }
    }
    if (this.fields.size > 24) this.fields.delete(this.fields.keys().next().value);   // keep only a few
    this.fields.set(key, dist);
    return dist;
  }

  /** Edges followed backwards (drops only go one way), built once when the grid is done. */
  reverse() {
    this.rev = Array.from({ length: this.count }, () => []);
    for (let i = 0; i < this.count; i++) for (let d = 0; d < 8; d++) { const j = this.adj[i * 8 + d]; if (j >= 0) this.rev[j].push(i); }
  }

  /** Nodes within `r` metres of a point (same floor, roughly). */
  around(x, y, z, r) {
    const out = [];
    for (let dx = -r; dx <= r; dx += STEP) for (let dz = -r; dz <= r; dz += STEP) {
      if (dx * dx + dz * dz > r * r) continue;
      const i = this.nearest(x + dx, y, z + dz);
      if (i >= 0 && Math.abs(this.y[i] - y) < 1.2) out.push(i);
    }
    return out;
  }

  /**
   * The next point to walk to from node `i` towards the field's targets: a few steps ahead along
   * the downhill path, so the walk is smooth. Returns null when there is no way (or already there).
   */
  next(i, dist, ahead = 3) {
    if (i < 0 || dist[i] <= 0) return null;
    let cur = i;
    for (let s = 0; s < ahead; s++) {
      let best = -1;
      for (let d = 0; d < 8; d++) {
        const j = this.adj[cur * 8 + d];
        if (j >= 0 && dist[j] >= 0 && dist[j] < dist[cur] && (best < 0 || dist[j] < dist[best])) best = j;
      }
      if (best < 0) break;
      cur = best;
      if (dist[cur] === 0) break;
    }
    return cur === i ? null : { x: this.x[cur], y: this.y[cur], z: this.z[cur], node: cur };
  }
}
