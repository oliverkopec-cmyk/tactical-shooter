// A top-down plan of the map for the location step (Stage F): the building's floors and walls,
// doors, windows and stairs on one level at a time, with clickable markers for the attackers'
// spawn points or the defenders' sites, and teammates' names next to what they picked.
// Drawn on a 2D canvas from the map's boxes, so it matches every map with no extra data.

const BAND = [0.3, 2.2];   // a box belongs to a level if it overlaps this height range above its floor

/** The levels you can switch between: [{ name, y }], from the map's floors and roofs. */
export function mapLevels(map) {
  const tops = [...new Set(map.boxes.filter((b) => b.kind === 'floor').map((b) => Math.round(b.max[1] * 10) / 10))].sort((a, b) => a - b);
  const names = ['Ground', '1st floor', '2nd floor', '3rd floor'];
  const levels = tops.map((y, i) => ({ name: names[i] || `Floor ${i}`, y }));
  const roof = Math.max(...map.boxes.filter((b) => b.kind === 'roof').map((b) => b.max[1]));
  if (Number.isFinite(roof)) levels.push({ name: 'Roof', y: roof });
  return levels;
}

/** The level an object at height y stands on (index into mapLevels). */
export function levelOf(levels, y) {
  let best = 0;
  levels.forEach((l, i) => { if (y >= l.y - 0.5) best = i; });
  return best;
}

const COLORS = {
  bg: '#0d1117', grid: 'rgba(255,255,255,0.035)', yard: '#151b22', floor: '#222a33', roof: '#2a2f36',
  wall: '#c7ced8', interior: '#8d97a3', door: '#ffb347', window: '#7fd3ff', stairs: '#5a6573',
  prop: 'rgba(160,170,185,0.22)', outline: 'rgba(255,255,255,0.12)',
};

/**
 * Draw one level. opts:
 *   level: index into mapLevels(map)
 *   markers: [{ id, x, z, y, label, color, selected, onEdge }]: clickable pins (onEdge: clamp to the frame with an arrow)
 *   names: { markerId: ['Name', ...] }   teammates who picked each marker
 * Returns the hit areas of the markers: [{ id, x, y, r }] in CSS pixels.
 */
