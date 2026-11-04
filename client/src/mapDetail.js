// Draws a detailed map (Stage 2L). Everything visible is static, so it is merged: one mesh per texture, with the
// colour of each shape in its vertices and texture coordinates in metres, so a map of thousands of shapes costs a
// couple of dozen draw calls. Hidden collision boxes aren't drawn; the ground is a smooth surface through the
// terrain's heights (shared/terrain.js), with paths laid over it. Destructible walls are DestructionView's.

import * as THREE from 'three';
import { getWallLayout } from '../../shared/world.js';
import { mapTexture, TEX_SCALE } from './mapTextures.js';
import { quality } from './graphics.js';

// Faces of a unit box: [normal, u axis, v axis]
const FACES = [
  [[1, 0, 0], [0, 0, -1], [0, 1, 0]], [[-1, 0, 0], [0, 0, 1], [0, 1, 0]],
  [[0, 1, 0], [1, 0, 0], [0, 0, -1]], [[0, -1, 0], [1, 0, 0], [0, 0, 1]],
  [[0, 0, 1], [1, 0, 0], [0, 1, 0]], [[0, 0, -1], [-1, 0, 0], [0, 1, 0]],
];

const color = new THREE.Color();

/** All the triangles sharing one material. */
class Batch {
  constructor() { this.pos = []; this.norm = []; this.uv = []; this.col = []; this.idx = []; this.count = 0; }

  quad(a, b, c, d, n, uvs, rgb) {
    const i = this.count;
    for (const p of [a, b, c, d]) this.pos.push(p[0], p[1], p[2]);
    for (let k = 0; k < 4; k++) { this.norm.push(n[0], n[1], n[2]); this.col.push(rgb[0], rgb[1], rgb[2]); }
    for (const t of uvs) this.uv.push(t[0], t[1]);
    this.idx.push(i, i + 1, i + 2, i, i + 2, i + 3);
    this.count += 4;
  }

  /** Copy a transformed BufferGeometry in (cylinders, spheres, cones). */
  geometry(geo, matrix, rgb, uvScale) {
    const p = geo.attributes.position, n = geo.attributes.normal, t = geo.attributes.uv;
    const base = this.count, v = new THREE.Vector3(), nm = new THREE.Matrix3().getNormalMatrix(matrix);
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(matrix);
      this.pos.push(v.x, v.y, v.z);
      v.fromBufferAttribute(n, i).applyMatrix3(nm).normalize();
      this.norm.push(v.x, v.y, v.z);
      this.uv.push(t.getX(i) * uvScale[0], t.getY(i) * uvScale[1]);
      this.col.push(rgb[0], rgb[1], rgb[2]);
    }
    const idx = geo.index;
    if (idx) for (let i = 0; i < idx.count; i++) this.idx.push(base + idx.getX(i));
    else for (let i = 0; i < p.count; i++) this.idx.push(base + i);
    this.count += p.count;
  }

  build(material, { castShadow = true } = {}) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.norm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.count > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    const mesh = new THREE.Mesh(g, material);
    mesh.castShadow = castShadow;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    return mesh;
  }
}

// The small shared shapes, unit-sized (a cylinder and cone 1 across and 1 high, a sphere 1 across)
const SHAPES = {
  cyl: (fine) => new THREE.CylinderGeometry(0.5, 0.5, 1, fine ? 8 : 12),
  cone: (fine) => new THREE.ConeGeometry(0.5, 1, fine ? 7 : 10),
  sph: (fine) => new THREE.SphereGeometry(0.5, fine ? 7 : 10, fine ? 5 : 7),
};
const AXIS_ROT = { x: new THREE.Euler(0, 0, Math.PI / 2), z: new THREE.Euler(Math.PI / 2, 0, 0), y: new THREE.Euler() };

const ROUGH = { metal: 0.45, paint: 0.3, glass: 0.15, tiles: 0.45, leaf: 0.95, grass: 1, dirt: 1, brick: 0.95, stone: 0.95, carpet: 1, fabric: 0.95, shingle: 0.9 };
const METAL = { metal: 0.6, paint: 0.25, glass: 0.4 };

