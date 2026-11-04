// Textures drawn in code for the detailed maps (Stage 2L): no image files. Each is a small tile that repeats, in
// greys and soft colour so a part's own colour tints it. Sizes in metres say how much of the world one tile covers.

import * as THREE from 'three';

function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a * 1664525 + 1013904223) >>> 0; return a / 4294967296; };
}

const DRAW = {
  // Long grain lines and a few knots
  wood(g, S, r) {
    g.fillStyle = '#cfcfcf'; g.fillRect(0, 0, S, S);
    for (let i = 0; i < S / 2; i++) {
      const y = r() * S, shade = 150 + r() * 95;
      g.strokeStyle = `rgba(${shade},${shade},${shade},${0.25 + r() * 0.35})`;
      g.lineWidth = 0.5 + r() * 1.6;
      g.beginPath(); g.moveTo(0, y);
      g.bezierCurveTo(S * 0.3, y + r() * 5 - 2.5, S * 0.7, y + r() * 5 - 2.5, S, y);
      g.stroke();
    }
    for (let i = 0; i < 4; i++) { g.strokeStyle = 'rgba(0,0,0,0.3)'; g.lineWidth = 1; g.strokeRect(-2, Math.floor((i * S) / 4), S + 4, 0.01); }
    g.fillStyle = 'rgba(0,0,0,0.25)';
    for (let i = 0; i < 2; i++) { g.beginPath(); g.ellipse(r() * S, r() * S, 3 + r() * 4, 2 + r() * 2, 0, 0, Math.PI * 2); g.fill(); }
  },
  // A woven cross-hatch
  fabric(g, S, r) {
    g.fillStyle = '#d4d4d4'; g.fillRect(0, 0, S, S);
    for (let x = 0; x < S; x += 2) for (let y = 0; y < S; y += 2) {
      const v = 190 + r() * 60 + (((x + y) / 2) % 2) * 15;
      g.fillStyle = `rgb(${v},${v},${v})`;
      g.fillRect(x, y, 2, 2);
    }
  },
  // Speckled, short-pile
  carpet(g, S, r) {
    g.fillStyle = '#cccccc'; g.fillRect(0, 0, S, S);
    for (let i = 0; i < S * S * 0.5; i++) {
      const v = 150 + r() * 105;
      g.fillStyle = `rgba(${v},${v},${v},0.55)`;
      g.fillRect(r() * S, r() * S, 1.5, 1.5);
    }
  },
  // Square tiles with grout
  tiles(g, S) {
    g.fillStyle = '#7f7f7f'; g.fillRect(0, 0, S, S);
    const n = 4, c = S / n;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const v = 228 + ((i * 7 + j * 11) % 5) * 5;
      g.fillStyle = `rgb(${v},${v},${v})`;
      g.fillRect(i * c + 1, j * c + 1, c - 2, c - 2);
    }
  },
  // Bricks in running bond with pale mortar
  brick(g, S, r) {
    g.fillStyle = '#efe8dc'; g.fillRect(0, 0, S, S);
    const rows = 8, bh = S / rows, bw = S / 4;
    for (let row = 0; row < rows; row++) for (let i = -1; i < 5; i++) {
      const v = 165 + r() * 75;
      g.fillStyle = `rgb(${v},${v - 6},${v - 10})`;
      g.fillRect(i * bw + (row % 2) * (bw / 2) + 1, row * bh + 1, bw - 2, bh - 2);
    }
  },
  // Rough stone blocks
  stone(g, S, r) {
    g.fillStyle = '#6f6f6f'; g.fillRect(0, 0, S, S);
    let y = 0;
    while (y < S) {
      const h = S / 6 + r() * (S / 8);
      let x = -r() * S * 0.2;
      while (x < S) {
        const w = S / 5 + r() * (S / 4), v = 170 + r() * 70;
        g.fillStyle = `rgb(${v},${v},${v - 4})`;
        g.fillRect(x + 1.5, y + 1.5, w - 3, h - 3);
        x += w;
      }
      y += h;
    }
  },
  // Flat paint with a light uneven trowel
  plaster(g, S, r) {
    g.fillStyle = '#e8e8e8'; g.fillRect(0, 0, S, S);
    for (let i = 0; i < 90; i++) {
      const v = 205 + r() * 50;
      g.fillStyle = `rgba(${v},${v},${v},0.3)`;
      g.beginPath(); g.ellipse(r() * S, r() * S, 4 + r() * 14, 2 + r() * 8, r() * 3, 0, Math.PI * 2); g.fill();
    }
  },
  // A smooth pale panel with a seam round it: soft walls, which you can see are in sections
  drywall(g, S, r) {
    g.fillStyle = '#f6f6f4'; g.fillRect(0, 0, S, S);
    for (let i = 0; i < 40; i++) { const v = 228 + r() * 25; g.fillStyle = `rgba(${v},${v},${v},0.35)`; g.fillRect(r() * S, r() * S, 8 + r() * 30, 2 + r() * 8); }
    g.strokeStyle = 'rgba(70,70,70,0.45)'; g.lineWidth = 2; g.strokeRect(1, 1, S - 2, S - 2);
    g.fillStyle = 'rgba(70,70,70,0.5)';
    for (const [x, y] of [[8, 8], [S - 8, 8], [8, S - 8], [S - 8, S - 8]]) g.fillRect(x - 1, y - 1, 2, 2);   // screw heads
  },
  // Pitted cast concrete
  concrete(g, S, r) {
    g.fillStyle = '#c4c4c4'; g.fillRect(0, 0, S, S);
    for (let i = 0; i < S * 2; i++) { const v = 150 + r() * 90; g.fillStyle = `rgba(${v},${v},${v},0.4)`; g.fillRect(r() * S, r() * S, 1 + r() * 3, 1 + r() * 3); }
  },
  // Blades of grass in clumps
  grass(g, S, r) {
    g.fillStyle = '#b8c8a8'; g.fillRect(0, 0, S, S);
    for (let i = 0; i < 26; i++) { const v = 0.03 + r() * 0.05; g.fillStyle = `rgba(${r() < 0.5 ? '255,255,220' : '40,70,30'},${v})`; g.beginPath(); g.ellipse(r() * S, r() * S, 14 + r() * 30, 10 + r() * 24, r() * 3, 0, Math.PI * 2); g.fill(); }
    for (let i = 0; i < S * 3; i++) {
      const x = r() * S, y = r() * S, l = 2 + r() * 5;
      g.strokeStyle = r() < 0.5 ? 'rgba(235,245,215,0.55)' : 'rgba(70,105,55,0.55)';
      g.lineWidth = 1;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + (r() - 0.5) * 3, y - l); g.stroke();
    }
  },
  // Packed earth and pebbles
  dirt(g, S, r) {
    g.fillStyle = '#c8c0b0'; g.fillRect(0, 0, S, S);
    for (let i = 0; i < S * 2.4; i++) { const v = 130 + r() * 110; g.fillStyle = `rgba(${v},${v - 6},${v - 16},0.5)`; const s = 1 + r() * 4; g.fillRect(r() * S, r() * S, s, s * (0.5 + r())); }
  },
  // Fine dark aggregate
  asphalt(g, S, r) {
    g.fillStyle = '#b0b0b0'; g.fillRect(0, 0, S, S);
    for (let i = 0; i < S * S * 0.4; i++) { const v = 110 + r() * 145; g.fillStyle = `rgba(${v},${v},${v},0.5)`; g.fillRect(r() * S, r() * S, 1.5, 1.5); }
  },
  // Brushed lines
  metal(g, S, r) {
    g.fillStyle = '#d8d8d8'; g.fillRect(0, 0, S, S);
    for (let i = 0; i < S; i++) { const v = 190 + r() * 65; g.fillStyle = `rgba(${v},${v},${v},0.5)`; g.fillRect(0, i, S, 1); }
  },
  // Slight mottling, for car paint
  paint(g, S, r) {
    g.fillStyle = '#f2f2f2'; g.fillRect(0, 0, S, S);
    for (let i = 0; i < 18; i++) { const v = 228 + r() * 27; g.fillStyle = `rgba(${v},${v},${v},0.3)`; g.fillRect(r() * S, r() * S, 40, 20); }
  },
  // A faint reflection band, for car windows
  glass(g, S) {
    const grad = g.createLinearGradient(0, 0, S, S);
    grad.addColorStop(0, '#d8d8d8'); grad.addColorStop(0.45, '#ffffff'); grad.addColorStop(0.55, '#c0c0c0'); grad.addColorStop(1, '#d0d0d0');
    g.fillStyle = grad; g.fillRect(0, 0, S, S);
  },
  // Vertical furrows
  bark(g, S, r) {
    g.fillStyle = '#bcbcbc'; g.fillRect(0, 0, S, S);
    for (let i = 0; i < S / 2; i++) { const x = r() * S, v = 110 + r() * 120; g.strokeStyle = `rgba(${v},${v},${v},0.7)`; g.lineWidth = 1 + r() * 2.4; g.beginPath(); g.moveTo(x, 0); g.lineTo(x + (r() - 0.5) * 8, S); g.stroke(); }
  },
  // Dappled leaves
  leaf(g, S, r) {
    g.fillStyle = '#a8a8a8'; g.fillRect(0, 0, S, S);
    for (let i = 0; i < S * 1.2; i++) { const v = 125 + r() * 130; g.fillStyle = `rgb(${v},${v},${Math.max(0, v - 25)})`; g.beginPath(); g.ellipse(r() * S, r() * S, 2 + r() * 5, 1 + r() * 3, r() * 3, 0, Math.PI * 2); g.fill(); }
  },
  // Overlapping rows of roof tiles
  shingle(g, S, r) {
    g.fillStyle = '#6a6a6a'; g.fillRect(0, 0, S, S);
    const rows = 6, h = S / rows, w = S / 6;
    for (let row = 0; row < rows; row++) for (let i = -1; i < 7; i++) {
      const v = 170 + r() * 70;
      g.fillStyle = `rgb(${v},${v},${v})`;
      g.fillRect(i * w + (row % 2) * (w / 2) + 0.8, row * h + 0.8, w - 1.6, h - 1.2);
    }
  },
};

// How many metres one tile covers
export const TEX_SCALE = { wood: 1.6, fabric: 0.5, carpet: 1, tiles: 1.2, brick: 0.9, stone: 2, plaster: 3, drywall: 0.5, concrete: 2.5, grass: 5, dirt: 3, asphalt: 3, metal: 1, paint: 2, glass: 1.5, bark: 1, leaf: 1.6, shingle: 2 };

const cache = new Map();

/** The texture of this name (made the first time it is needed). size: its pixels per side (smaller on Low graphics). */
export function mapTexture(name, size = 256) {
  const key = `${name}:${size}`;
  if (cache.has(key)) return cache.get(key);
  if (!DRAW[name]) return null;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  DRAW[name](c.getContext('2d'), size, rng(name.length * 977 + name.charCodeAt(0)));
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  cache.set(key, tex);
  return tex;
}