export function drawTopMap(canvas, map, { level = 0, markers = [], names = {}, hover = null } = {}) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (!w || !h) return [];
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const levels = mapLevels(map);
  const L = levels[Math.min(level, levels.length - 1)];
  const isRoof = L.name === 'Roof';

  // Frame the building (every footprint) with a margin; north (+z) is up
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const f of map.building) { x0 = Math.min(x0, f.x0); z0 = Math.min(z0, f.z0); x1 = Math.max(x1, f.x1); z1 = Math.max(z1, f.z1); }
  const margin = 7;
  x0 -= margin; z0 -= margin; x1 += margin; z1 += margin;
  const scale = Math.min(w / (x1 - x0), h / (z1 - z0));
  const ox = (w - (x1 - x0) * scale) / 2, oy = (h - (z1 - z0) * scale) / 2;
  const px = (x) => ox + (x - x0) * scale;
  const py = (z) => oy + (z1 - z) * scale;
  const rect = (b, fill, stroke) => {
    const a = px(b.min[0]), c = px(b.max[0]), top = py(b.max[2]), bot = py(b.min[2]);
    ctx.fillStyle = fill;
    ctx.fillRect(a, top, Math.max(1, c - a), Math.max(1, bot - top));
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.strokeRect(a + 0.5, top + 0.5, c - a - 1, bot - top - 1); }
  };

  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, w, h);
  // A faint 2 m grid over the yard
  ctx.strokeStyle = COLORS.grid;
  ctx.lineWidth = 1;
  for (let x = Math.ceil(x0 / 2) * 2; x < x1; x += 2) { ctx.beginPath(); ctx.moveTo(px(x), 0); ctx.lineTo(px(x), h); ctx.stroke(); }
  for (let z = Math.ceil(z0 / 2) * 2; z < z1; z += 2) { ctx.beginPath(); ctx.moveTo(0, py(z)); ctx.lineTo(w, py(z)); ctx.stroke(); }

  const inBand = (b) => b.min[1] < L.y + BAND[1] && b.max[1] > L.y + BAND[0];
  const onLevel = (b) => Math.abs(b.max[1] - L.y) < 0.15;
  // Floors (or the roof) of this level, then stairs, props, interior and outside walls
  for (const b of map.boxes) if ((b.kind === 'floor' || b.kind === 'roof') && onLevel(b)) rect(b, isRoof ? COLORS.roof : COLORS.floor, COLORS.outline);
  if (L.y < 0.5) for (const b of map.boxes) if (b.kind === 'concrete' && inBand(b)) rect(b, COLORS.yard);   // paths and pads in the yard
  for (const b of map.boxes) {
    if (b.kind !== 'stairs' || b.max[1] < L.y - 0.2 || b.min[1] > L.y + 3) continue;
    rect(b, COLORS.stairs);
  }
  // Stair treads: a few lines across each flight so it reads as stairs
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  for (const b of map.boxes) {
    if (b.kind !== 'stairs' || b.max[1] < L.y - 0.2 || b.min[1] > L.y + 3) continue;
    const a = px(b.min[0]), c = px(b.max[0]), top = py(b.max[2]), bot = py(b.min[2]);
    ctx.beginPath();
    if (c - a > bot - top) { ctx.moveTo(a + 1, top); ctx.lineTo(a + 1, bot); } else { ctx.moveTo(a, top + 1); ctx.lineTo(c, top + 1); }
    ctx.stroke();
  }
  for (const b of map.boxes) {
    if (!inBand(b)) continue;
    if (['furniture', 'crate', 'container', 'car', 'barrel', 'planter', 'pallet'].includes(b.kind)) rect(b, COLORS.prop);
  }
  for (const b of map.boxes) if (inBand(b) && (b.kind === 'interior' || b.kind === 'rail')) rect(b, COLORS.interior);
  for (const b of map.boxes) if (inBand(b) && b.kind === 'exterior') rect(b, COLORS.wall);

  // Doors (orange) and windows (blue) on this level, drawn across the wall gap
  for (const o of map.openings) {
    const floorY = o.window ? o.y0 - 1 : o.y0;
    if (Math.abs(floorY - L.y) > 0.6) continue;
    ctx.strokeStyle = o.window ? COLORS.window : COLORS.door;
    ctx.lineWidth = o.window ? 2 : 3;
    ctx.beginPath();
    if (o.axis === 'x') { ctx.moveTo(px(o.from), py(o.fixed)); ctx.lineTo(px(o.to), py(o.fixed)); }
    else { ctx.moveTo(px(o.fixed), py(o.from)); ctx.lineTo(px(o.fixed), py(o.to)); }
    ctx.stroke();
  }

  // Markers: a pin with a label, and the names of teammates who picked it
  const hits = [];
  ctx.font = '600 12px Inter, system-ui, sans-serif';
  ctx.textAlign = 'center';
  for (const m of markers) {
    let mx = px(m.x), my = py(m.z), arrow = null;
    if (m.onEdge) {
      // Off the frame (attack spawns are far out): pull it in to the edge and point the way to it
      const pad = 34;
      const cx = Math.max(pad, Math.min(w - pad, mx)), cy = Math.max(pad, Math.min(h - pad, my));
      if (cx !== mx || cy !== my) arrow = Math.atan2(my - cy, mx - cx);
      mx = cx; my = cy;
    }
    const r = m.selected ? 15 : 12, hot = hover === m.id;
    ctx.save();
    ctx.shadowColor = m.color; ctx.shadowBlur = m.selected || hot ? 18 : 6;
    ctx.fillStyle = m.selected ? m.color : 'rgba(13,17,23,0.85)';
    ctx.strokeStyle = m.color; ctx.lineWidth = m.selected ? 3 : 2;
    ctx.beginPath(); ctx.arc(mx, my, r + (hot ? 2 : 0), 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.restore();
    if (arrow !== null) {
      ctx.fillStyle = m.color;
      ctx.beginPath();
      const ax = mx + Math.cos(arrow) * (r + 9), ay = my + Math.sin(arrow) * (r + 9);
      ctx.moveTo(ax + Math.cos(arrow) * 6, ay + Math.sin(arrow) * 6);
      ctx.lineTo(ax + Math.cos(arrow + 2.4) * 6, ay + Math.sin(arrow + 2.4) * 6);
      ctx.lineTo(ax + Math.cos(arrow - 2.4) * 6, ay + Math.sin(arrow - 2.4) * 6);
      ctx.fill();
    }
    ctx.fillStyle = m.selected ? '#0d1117' : m.color;
    ctx.font = '800 12px Rajdhani, Inter, system-ui, sans-serif';
    ctx.fillText(m.short ?? '', mx, my + 4);
    // Label under the pin, then the teammates
    const labelY = my + r + 16;
    ctx.font = '700 13px Rajdhani, Inter, system-ui, sans-serif';
    const lw = ctx.measureText(m.label).width + 12;
    ctx.fillStyle = 'rgba(13,17,23,0.8)';
    ctx.fillRect(mx - lw / 2, labelY - 12, lw, 17);
    ctx.fillStyle = '#e8edf3';
    ctx.fillText(m.label, mx, labelY);
    const who = names[m.id] || [];
    ctx.font = '600 11px Inter, system-ui, sans-serif';
    who.slice(0, 5).forEach((n, i) => {
      const t = n.length > 14 ? `${n.slice(0, 13)}…` : n;
      const tw = ctx.measureText(t).width + 10, ty = labelY + 16 + i * 15;
      ctx.fillStyle = 'rgba(255,255,255,0.1)';
      ctx.fillRect(mx - tw / 2, ty - 11, tw, 14);
      ctx.fillStyle = m.color;
      ctx.fillText(t, mx, ty);
    });
    hits.push({ id: m.id, x: mx, y: my, r: r + 8 });
  }
  return hits;
}