export function buildDetailedMap(group, map) {
  const q = quality(), low = q.effects === 'low', texSize = low ? 128 : 256;
  const batches = new Map();
  const batchFor = (tex, glow) => {
    const key = `${tex || ''}|${glow ? 'g' : ''}`;
    if (!batches.has(key)) batches.set(key, { batch: new Batch(), tex, glow });
    return batches.get(key).batch;
  };
  const rgb = (hex, m = 1) => { color.setHex(hex); return [color.r * m, color.g * m, color.b * m]; };

  /** An axis-aligned box's faces. `look(faceIndex)` gives { tex, color } per face, or one look for all. */
  function addBox(min, max, look) {
    for (let f = 0; f < 6; f++) {
      const L = typeof look === 'function' ? look(f) : look;
      if (!L) continue;
      const [n, u, v] = FACES[f];
      const c = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2], h = [(max[0] - min[0]) / 2, (max[1] - min[1]) / 2, (max[2] - min[2]) / 2];
      const corner = (su, sv) => [0, 1, 2].map((i) => c[i] + n[i] * h[i] + su * u[i] * h[i] + sv * v[i] * h[i]);
      const pts = [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)];
      const s = L.tex ? 1 / (TEX_SCALE[L.tex] || 1) : 1;
      const uvs = pts.map((p) => [(p[0] * u[0] + p[1] * u[1] + p[2] * u[2]) * s, (p[0] * v[0] + p[1] * v[1] + p[2] * v[2]) * s]);
      batchFor(L.tex, L.glow).quad(pts[0], pts[1], pts[2], pts[3], n, uvs, rgb(L.color ?? 0xffffff, L.glow ? 1.5 : L.boost ?? 1));
    }
  }

  // ---- the solid boxes that show (walls, floors, stairs...), by kind
  const S = map.style;
  const centre = map.building[0];
  const cx = (centre.x0 + centre.x1) / 2, cz = (centre.z0 + centre.z1) / 2;
  const KIND = {
    rail: { tex: 'metal', color: 0x3b3f45 }, site: { tex: 'metal', color: 0x3d434b },
  };
  for (const b of getWallLayout(map).staticBoxes) {
    if (b.hidden) continue;
    if (b.kind === 'exterior') {
      // Outside walls: one finish outside, another inside
      const inside = S.exterior.in, outside = S.exterior.out, mx = (b.min[0] + b.max[0]) / 2, mz = (b.min[2] + b.max[2]) / 2;
      addBox(b.min, b.max, (f) => {
        const [n] = FACES[f];
        if (n[1]) return outside;
        return n[0] * (cx - mx) + n[2] * (cz - mz) > 0 ? inside : outside;
      });
    } else if (b.kind === 'floor' || b.kind === 'roof') {
      const st = S[b.kind];
      addBox(b.min, b.max, (f) => (FACES[f][0][1] === -1 ? { tex: 'plaster', color: st.under, boost: 1.9 } : { tex: st.tex, color: st.color }));   // ceilings get little direct light: they're brightened
    } else if (b.kind === 'stairs') addBox(b.min, b.max, S.stairs);
    else if (b.kind === 'hardwall') addBox(b.min, b.max, b.color ? { tex: 'brick', color: b.color } : S.hardwall);
    else if (KIND[b.kind] !== undefined) { if (KIND[b.kind]) addBox(b.min, b.max, KIND[b.kind]); }
    else addBox(b.min, b.max, { tex: 'concrete', color: b.color ?? 0x9a9a98 });
  }

  // ---- round the edge of the map: a tall hedge along the boundary
  if (map.terrain) {
    const h = map.size, top = 5;
    for (const [x, z, w, d] of [[0, -h + 0.5, h * 2, 1.4], [0, h - 0.5, h * 2, 1.4], [-h + 0.5, 0, 1.4, h * 2], [h - 0.5, 0, 1.4, h * 2]]) {
      addBox([x - w / 2, -8, z - d / 2], [x + w / 2, top + (map.terrain.top(x, z) > 2 ? 3 : 0), z + d / 2], { tex: 'leaf', color: 0x3f6a38 });
    }
  }

  // ---- the visual parts
  const dummy = new THREE.Object3D();
  const unit = { fine: {}, full: {} };
  for (const p of map.parts || []) {
    if (p.fine && low) continue;
    const look = { tex: p.tex || null, color: p.color ?? 0xffffff, glow: p.glow };
    if ((p.shape || 'box') === 'box' && !p.rot) {
      addBox([p.c[0] - p.d[0] / 2, p.c[1] - p.d[1] / 2, p.c[2] - p.d[2] / 2], [p.c[0] + p.d[0] / 2, p.c[1] + p.d[1] / 2, p.c[2] + p.d[2] / 2], look);
      continue;
    }
    const shape = p.shape && p.shape !== 'box' ? p.shape : 'box';
    const set = low || p.fine ? unit.fine : unit.full;
    const geo = shape === 'box' ? (set.box ||= new THREE.BoxGeometry(1, 1, 1)) : (set[shape] ||= SHAPES[shape](low || p.fine));
    dummy.position.set(p.c[0], p.c[1], p.c[2]);
    if (p.rot) dummy.rotation.set(p.rot[0], p.rot[1], p.rot[2]); else dummy.rotation.copy(AXIS_ROT[p.axis || 'y']);
    // A lying cylinder is built upright and turned: its length is its "height"
    if (p.axis === 'x') dummy.scale.set(p.d[1], p.d[0], p.d[2]);
    else if (p.axis === 'z') dummy.scale.set(p.d[0], p.d[2], p.d[1]);
    else dummy.scale.set(p.d[0], p.d[1], p.d[2]);
    dummy.updateMatrix();
    const scale = 1 / (TEX_SCALE[p.tex] || 1), around = Math.PI * Math.max(p.d[0], p.d[2]);
    batchFor(p.tex || null, p.glow).geometry(geo, dummy.matrix, rgb(look.color, p.glow ? 1.5 : 1), [around * scale, p.d[1] * scale]);
  }

  // ---- the ground: a smooth surface through the terrain's heights
  if (map.terrain) addGround(group, map, texSize);

  // ---- one mesh per texture
  for (const { batch, tex, glow } of batches.values()) {
    if (!batch.count) continue;
    const opts = { vertexColors: true, roughness: ROUGH[tex] ?? 0.8, metalness: METAL[tex] ?? 0.02 };
    if (tex) opts.map = mapTexture(tex, texSize);
    if (glow) { opts.emissive = 0xffffff; opts.emissiveIntensity = 0.55; opts.emissiveMap = null; }
    const mat = new THREE.MeshStandardMaterial(opts);
    if (glow) mat.onBeforeCompile = (shader) => {    // a glowing part glows in its own colour
      shader.fragmentShader = shader.fragmentShader.replace('vec3 totalEmissiveRadiance = emissive;', 'vec3 totalEmissiveRadiance = emissive * vColor.rgb;');
    };
    group.add(batch.build(mat));
  }
  for (const set of [unit.fine, unit.full]) for (const g of Object.values(set)) g.dispose();
}

