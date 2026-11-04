// The detail library for detailed maps (Stage 2L): furniture, wall decorations, outdoor things and vehicles, each
// built from many small shapes. What you collide with stays one simple box per object (`solid`, drawn by nothing);
// everything you see is visual-only parts, merged into a few draw calls by client/src/mapDetail.js. Parts marked
// `fine` (book spines, knobs, keyboards...) are dropped on Low graphics.
//
// Furniture is placed with place(x, z, rot, base): its local +z is the way it faces (its back goes against a wall),
// rot is quarter turns: 0 faces +z, 1 faces +x, 2 faces -z, 3 faces -x.

import { TERRAIN_CELL } from '../terrain.js';

const WOOD = { oak: 0xa87a4a, walnut: 0x5e3f28, pine: 0xc9a06a, white: 0xe6e2da, black: 0x24252a };

export function createFurnisher(kit) {
  const { part, box, T } = kit;

  /** A local frame: turns local positions and sizes into world ones. */
  function place(x, z, rot = 0, base = 0) {
    const r = ((rot % 4) + 4) % 4;
    const wx = (lx, lz) => (r === 0 ? x + lx : r === 1 ? x + lz : r === 2 ? x - lx : x - lz);
    const wz = (lx, lz) => (r === 0 ? z + lz : r === 1 ? z - lx : r === 2 ? z - lz : z + lx);
    const swap = r % 2 === 1;
    const P = {
      toWorld: (lx, lz) => [wx(lx, lz), wz(lx, lz)],
      /** A box part: centred on (lx, lz), standing `ly` above the base. */
      box(lx, ly, lz, w, h, d, color, tex, opts = {}) {
        part([wx(lx, lz), base + ly + h / 2, wz(lx, lz)], [swap ? d : w, h, swap ? w : d], { color, tex, ...opts });
      },
      /** An upright cylinder part. */
      cyl(lx, ly, lz, rad, h, color, tex, opts = {}) {
        part([wx(lx, lz), base + ly + h / 2, wz(lx, lz)], [rad * 2, h, rad * 2], { color, tex, shape: 'cyl', ...opts });
      },
      /** A cylinder lying along the local z axis (a log pointing out of a fireplace). */
      lying(lx, ly, lz, rad, len, color, tex, opts = {}) {
        part([wx(lx, lz), base + ly, wz(lx, lz)], swap ? [len, rad * 2, rad * 2] : [rad * 2, rad * 2, len], { color, tex, shape: 'cyl', axis: swap ? 'x' : 'z', ...opts });
      },
      /** A cylinder lying along the local x axis (a wheel on its axle). */
      lyingX(lx, ly, lz, rad, len, color, tex, opts = {}) {
        part([wx(lx, lz), base + ly, wz(lx, lz)], swap ? [rad * 2, rad * 2, len] : [len, rad * 2, rad * 2], { color, tex, shape: 'cyl', axis: swap ? 'z' : 'x', ...opts });
      },
      sph(lx, ly, lz, sx, sy, sz, color, tex, opts = {}) {
        part([wx(lx, lz), base + ly, wz(lx, lz)], [swap ? sz : sx, sy, swap ? sx : sz], { color, tex, shape: 'sph', ...opts });
      },
      /** What you collide with: one box, seen by nothing. */
      solid(lx, lz, w, d, h, kind = 'furniture', ly = 0) {
        const cx = wx(lx, lz), cz = wz(lx, lz), hw = (swap ? d : w) / 2, hd = (swap ? w : d) / 2;
        return box(cx - hw, base + ly, cz - hd, cx + hw, base + ly + h, cz + hd, kind, { hidden: true });
      },
    };
    return P;
  }

  // ---------------------------------------------------------------- living room

  function couch(x, z, rot, base, { color = 0x5e6f8c, len = 2.2, legs = WOOD.walnut } = {}) {
    const P = place(x, z, rot, base);
    P.solid(0, 0, len, 0.95, 0.82);
    const seat = (len - 0.44) / 3;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) P.cyl(sx * (len / 2 - 0.1), 0, sz * 0.37, 0.035, 0.12, legs, 'wood', { fine: true });
    P.box(0, 0.12, 0, len, 0.2, 0.92, color, 'fabric');                                   // base
    for (const sx of [-1, 1]) P.box(sx * (len / 2 - 0.11), 0.12, 0, 0.22, 0.5, 0.92, color, 'fabric');   // armrests
    P.box(0, 0.12, -0.36, len - 0.3, 0.72, 0.2, color, 'fabric');                         // back
    for (let i = -1; i <= 1; i++) {
      P.box(i * seat, 0.32, 0.07, seat - 0.03, 0.15, 0.74, color + 0x0a0a0a, 'fabric');   // seat cushions
      P.box(i * seat, 0.47, -0.2, seat - 0.05, 0.36, 0.16, color + 0x101010, 'fabric', { rot: [0, 0, 0] });   // back cushions
    }
    P.box(-len / 2 + 0.42, 0.47, 0.04, 0.34, 0.26, 0.1, 0xd8b24a, 'fabric', { fine: true });   // a throw pillow
  }

  function armchair(x, z, rot, base, { color = 0x7a4a3a } = {}) {
    const P = place(x, z, rot, base);
    P.solid(0, 0, 0.95, 0.9, 0.82);
    P.box(0, 0.1, 0, 0.92, 0.22, 0.88, color, 'fabric');
    for (const sx of [-1, 1]) P.box(sx * 0.37, 0.1, 0, 0.18, 0.52, 0.88, color, 'fabric');
    P.box(0, 0.1, -0.34, 0.92, 0.72, 0.2, color, 'fabric');
    P.box(0, 0.32, 0.08, 0.56, 0.14, 0.68, color + 0x101010, 'fabric');
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) P.cyl(sx * 0.38, 0, sz * 0.36, 0.03, 0.1, WOOD.walnut, 'wood', { fine: true });
  }

  function coffeeTable(x, z, rot, base, { wood = WOOD.oak, w = 1.2, d = 0.65 } = {}) {
    const P = place(x, z, rot, base);
    P.solid(0, 0, w, d, 0.42);
    P.box(0, 0.36, 0, w, 0.06, d, wood, 'wood');
    P.box(0, 0.14, 0, w - 0.14, 0.03, d - 0.14, wood, 'wood', { fine: true });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) P.box(sx * (w / 2 - 0.06), 0, sz * (d / 2 - 0.06), 0.06, 0.36, 0.06, wood - 0x101010, 'wood');
    P.box(0.2, 0.42, 0.05, 0.28, 0.03, 0.2, 0xa83a3a, 'fabric', { fine: true });          // a book or two
    P.box(0.22, 0.45, 0.06, 0.24, 0.025, 0.18, 0x3a6aa8, 'fabric', { fine: true });
  }

  function rug(x, z, w, d, base, color = 0x7a2f2f, border = 0xd8c8a0) {
    part([x, base + 0.012, z], [w, 0.024, d], { color: border, tex: 'carpet' });
    part([x, base + 0.016, z], [w - 0.3, 0.026, d - 0.3], { color, tex: 'carpet' });
  }

  function tvStand(x, z, rot, base) {
    const P = place(x, z, rot, base);
    P.solid(0, 0, 1.8, 0.5, 0.55);
    P.box(0, 0, 0, 1.8, 0.5, 0.48, WOOD.walnut, 'wood');
    for (const sx of [-0.6, 0, 0.6]) P.box(sx, 0.08, 0.245, 0.55, 0.34, 0.01, WOOD.walnut + 0x101010, 'wood', { fine: true });
    P.box(0, 0.5, -0.05, 0.4, 0.03, 0.2, 0x15161a, null);
    P.box(0, 0.53, -0.05, 0.06, 0.1, 0.05, 0x15161a, null);
    P.box(0, 0.6, -0.05, 1.3, 0.75, 0.05, 0x101114, null);
    P.box(0, 0.63, -0.02, 1.22, 0.69, 0.005, 0x223044, null, { glow: 0.5 });
  }

  function floorLamp(x, z, base) {
    const P = place(x, z, 0, base);
    P.solid(0, 0, 0.3, 0.3, 1.6);
    P.cyl(0, 0, 0, 0.16, 0.03, 0x2a2c30, 'metal');
    P.cyl(0, 0.03, 0, 0.018, 1.45, 0x2a2c30, 'metal');
    part([x, base + 1.58, z], [0.42, 0.32, 0.42], { color: 0xffe7b8, shape: 'cone', glow: 0.9 });
  }

  /** A lamp to stand on a table: local height `ly` above the base. */
  function tableLamp(P, lx, ly, lz) {
    P.cyl(lx, ly, lz, 0.07, 0.03, 0xa88a4a, 'metal', { fine: true });
    P.cyl(lx, ly + 0.03, lz, 0.015, 0.2, 0xa88a4a, 'metal', { fine: true });
    P.cyl(lx, ly + 0.2, lz, 0.1, 0.16, 0xffe7b8, null, { glow: 0.8 });
  }

  function plant(x, z, base, { big = false } = {}) {
    const P = place(x, z, 0, base);
    const s = big ? 1.5 : 1;
    P.solid(0, 0, 0.4 * s, 0.4 * s, 0.5 * s);
    P.cyl(0, 0, 0, 0.17 * s, 0.32 * s, 0xb0603a, 'plaster');
    P.cyl(0, 0.3 * s, 0, 0.15 * s, 0.03, 0x3a2a1a, null);
    P.sph(0, 0.65 * s, 0, 0.5 * s, 0.55 * s, 0.5 * s, 0x3f7a3a, 'leaf');
    P.sph(0.12 * s, 0.9 * s, 0.05 * s, 0.34 * s, 0.4 * s, 0.34 * s, 0x4f8a42, 'leaf', { fine: true });
  }

  // ---------------------------------------------------------------- dining and kitchen

  function chair(x, z, rot, base, wood = WOOD.oak, seat = 0xb0a080) {
    const P = place(x, z, rot, base);
    P.solid(0, 0, 0.42, 0.42, 0.46);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) P.box(sx * 0.18, 0, sz * 0.18, 0.04, 0.44, 0.04, wood, 'wood');
    P.box(0, 0.44, 0, 0.42, 0.04, 0.42, wood, 'wood');
    P.box(0, 0.48, 0, 0.38, 0.03, 0.38, seat, 'fabric', { fine: true });
    for (const sx of [-1, 1]) P.box(sx * 0.18, 0.48, -0.19, 0.04, 0.42, 0.03, wood, 'wood');
    P.box(0, 0.78, -0.19, 0.38, 0.12, 0.03, wood, 'wood');
  }

  /** A table with legs and `seats` chairs (2, 4 or 6) round it. */
  function diningSet(x, z, rot, base, { seats = 6, wood = WOOD.oak, seat = 0xb0a080, w = 2.2, d = 1.0 } = {}) {
    const P = place(x, z, rot, base);
    P.solid(0, 0, w, d, 0.76);
    P.box(0, 0.7, 0, w, 0.06, d, wood, 'wood');
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) P.box(sx * (w / 2 - 0.08), 0, sz * (d / 2 - 0.08), 0.08, 0.7, 0.08, wood - 0x101010, 'wood');
    P.cyl(0, 0.76, 0, 0.12, 0.14, 0xe8e4dc, null, { fine: true });                       // a vase
    P.sph(0, 0.98, 0, 0.2, 0.2, 0.2, 0xc84a5a, 'leaf', { fine: true });
    const n = Math.floor(seats / 2);
    for (let i = 0; i < n; i++) {
      const lx = (i - (n - 1) / 2) * (w / Math.max(n, 1));
      const [ax, az] = P.toWorld(lx, d / 2 + 0.34), [bx, bz] = P.toWorld(lx, -d / 2 - 0.34);
      chair(ax, az, rot + 2, base, wood, seat);
      chair(bx, bz, rot, base, wood, seat);
    }
  }

  /** A run of base and wall cupboards along a wall, with a worktop, tiled backsplash, sink and/or stove. */
  function kitchenRun(x, z, rot, base, len, { sink = true, stove = true, wood = WOOD.white, top = 0x3a3d42 } = {}) {
    const P = place(x, z, rot, base);
    P.solid(0, 0, len, 0.65, 0.92);
    P.box(0, 0, 0, len, 0.86, 0.62, wood, 'wood');
    P.box(0, 0.86, 0.01, len + 0.02, 0.05, 0.66, top, 'stone');
    P.box(0, 0.91, -0.31, len, 0.55, 0.02, 0xdce6ea, 'tiles');                          // backsplash
    const doors = Math.max(2, Math.round(len / 0.6));
    for (let i = 0; i < doors; i++) {
      const lx = (i + 0.5) * (len / doors) - len / 2;
      P.box(lx, 0.06, 0.315, len / doors - 0.03, 0.74, 0.012, wood - 0x0a0a0a, 'wood', { fine: true });
      P.box(lx, 0.68, 0.325, 0.12, 0.012, 0.012, 0x8a8d92, 'metal', { fine: true });
      P.box(lx, 1.5, -0.14, len / doors - 0.03, 0.7, 0.34, wood, 'wood');                // wall cupboards
      P.box(lx, 1.53, 0.035, len / doors - 0.07, 0.64, 0.012, wood - 0x0a0a0a, 'wood', { fine: true });
    }
    if (sink) {
      const sx = -len / 4;
      P.box(sx, 0.905, 0.02, 0.62, 0.012, 0.42, 0xb8bcc2, 'metal');
      P.box(sx, 0.88, 0.02, 0.5, 0.04, 0.32, 0x7a7e84, 'metal', { fine: true });
      P.cyl(sx, 0.91, -0.2, 0.015, 0.22, 0xb8bcc2, 'metal', { fine: true });
      P.box(sx, 1.12, -0.12, 0.02, 0.02, 0.16, 0xb8bcc2, 'metal', { fine: true });
    }
    if (stove) {
      const sx = len / 4;
      P.box(sx, 0, 0.005, 0.62, 0.9, 0.64, 0x8d9096, 'metal');
      P.box(sx, 0.14, 0.325, 0.5, 0.42, 0.012, 0x24262a, null, { fine: true });           // oven door
      P.box(sx, 0.6, 0.335, 0.46, 0.02, 0.02, 0xc8ccd2, 'metal', { fine: true });
      P.box(sx, 0.905, 0.01, 0.6, 0.012, 0.6, 0x1a1b1e, null);
      for (const a of [-0.15, 0.15]) for (const b of [-0.15, 0.15]) P.cyl(sx + a, 0.915, 0.01 + b, 0.08, 0.01, 0x3a3c40, null, { fine: true });
      P.box(sx, 1.5, -0.14, 0.7, 0.2, 0.42, 0x8d9096, 'metal');                          // cooker hood
    }
  }

  function fridge(x, z, rot, base) {
    const P = place(x, z, rot, base);
    P.solid(0, 0, 0.8, 0.72, 1.9, 'appliance');
    P.box(0, 0, 0, 0.8, 1.9, 0.72, 0xc4c8cc, 'metal');
    P.box(0, 1.22, 0.365, 0.77, 0.008, 0.01, 0x55585c, null, { fine: true });
    for (const y of [0.85, 1.42]) P.box(-0.3, y, 0.385, 0.03, 0.3, 0.03, 0x70747a, 'metal', { fine: true });
  }

  /** An island or bar counter with stools along one side. */
  function counter(x, z, rot, base, { len = 2.4, wood = WOOD.walnut, top = 0x2a2c30, stools = 3 } = {}) {
    const P = place(x, z, rot, base);
    P.solid(0, 0, len, 0.75, 1.0);
    P.box(0, 0, 0, len, 0.94, 0.72, wood, 'wood');
    P.box(0, 0.94, 0, len + 0.08, 0.06, 0.82, top, 'stone');
    for (let i = 0; i < stools; i++) {
      const lx = (i + 0.5) * (len / stools) - len / 2;
      const [wx0, wz0] = P.toWorld(lx, 0.72);
      const S = place(wx0, wz0, rot, base);
      S.solid(0, 0, 0.32, 0.32, 0.7);
      S.cyl(0, 0, 0, 0.17, 0.02, 0x3a3c40, 'metal');
      S.cyl(0, 0.02, 0, 0.022, 0.62, 0x3a3c40, 'metal');
      S.cyl(0, 0.64, 0, 0.17, 0.07, 0x7a2f2f, 'fabric');
    }
  }

  // ---------------------------------------------------------------- bedroom and bath

  function bed(x, z, rot, base, { blanket = 0x4a6a8a, wide = true, wood = WOOD.walnut } = {}) {
    const P = place(x, z, rot, base);
    const w = wide ? 1.7 : 1.05, len = 2.1;
    P.solid(0, 0, w, len, 0.62);
    P.box(0, 0.08, 0, w, 0.24, len, wood, 'wood');
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) P.box(sx * (w / 2 - 0.05), 0, sz * (len / 2 - 0.05), 0.08, 0.1, 0.08, wood, 'wood', { fine: true });
    P.box(0, 0.32, 0, w - 0.06, 0.2, len - 0.06, 0xe8e4dc, 'fabric');                    // mattress
    P.box(0, 0.5, 0.2, w, 0.1, len - 0.5, blanket, 'fabric');                            // blanket
    P.box(0, 0.6, -0.42, w - 0.04, 0.03, 0.3, 0xf0ece4, 'fabric', { fine: true });       // the turned-back sheet
    P.box(0, 0.08, -len / 2 + 0.04, w + 0.06, 1.05, 0.08, wood, 'wood');                 // headboard
    const pillows = wide ? [-0.4, 0.4] : [0];
    for (const px of pillows) P.box(px, 0.52, -len / 2 + 0.34, wide ? 0.66 : 0.72, 0.13, 0.42, 0xf4f0e8, 'fabric');
    return P;
  }

  function nightstand(x, z, rot, base, wood = WOOD.walnut) {
    const P = place(x, z, rot, base);
    P.solid(0, 0, 0.5, 0.45, 0.56);
    P.box(0, 0, 0, 0.5, 0.56, 0.45, wood, 'wood');
    P.box(0, 0.32, 0.226, 0.44, 0.18, 0.01, wood + 0x0a0a0a, 'wood', { fine: true });
    P.box(0, 0.4, 0.236, 0.08, 0.015, 0.015, 0xb8a060, 'metal', { fine: true });
    tableLamp(P, 0, 0.56, 0);
  }

  function wardrobe(x, z, rot, base, wood = WOOD.walnut) {
    const P = place(x, z, rot, base);
    P.solid(0, 0, 1.3, 0.62, 2.1);
    P.box(0, 0, 0, 1.3, 2.1, 0.6, wood, 'wood');
    for (const sx of [-0.325, 0.325]) {
      P.box(sx, 0.08, 0.305, 0.62, 1.94, 0.015, wood + 0x0a0a0a, 'wood');
      P.box(sx * 0.12, 1.0, 0.32, 0.02, 0.2, 0.02, 0xb8a060, 'metal', { fine: true });
    }
  }

  function bathtub(x, z, rot, base) {
    const P = place(x, z, rot, base);
    P.solid(0, 0, 1.7, 0.8, 0.58);
    P.box(0, 0, 0, 1.7, 0.56, 0.8, 0xf0f0ec, 'tiles');
    P.box(0, 0.5, 0, 1.46, 0.08, 0.56, 0x9ac8d8, null);
    P.cyl(0.74, 0.56, 0, 0.018, 0.2, 0xb8bcc2, 'metal', { fine: true });
  }

  function toilet(x, z, rot, base) {
    const P = place(x, z, rot, base);
    P.solid(0, 0, 0.42, 0.68, 0.42);
    P.box(0, 0, -0.08, 0.3, 0.4, 0.42, 0xf4f4f0, null);
    P.sph(0, 0.4, 0.06, 0.4, 0.14, 0.5, 0xf4f4f0, null);
    P.box(0, 0.4, -0.26, 0.42, 0.42, 0.18, 0xf4f4f0, null);
  }

  function basin(x, z, rot, base) {
    const P = place(x, z, rot, base);
    P.solid(0, 0, 0.8, 0.5, 0.84);
    P.box(0, 0, 0, 0.8, 0.78, 0.48, WOOD.white, 'wood');
    P.box(0, 0.78, 0, 0.84, 0.05, 0.52, 0xe8e8e4, 'stone');
    P.cyl(0, 0.82, 0, 0.17, 0.02, 0xc8d4d8, null, { fine: true });
    P.cyl(0, 0.82, -0.18, 0.012, 0.16, 0xb8bcc2, 'metal', { fine: true });
    P.box(0, 1.1, -0.235, 0.7, 0.8, 0.02, 0xbcd4e0, 'metal');                            // mirror
  }

  // ---------------------------------------------------------------- offices and storage

  function desk(x, z, rot, base, { wood = WOOD.oak, computer = true, w = 1.6 } = {}) {
    const P = place(x, z, rot, base);
    P.solid(0, 0, w, 0.8, 0.76);
    P.box(0, 0.7, 0, w, 0.06, 0.8, wood, 'wood');
    for (const sx of [-1, 1]) P.box(sx * (w / 2 - 0.05), 0, 0, 0.06, 0.7, 0.74, wood - 0x101010, 'wood');
    P.box(w / 2 - 0.32, 0.08, 0, 0.5, 0.62, 0.72, wood - 0x101010, 'wood');
    for (const y of [0.12, 0.32, 0.52]) P.box(w / 2 - 0.32, y, 0.365, 0.46, 0.16, 0.012, wood, 'wood', { fine: true });
    if (computer) {
      P.box(-0.1, 0.76, -0.2, 0.18, 0.02, 0.14, 0x1a1b1e, null, { fine: true });
      P.box(-0.1, 0.78, -0.2, 0.05, 0.14, 0.04, 0x1a1b1e, null, { fine: true });
      P.box(-0.1, 0.9, -0.2, 0.6, 0.36, 0.03, 0x101114, null);
      P.box(-0.1, 0.92, -0.18, 0.56, 0.32, 0.005, 0x2a4a6a, null, { glow: 0.6 });
      P.box(-0.1, 0.76, 0.1, 0.44, 0.02, 0.14, 0x24262a, null, { fine: true });
      P.box(0.22, 0.76, 0.12, 0.07, 0.02, 0.1, 0x24262a, null, { fine: true });
    }
    const [cx, cz] = P.toWorld(-0.1, 0.72);
    officeChair(cx, cz, rot + 2, base);
  }

  function officeChair(x, z, rot, base) {
    const P = place(x, z, rot, base);
    P.solid(0, 0, 0.45, 0.45, 0.5);
    P.cyl(0, 0, 0, 0.26, 0.04, 0x1f2024, null);
    P.cyl(0, 0.04, 0, 0.03, 0.38, 0x3a3c40, 'metal');
    P.box(0, 0.42, 0, 0.46, 0.08, 0.44, 0x24262a, 'fabric');
    P.box(0, 0.5, -0.2, 0.42, 0.52, 0.06, 0x24262a, 'fabric');
  }

  /** A tall bookcase with shelves of books and a few things. */
  function bookshelf(x, z, rot, base, { wood = WOOD.walnut, w = 1.4 } = {}) {
    const P = place(x, z, rot, base);
    P.solid(0, 0, w, 0.36, 2.1);
    P.box(0, 0, -0.16, w, 2.1, 0.03, wood, 'wood');
    for (const sx of [-1, 1]) P.box(sx * (w / 2 - 0.02), 0, 0, 0.04, 2.1, 0.34, wood, 'wood');
    const colors = [0x8a2f2f, 0x2f4f7a, 0x3f6a3a, 0x7a6a2f, 0x5a3a6a, 0xc8b89a, 0x2a2a2e];
    let n = 7;
    const rnd = () => { n = (n * 37 + 11) % 101; return n / 101; };
    for (let row = 0; row < 5; row++) {
      const y = 0.04 + row * 0.42;
      P.box(0, y, 0, w - 0.06, 0.03, 0.34, wood, 'wood');
      let lx = -w / 2 + 0.08;
      while (lx < w / 2 - 0.16) {
        const t = 0.03 + rnd() * 0.04, h = 0.24 + rnd() * 0.1;
        if (rnd() < 0.12) { lx += 0.14; continue; }
        P.box(lx + t / 2, y + 0.03, 0.02, t, h, 0.22, colors[Math.floor(rnd() * colors.length)], null, { fine: true });
        lx += t + 0.004;
      }
    }
  }

  function filingCabinet(x, z, rot, base) {
    const P = place(x, z, rot, base);
    P.solid(0, 0, 0.5, 0.6, 1.35, 'appliance');
    P.box(0, 0, 0, 0.5, 1.35, 0.6, 0x7a7e84, 'metal');
    for (const y of [0.08, 0.5, 0.92]) {
      P.box(0, y, 0.305, 0.44, 0.36, 0.01, 0x8a8e94, 'metal', { fine: true });
      P.box(0, y + 0.26, 0.315, 0.14, 0.02, 0.02, 0x4a4c50, 'metal', { fine: true });
    }
  }

  function crateStack(x, z, base) {
    const P = place(x, z, 0, base);
    P.solid(0, 0, 1.0, 1.0, 1.0, 'crate');
    const c = 0x9a7448;
    P.box(0, 0, 0, 1, 1, 1, c, 'wood');
    for (const s of [-0.46, 0.46]) { P.box(s, 0, 0.505, 0.08, 1, 0.01, c - 0x141414, 'wood', { fine: true }); P.box(s, 0, -0.505, 0.08, 1, 0.01, c - 0x141414, 'wood', { fine: true }); }
    P.box(0, 0.46, 0.505, 1, 0.08, 0.01, c - 0x141414, 'wood', { fine: true });
    P.solid(0.08, -0.05, 0.6, 0.6, 0.6, 'crate', 1.0);
    P.box(0.08, 1.0, -0.05, 0.6, 0.6, 0.6, c + 0x0a0a0a, 'wood');
  }

  function fireplace(x, z, rot, base, { stone = 0x8a8680, h = 2.9 } = {}) {
    const P = place(x, z, rot, base);
    P.solid(0, 0, 2.2, 0.8, h, 'hardwall');
    P.box(0, 0, 0, 2.2, h, 0.8, stone, 'stone');
    P.box(0, 0, 0.3, 1.0, 0.9, 0.22, 0x141210, null);                                    // the opening
    P.box(0, 1.1, 0.42, 2.4, 0.12, 0.2, WOOD.walnut, 'wood');                            // mantel
    P.box(0, 0, 0.52, 2.4, 0.08, 0.5, stone - 0x141414, 'stone');
    for (const lx of [-0.2, 0, 0.2]) P.lying(lx, 0.14, 0.32, 0.05, 0.6, 0x4a3020, 'bark', { fine: true });
    P.box(0, 0.08, 0.32, 0.6, 0.3, 0.1, 0xff7a2a, null, { glow: 1.2 });
    P.cyl(-0.8, 1.22, 0.42, 0.05, 0.2, 0xc8b89a, null, { fine: true });
    P.cyl(0.8, 1.22, 0.42, 0.05, 0.2, 0x8a3a3a, null, { fine: true });
  }

  function poolTable(x, z, rot, base) {
    const P = place(x, z, rot, base);
    P.solid(0, 0, 2.5, 1.4, 0.82);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) P.box(sx * 1.05, 0, sz * 0.55, 0.16, 0.7, 0.16, WOOD.walnut, 'wood');
    P.box(0, 0.68, 0, 2.5, 0.14, 1.4, WOOD.walnut, 'wood');
    P.box(0, 0.8, 0, 2.3, 0.02, 1.2, 0x1f6a3f, 'fabric');
    const balls = [0xd83a3a, 0xf0c02a, 0x2a5ad8, 0xf4f4f0, 0x2a2a2a, 0xe0702a];
    balls.forEach((c, i) => P.sph(-0.4 + i * 0.12, 0.85, (i % 3) * 0.08 - 0.08, 0.06, 0.06, 0.06, c, null, { fine: true }));
  }

  // ---------------------------------------------------------------- on walls (hard walls only: a soft wall can be blown out)

  /** A frame on a wall: axis/fixed say which wall, side which way the room is (+1 or -1). */
  function onWall(axis, fixed, along, y, side) {
    const face = fixed + side * (T / 2);
    return (w, h, depth, offset, color, tex, opts = {}) => {
      const out = face + side * (offset + depth / 2);
      part(axis === 'x' ? [along, y, out] : [out, y, along], axis === 'x' ? [w, h, depth] : [depth, h, w], { color, tex, ...opts });
    };
  }

  const ART = [[0x2f5f8a, 0xd8a04a], [0x8a3a2f, 0xe8d8b8], [0x3a6a4a, 0xd8d0a0], [0x5a3a7a, 0xe0a0b0], [0x1f3a5a, 0xc8d8e8], [0xa86a2a, 0x2a3a4a]];
  let artIndex = 0;

  function painting(axis, fixed, along, y, side, { w = 1.1, h = 0.75 } = {}) {
    const f = onWall(axis, fixed, along, y, side), [a, b] = ART[artIndex++ % ART.length];
    f(w, h, 0.04, 0, 0x4a3420, 'wood');
    f(w - 0.1, h - 0.1, 0.01, 0.04, a, 'fabric');
    const g = onWall(axis, fixed, along + (artIndex % 2 ? 0.14 : -0.14) * w, y + 0.06, side);
    g(w * 0.34, h * 0.42, 0.006, 0.05, b, 'fabric');
  }

  function poster(axis, fixed, along, y, side) {
    const f = onWall(axis, fixed, along, y, side), [a, b] = ART[artIndex++ % ART.length];
    f(0.6, 0.85, 0.008, 0, a, null);
    onWall(axis, fixed, along, y + 0.2, side)(0.44, 0.24, 0.004, 0.008, b, null);
    onWall(axis, fixed, along, y - 0.24, side)(0.44, 0.05, 0.004, 0.008, 0xf0ece4, null, { fine: true });
    onWall(axis, fixed, along, y - 0.32, side)(0.3, 0.03, 0.004, 0.008, 0xf0ece4, null, { fine: true });
  }

  function clock(axis, fixed, along, y, side) {
    const out = fixed + side * (T / 2 + 0.025);
    const c = axis === 'x' ? [along, y, out] : [out, y, along];
    part(c, axis === 'x' ? [0.4, 0.4, 0.05] : [0.05, 0.4, 0.4], { color: 0x2a2c30, shape: 'cyl', axis: axis === 'x' ? 'z' : 'x' });
    const inner = fixed + side * (T / 2 + 0.052);
    part(axis === 'x' ? [along, y, inner] : [inner, y, along], axis === 'x' ? [0.34, 0.34, 0.006] : [0.006, 0.34, 0.34], { color: 0xf0ece4, shape: 'cyl', axis: axis === 'x' ? 'z' : 'x' });
    const hand = onWall(axis, fixed, along, y + 0.06, side);
    hand(0.015, 0.12, 0.004, 0.056, 0x141414, null, { fine: true });
    onWall(axis, fixed, along + 0.05, y, side)(0.1, 0.015, 0.004, 0.056, 0x141414, null, { fine: true });
  }

  function lightSwitch(axis, fixed, along, y, side) {
    const f = onWall(axis, fixed, along, y, side);
    f(0.08, 0.12, 0.012, 0, 0xf0ece4, null, { fine: true });
    f(0.02, 0.05, 0.01, 0.012, 0xd8d4cc, null, { fine: true });
  }

  /** A wall shelf with a few things on it. */
  function wallShelf(axis, fixed, along, y, side, { w = 1.2, wood = WOOD.oak } = {}) {
    onWall(axis, fixed, along, y, side)(w, 0.04, 0.22, 0, wood, 'wood');
    for (const [o, hgt, c] of [[-0.4, 0.2, 0x8a3a3a], [-0.3, 0.17, 0x3a5a8a], [-0.22, 0.22, 0x3a6a3a], [0.1, 0.14, 0xc8b89a], [0.38, 0.2, 0xa88a4a]]) {
      onWall(axis, fixed, along + o * w, y + 0.02 + hgt / 2, side)(0.07 * w, hgt, 0.14, 0.03, c, null, { fine: true });
    }
  }

  function ceilingLight(x, z, y) {
    part([x, y - 0.03, z], [0.5, 0.05, 0.5], { color: 0xfff4dc, shape: 'cyl', glow: 1 });
  }

  /** Frames for every exterior door and window and curtains inside each window; hard interior doors get frames too. */
  function dressOpenings(centre = [0, 0], { frame = 0xe8e4dc, curtain = 0xa85a4a, trim = 0x5a4632, curtains = {} } = {}) {
    for (const o of kit.openings) {
      const hardWall = kit.boxes.some((b) => b.kind === 'hardwall' && b.wallAxis === o.axis && Math.abs((o.axis === 'x' ? (b.min[2] + b.max[2]) / 2 : (b.min[0] + b.max[0]) / 2) - o.fixed) < 0.01);
      if (!o.exterior && !hardWall) continue;       // a soft wall's doorway is just the gap (the frame would float once the wall is gone)
      const col = o.window ? frame : trim, t = T + 0.06, b = 0.07;
      const add = (al, y, wAlong, h, deep = t) => part(o.axis === 'x' ? [al, y, o.fixed] : [o.fixed, y, al], o.axis === 'x' ? [wAlong, h, deep] : [deep, h, wAlong], { color: col, tex: 'wood' });
      add(o.from - b / 2 + 0.02, (o.y0 + o.y1) / 2, b, o.y1 - o.y0 + b);
      add(o.to + b / 2 - 0.02, (o.y0 + o.y1) / 2, b, o.y1 - o.y0 + b);
      add((o.from + o.to) / 2, o.y1 + b / 2 - 0.02, o.to - o.from + b * 2, b);
      if (!o.window) continue;
      add((o.from + o.to) / 2, o.y0 - 0.03, o.to - o.from + 0.24, 0.07, T + 0.2);        // the sill
      // Curtains on the inside, drawn back to each side, with a rail above
      const inward = o.axis === 'x' ? Math.sign(centre[1] - o.fixed) : Math.sign(centre[0] - o.fixed);
      const inner = o.fixed + inward * (T / 2 + 0.07);
      const cc = curtains[o.name] ?? curtain;
      const hang = o.y1 - o.y0 + 0.5;
      for (const al of [o.from - 0.06, o.to + 0.06]) {
        const yy = o.y1 + 0.06 - hang / 2;
        part(o.axis === 'x' ? [al, yy, inner] : [inner, yy, al], o.axis === 'x' ? [0.34, hang, 0.08] : [0.08, hang, 0.34], { color: cc, tex: 'fabric' });
      }
      part(o.axis === 'x' ? [(o.from + o.to) / 2, o.y1 + 0.1, inner] : [inner, o.y1 + 0.1, (o.from + o.to) / 2], o.axis === 'x' ? [o.to - o.from + 0.8, 0.03, 0.03] : [0.03, 0.03, o.to - o.from + 0.8], { color: 0x2a2c30, tex: 'metal', fine: true });
    }
  }

  // ---------------------------------------------------------------- outdoors

  function pine(x, z, base, s = 1) {
    const P = place(x, z, 0, base);
    box(x - 0.22, base - 0.5, z - 0.22, x + 0.22, base + 3.2 * s, z + 0.22, 'tree', { hidden: true });
    P.cyl(0, -0.3, 0, 0.2, 1.8 * s, 0x5a4230, 'bark');
    part([x, base + 2.3 * s, z], [3.2 * s, 2.6 * s, 3.2 * s], { color: 0x2f5a35, tex: 'leaf', shape: 'cone' });
    part([x, base + 3.6 * s, z], [2.5 * s, 2.3 * s, 2.5 * s], { color: 0x35653a, tex: 'leaf', shape: 'cone' });
    part([x, base + 4.8 * s, z], [1.7 * s, 2.0 * s, 1.7 * s], { color: 0x3c7040, tex: 'leaf', shape: 'cone' });
  }

  function tree(x, z, base, s = 1) {
    const P = place(x, z, 0, base);
    box(x - 0.22, base - 0.5, z - 0.22, x + 0.22, base + 2.6 * s, z + 0.22, 'tree', { hidden: true });
    P.cyl(0, -0.3, 0, 0.2 * s, 2.8 * s, 0x5e4630, 'bark');
    P.sph(0, 3.2 * s, 0, 3.0 * s, 2.6 * s, 3.0 * s, 0x47803a, 'leaf');
    P.sph(0.9 * s, 2.8 * s, 0.4 * s, 1.9 * s, 1.7 * s, 1.9 * s, 0x528a42, 'leaf');
    P.sph(-0.8 * s, 2.9 * s, -0.5 * s, 2.0 * s, 1.8 * s, 2.0 * s, 0x3f7835, 'leaf');
  }

  /** A bush: leaves only, you can walk into it (and hide in it). */
  function bush(x, z, base, s = 1) {
    const P = place(x, z, 0, base);
    P.sph(0, 0.42 * s, 0, 1.3 * s, 1.0 * s, 1.3 * s, 0x47803a, 'leaf');
    P.sph(0.35 * s, 0.34 * s, 0.2 * s, 0.9 * s, 0.75 * s, 0.9 * s, 0x528a42, 'leaf', { fine: true });
    P.sph(-0.3 * s, 0.32 * s, -0.25 * s, 0.85 * s, 0.7 * s, 0.85 * s, 0x3f7835, 'leaf', { fine: true });
  }

  /** A wooden fence along a line, following the ground (top(x, z) gives its height). */
  function fence(x0, z0, x1, z1, top, { color = 0xb09a78, h = 1.05 } = {}) {
    const len = Math.hypot(x1 - x0, z1 - z0), alongX = Math.abs(x1 - x0) > Math.abs(z1 - z0);
    const pieces = Math.max(1, Math.round(len / TERRAIN_CELL));
    for (let i = 0; i < pieces; i++) {
      const a = i / pieces, b = (i + 1) / pieces;
      const ax = x0 + (x1 - x0) * a, az = z0 + (z1 - z0) * a, bx = x0 + (x1 - x0) * b, bz = z0 + (z1 - z0) * b;
      const y = top((ax + bx) / 2, (az + bz) / 2);
      box(Math.min(ax, bx) - (alongX ? 0 : 0.05), y - 0.3, Math.min(az, bz) - (alongX ? 0.05 : 0), Math.max(ax, bx) + (alongX ? 0 : 0.05), y + h, Math.max(az, bz) + (alongX ? 0.05 : 0), 'fence', { hidden: true });
      const seg = Math.hypot(bx - ax, bz - az), cx = (ax + bx) / 2, cz = (az + bz) / 2;
      for (const ry of [0.35, 0.85]) part([cx, y + ry, cz], alongX ? [seg, 0.07, 0.03] : [0.03, 0.07, seg], { color: color - 0x101010, tex: 'wood' });
      const pickets = Math.round(seg / 0.2);
      for (let k = 0; k < pickets; k++) {
        const t = (k + 0.5) / pickets, px = ax + (bx - ax) * t, pz = az + (bz - az) * t;
        part([px, y + h / 2 - 0.1, pz], alongX ? [0.11, h + 0.2, 0.025] : [0.025, h + 0.2, 0.11], { color, tex: 'wood', fine: k % 2 === 1 });
      }
      part([ax, y + h / 2 - 0.1, az], [0.11, h + 0.3, 0.11], { color: color - 0x181818, tex: 'wood' });
    }
  }

  /** A low stone wall along a line, following the ground in steps. */
  function lowWall(x0, z0, x1, z1, top, { color = 0x9a958a, h = 0.95, tex = 'stone', w = 0.42 } = {}) {
    const len = Math.hypot(x1 - x0, z1 - z0), alongX = Math.abs(x1 - x0) > Math.abs(z1 - z0);
    const pieces = Math.max(1, Math.round(len / TERRAIN_CELL));
    for (let i = 0; i < pieces; i++) {
      const a = i / pieces, b = (i + 1) / pieces;
      const ax = x0 + (x1 - x0) * a, az = z0 + (z1 - z0) * a, bx = x0 + (x1 - x0) * b, bz = z0 + (z1 - z0) * b;
      const y = top((ax + bx) / 2, (az + bz) / 2);
      const hw = alongX ? 0 : w / 2, hd = alongX ? w / 2 : 0;
      box(Math.min(ax, bx) - hw, y - 0.3, Math.min(az, bz) - hd, Math.max(ax, bx) + hw, y + h, Math.max(az, bz) + hd, 'lowwall', { hidden: true });
      const cx = (ax + bx) / 2, cz = (az + bz) / 2, seg = Math.hypot(bx - ax, bz - az);
      part([cx, y + (h - 0.3) / 2, cz], alongX ? [seg + 0.02, h + 0.3, w] : [w, h + 0.3, seg + 0.02], { color, tex });
      part([cx, y + h + 0.03, cz], alongX ? [seg + 0.04, 0.07, w + 0.1] : [w + 0.1, 0.07, seg + 0.04], { color: color + 0x0a0a0a, tex: 'concrete' });
    }
  }

  /** Stone steps climbing along an axis, solid (walked up like stairs). dir: +1 rises towards +axis. */
  function steps(axis, start, a0, a1, base, count, rise, run, dir = 1, { color = 0x9a958a, tex = 'stone' } = {}) {
    for (let i = 0; i < count; i++) {
      const s0 = start + dir * i * run, s1 = s0 + dir * run, top = base + (i + 1) * rise;
      const [x0, x1, z0, z1] = axis === 'x' ? [s0, s1, a0, a1] : [a0, a1, s0, s1];
      box(x0, base - 0.5, z0, x1, top, z1, 'concrete', { hidden: true });
      part([(x0 + x1) / 2, top - 0.5 * (top - base + 0.5), (z0 + z1) / 2], [Math.abs(x1 - x0), top - base + 0.5, Math.abs(z1 - z0)], { color: color + ((i % 2) * 0x080808), tex });
    }
  }

  function lampPost(x, z, base) {
    const P = place(x, z, 0, base);
    box(x - 0.08, base, z - 0.08, x + 0.08, base + 3.4, z + 0.08, 'rail', { hidden: true });
    P.cyl(0, 0, 0, 0.1, 0.25, 0x24262a, 'metal');
    P.cyl(0, 0.2, 0, 0.05, 3.2, 0x24262a, 'metal');
    P.box(0, 3.35, 0, 0.3, 0.3, 0.3, 0xfff0c8, null, { glow: 0.9 });
    P.box(0, 3.65, 0, 0.42, 0.06, 0.42, 0x24262a, 'metal');
  }

  function bench(x, z, rot, base) {
    const P = place(x, z, rot, base);
    P.solid(0, 0, 1.8, 0.55, 0.48);
    for (const sx of [-0.75, 0.75]) { P.box(sx, 0, 0, 0.08, 0.42, 0.5, 0x2a2c30, 'metal'); P.box(sx, 0.42, -0.24, 0.08, 0.42, 0.05, 0x2a2c30, 'metal'); }
    for (const lz of [-0.14, 0, 0.14]) P.box(0, 0.42, lz, 1.8, 0.04, 0.12, WOOD.oak, 'wood');
    for (const ly of [0.58, 0.72]) P.box(0, ly, -0.25, 1.8, 0.1, 0.03, WOOD.oak, 'wood');
  }

  function planterBox(x, z, rot, base, { len = 2 } = {}) {
    const P = place(x, z, rot, base);
    P.solid(0, 0, len, 0.7, 0.6, 'planter');
    P.box(0, 0, 0, len, 0.55, 0.7, 0x6a5a48, 'wood');
    P.box(0, 0.5, 0, len - 0.1, 0.05, 0.6, 0x3a2a1a, null);
    for (let i = 0; i < Math.round(len / 0.5); i++) P.sph((i + 0.5) * 0.5 - len / 2, 0.68, 0, 0.5, 0.42, 0.5, i % 2 ? 0xc84a5a : 0x47803a, 'leaf', { fine: i % 2 === 1 });
  }

  function trashBin(x, z, base) {
    const P = place(x, z, 0, base);
    P.solid(0, 0, 0.6, 0.6, 1.0, 'barrel');
    P.cyl(0, 0, 0, 0.3, 0.95, 0x3a5a4a, 'metal');
    P.cyl(0, 0.95, 0, 0.32, 0.06, 0x24262a, 'metal');
  }

  // ---------------------------------------------------------------- vehicles (no real brands)

  /**
   * A parked vehicle, facing local +z. type: 'sedan' | 'suv' | 'van' | 'pickup'. Wheels, windows, lights, doors,
   * bumpers, mirrors, number plates; one or two collision boxes.
   */
  function vehicle(x, z, rot, base, { type = 'sedan', color = 0x8b2f2f } = {}) {
    const P = place(x, z, rot, base);
    const S = { sedan: { w: 1.8, len: 4.5, h: 0.72, cabH: 0.56, cabLen: 2.2, cabZ: -0.15 }, suv: { w: 1.95, len: 4.7, h: 0.86, cabH: 0.74, cabLen: 3.0, cabZ: -0.45 }, van: { w: 2.05, len: 5.4, h: 1.0, cabH: 1.15, cabLen: 4.4, cabZ: -0.4 }, pickup: { w: 1.95, len: 5.3, h: 0.9, cabH: 0.72, cabLen: 2.2, cabZ: 0.5 } }[type];
    const under = 0.28, bodyTop = under + S.h;
    P.solid(0, 0, S.w, S.len, bodyTop, 'car');
    P.solid(0, S.cabZ, S.w - 0.1, S.cabLen, S.cabH, 'car', bodyTop);
    // Body, sills and roof
    P.box(0, under, 0, S.w, S.h, S.len, color, 'paint');
    P.box(0, under - 0.1, 0, S.w - 0.04, 0.12, S.len - 0.1, 0x1a1b1e, null);
    const taper = type === 'van' ? 0.03 : 0.1;
    P.box(0, bodyTop, S.cabZ, S.w - taper * 2, S.cabH, S.cabLen, color, 'paint');
    P.box(0, bodyTop + S.cabH, S.cabZ, S.w - taper * 2 - 0.1, 0.04, S.cabLen - 0.25, color - 0x0a0a0a, 'paint');
    // Windows: windscreen, rear, and two or three along each side, split by pillars
    const glass = 0x1c2a36, gl = { glass: false };
    const front = S.cabZ + S.cabLen / 2, rear = S.cabZ - S.cabLen / 2;
    P.box(0, bodyTop + 0.06, front + 0.005, S.w - taper * 2 - 0.12, S.cabH - 0.12, 0.02, glass, 'glass', gl);
    P.box(0, bodyTop + 0.06, rear - 0.005, S.w - taper * 2 - 0.12, S.cabH - 0.12, 0.02, glass, 'glass', gl);
    const panes = type === 'sedan' || type === 'suv' ? 2 : type === 'van' ? 1 : 1;
    const paneLen = (type === 'van' ? 1.3 : (S.cabLen - 0.3) / panes);
    for (const sx of [-1, 1]) {
      const side = sx * (S.w / 2 - taper + 0.005);
      for (let i = 0; i < panes; i++) {
        const lz = type === 'van' ? front - 0.8 : rear + 0.15 + (i + 0.5) * paneLen;
        P.box(side, bodyTop + 0.08, lz, 0.02, S.cabH - 0.16, paneLen - 0.1, glass, 'glass', gl);
      }
    }
    // Doors: thin seams and handles
    const doorEdges = type === 'van' ? [front - 0.1, front - 1.5] : type === 'pickup' ? [front - 0.1, front - 1.2, rear + 0.1] : [front - 0.05, S.cabZ, rear + 0.1];
    for (const sx of [-1, 1]) {
      const side = sx * (S.w / 2 + 0.003);
      for (const ez of doorEdges) P.box(side, under + 0.08, ez, 0.006, S.h - 0.1, 0.02, 0x141518, null, { fine: true });
      for (let i = 0; i + 1 < doorEdges.length; i++) P.box(side, under + S.h - 0.24, doorEdges[i] - 0.22, 0.012, 0.03, 0.14, 0x8a8e94, 'metal', { fine: true });
      P.box(sx * (S.w / 2 + 0.07), bodyTop + 0.02, front - 0.1, 0.14, 0.09, 0.05, color - 0x101010, 'paint', { fine: true });   // mirror
    }
    // Wheels
    for (const sx of [-1, 1]) for (const lz of [S.len / 2 - 0.85, -S.len / 2 + 0.85]) {
      P.lyingX(sx * (S.w / 2 - 0.09), 0.34, lz, 0.34, 0.24, 0x16171a, null);
      P.lyingX(sx * (S.w / 2 + 0.03), 0.34, lz, 0.2, 0.02, 0xa8acb2, 'metal', { fine: true });
      P.box(sx * (S.w / 2 - 0.02), 0.62, lz, 0.05, 0.08, 0.86, 0x121316, null, { fine: true });   // wheel arch
    }
    // Lights, bumpers, grille and plates
    const fz = S.len / 2, rz = -S.len / 2;
    P.box(0, under + 0.02, fz + 0.02, S.w, 0.2, 0.08, 0x24262a, null);
    P.box(0, under + 0.02, rz - 0.02, S.w, 0.2, 0.08, 0x24262a, null);
    for (const sx of [-1, 1]) {
      P.box(sx * (S.w / 2 - 0.28), under + S.h * 0.55, fz + 0.008, 0.38, 0.14, 0.02, 0xfff4c8, null, { glow: 0.6 });
      P.box(sx * (S.w / 2 - 0.24), under + S.h * 0.55, rz - 0.008, 0.34, 0.14, 0.02, 0xc81a1a, null, { glow: 0.5 });
    }
    P.box(0, under + S.h * 0.45, fz + 0.008, S.w * 0.36, S.h * 0.3, 0.015, 0x101114, null, { fine: true });
    P.box(0, under + 0.08, fz + 0.066, 0.44, 0.11, 0.008, 0xf0ece4, null, { fine: true });
    P.box(0, under + 0.08, rz - 0.066, 0.44, 0.11, 0.008, 0xf0ece4, null, { fine: true });
    if (type === 'pickup') {
      P.box(0, bodyTop - 0.005, rear - (S.len / 2 + rear) / 2 - 0.4, S.w - 0.25, 0.012, S.len / 2 + rear - 0.8, 0x121316, null);   // the open bed
    }
    if (type === 'van') P.box(S.w / 2 + 0.005, under + S.h * 0.5, 0, 0.01, 0.5, 1.8, 0xe0a030, null, { fine: true });   // a stripe down the side
  }

  return {
    place, couch, armchair, coffeeTable, rug, tvStand, floorLamp, plant, chair, diningSet, kitchenRun, fridge, counter, bed, nightstand, wardrobe,
    bathtub, toilet, basin, desk, officeChair, bookshelf, filingCabinet, crateStack, fireplace, poolTable, painting, poster, clock, lightSwitch, wallShelf,
    ceilingLight, dressOpenings, pine, tree, bush, fence, lowWall, steps, lampPost, bench, planterBox, trashBin, vehicle, WOOD,
  };
}