/** Grass over the terrain, with slightly varied colour, and the paths laid on top. */
function addGround(group, map, texSize) {
  const t = map.terrain, n = t.n;
  const scale = 1 / TEX_SCALE.grass;
  const y = (i, j) => t.at(Math.max(0, Math.min(n - 1, i)), Math.max(0, Math.min(n - 1, j)));
  // Smooth the steps a little for drawing: each point is the average of itself and its neighbours
  const heightAt = (i, j) => (y(i, j) * 4 + y(i - 1, j) + y(i + 1, j) + y(i, j - 1) + y(i, j + 1)) / 8;
  const pos = new Float32Array(n * n * 3), norm = new Float32Array(n * n * 3), uv = new Float32Array(n * n * 2), col = new Float32Array(n * n * 3);
  const base = new THREE.Color(map.style.grass ?? 0x6f8f55);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const k = (i * n + j), x = t.centre(i), z = t.centre(j);
      pos[k * 3] = x; pos[k * 3 + 1] = heightAt(i, j); pos[k * 3 + 2] = z;
      const nx = heightAt(i - 1, j) - heightAt(i + 1, j), nz = heightAt(i, j - 1) - heightAt(i, j + 1), ny = t.cell * 2, len = Math.hypot(nx, ny, nz);
      norm[k * 3] = nx / len; norm[k * 3 + 1] = ny / len; norm[k * 3 + 2] = nz / len;
      uv[k * 2] = x * scale; uv[k * 2 + 1] = z * scale;
      const v = 0.86 + 0.2 * (Math.sin(x * 0.21) * Math.cos(z * 0.17) * 0.5 + 0.5);
      col[k * 3] = base.r * v; col[k * 3 + 1] = base.g * v; col[k * 3 + 2] = base.b * v;
    }
  }
  const idx = [];
  for (let i = 0; i + 1 < n; i++) for (let j = 0; j + 1 < n; j++) {
    const a = i * n + j, b = (i + 1) * n + j, c = (i + 1) * n + j + 1, d = i * n + j + 1;
    idx.push(a, d, c, a, c, b);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(norm, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(idx);
  const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: mapTexture('grass', texSize), vertexColors: true, roughness: 1 }));
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  group.add(mesh);

  // Paths: strips that follow the surface, a little above it
  const surfaceAt = (x, z) => {
    const fx = (x + t.half) / t.cell - 0.5, fz = (z + t.half) / t.cell - 0.5, i = Math.floor(fx), j = Math.floor(fz), a = fx - i, b = fz - j;
    return (heightAt(i, j) * (1 - a) + heightAt(i + 1, j) * a) * (1 - b) + (heightAt(i, j + 1) * (1 - a) + heightAt(i + 1, j + 1) * a) * b;
  };
  const strips = new Map();
  for (const r of map.ribbons || []) {
    if (!strips.has(r.tex)) strips.set(r.tex, new Batch());
    const batch = strips.get(r.tex), rgbv = (() => { color.setHex(r.color ?? 0xffffff); return [color.r, color.g, color.b]; })();
    const s = 1 / (TEX_SCALE[r.tex] || 3);
    // Walk the line in 1 m steps
    const line = [];
    for (let i = 0; i + 1 < r.pts.length; i++) {
      const [ax, az] = r.pts[i], [bx, bz] = r.pts[i + 1], len = Math.hypot(bx - ax, bz - az), steps = Math.max(1, Math.ceil(len));
      for (let k = 0; k < steps; k++) line.push([ax + ((bx - ax) * k) / steps, az + ((bz - az) * k) / steps]);
    }
    line.push(r.pts.at(-1));
    let along = 0;
    for (let i = 0; i + 1 < line.length; i++) {
      const dir = (k) => {
        const a = line[Math.max(0, k - 1)], b = line[Math.min(line.length - 1, k + 1)], dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1;
        return [-dz / l, dx / l];
      };
      const n0 = dir(i), n1 = dir(i + 1), step = Math.hypot(line[i + 1][0] - line[i][0], line[i + 1][1] - line[i][1]), parts = 4;
      for (let p = 0; p < parts; p++) {
        const u0 = (p / parts - 0.5) * r.width, u1 = ((p + 1) / parts - 0.5) * r.width;
        const P = (l, n, u) => { const x = l[0] + n[0] * u, z = l[1] + n[1] * u; return [x, surfaceAt(x, z) + 0.07, z]; };
        batch.quad(P(line[i], n0, u0), P(line[i], n0, u1), P(line[i + 1], n1, u1), P(line[i + 1], n1, u0), [0, 1, 0],
          [[u0 * s, along * s], [u1 * s, along * s], [u1 * s, (along + step) * s], [u0 * s, (along + step) * s]], rgbv);
      }
      along += step;
    }
  }
  for (const [tex, batch] of strips) {
    const mat = new THREE.MeshStandardMaterial({ map: mapTexture(tex, texSize), vertexColors: true, roughness: 1, side: THREE.DoubleSide });
    const m = batch.build(mat, { castShadow: false });
    group.add(m);
  }
}
