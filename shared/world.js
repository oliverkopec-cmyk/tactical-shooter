// The collidable world: static map boxes plus destructible interior walls.
// Every interior wall piece from the map is split into a grid of panels.
// Panel ids, sections and layout are derived deterministically from the map,
// so client and server agree on them and only need to sync which panels are
// gone and which sections are reinforced.


export const PANEL_SIZE = 0.5;        // target panel width/height (m)
export const PANEL_HP = 50;           // bullet damage needed to knock a panel out
export const SECTION_COLUMNS = 4;     // panel columns per reinforceable section (~2 m)

const layouts = new WeakMap();   // map -> its wall layout

/** Split a map's interior wall pieces into panels and reinforcement sections. */
export function getWallLayout(map) {
  if (layouts.has(map)) return layouts.get(map);
  const staticBoxes = [];
  const walls = [];
  const panels = [];
  const sections = [];

  for (const b of map.boxes) {
    if (b.kind !== 'interior') { staticBoxes.push(b); continue; }

    const axis = b.wallAxis; // 'x': runs along x (thin in z); 'z': runs along z (thin in x)
    const runIdx = axis === 'x' ? 0 : 2;
    const len = b.max[runIdx] - b.min[runIdx];
    const height = b.max[1] - b.min[1];
    const cols = Math.max(1, Math.round(len / PANEL_SIZE));
    const rows = Math.max(1, Math.round(height / PANEL_SIZE));
    const pw = len / cols, ph = height / rows;

    const wall = { id: walls.length, axis, min: b.min, max: b.max, name: b.wallName, cols, rows, panelIds: [], sectionIds: [] };
    walls.push(wall);

    // Columns are grouped into sections; a short remainder joins the previous one.
    const sectionOfCol = [];
    let sectionCount = Math.max(1, Math.round(cols / SECTION_COLUMNS));
    for (let c = 0; c < cols; c++) sectionOfCol.push(Math.min(sectionCount - 1, Math.floor(c / SECTION_COLUMNS)));
    const firstSection = sections.length;
    for (let s = 0; s < sectionCount; s++) {
      // Door lintels (a single row) are too small to be worth reinforcing.
      sections.push({ id: firstSection + s, wallId: wall.id, reinforceable: rows > 1, panelIds: [], min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] });
      wall.sectionIds.push(firstSection + s);
    }

    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < rows; r++) {
        const a0 = b.min[runIdx] + c * pw, a1 = a0 + pw;
        const y0 = b.min[1] + r * ph, y1 = y0 + ph;
        const min = [...b.min], max = [...b.max];
        min[runIdx] = a0; max[runIdx] = a1; min[1] = y0; max[1] = y1;
        const section = sections[firstSection + sectionOfCol[c]];
        const panel = {
          id: panels.length, kind: 'panel', wallId: wall.id, sectionId: section.id, col: c, row: r,
          min, max,
          center: [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2],
        };
        panel.panelId = panel.id;
        panels.push(panel);
        wall.panelIds.push(panel.id);
        section.panelIds.push(panel.id);
        for (let i = 0; i < 3; i++) {
          section.min[i] = Math.min(section.min[i], min[i]);
          section.max[i] = Math.max(section.max[i], max[i]);
        }
      }
    }
  }
  const layout = { staticBoxes, walls, panels, sections };
  layouts.set(map, layout);
  return layout;
}

export class World {
  constructor(map) {
    this.map = map;
    this.layout = getWallLayout(map);
    this.reset();
  }

  reset() {
    this.extra = new Map();   // dynamic solid boxes (deployed shields), id -> box
    const { panels, sections } = this.layout;
    this.alive = new Uint8Array(panels.length).fill(1);
    this.reinforced = new Uint8Array(sections.length);
    this.rebuild();
  }

  /** The list movement and raycasts iterate: static boxes + panels still standing. */
  rebuild() {
    const { staticBoxes, panels } = this.layout;
    const boxes = staticBoxes.slice();
    for (const p of panels) if (this.alive[p.id]) boxes.push(p);
    for (const b of this.extra.values()) boxes.push(b);
    this.boxes = boxes;
    // What defenders collide with during prep: the map plus plugs in every exterior opening.
    this.barrierView = { boxes: boxes.concat(this.map.barriers) };
  }

  addBox(box) { this.extra.set(box.id, box); this.rebuild(); }
  removeBox(id) { if (this.extra.delete(id)) this.rebuild(); }

  get panels() { return this.layout.panels; }
  get sections() { return this.layout.sections; }

  isReinforcedPanel(panelId) {
    return this.reinforced[this.layout.panels[panelId].sectionId] === 1;
  }

  /** Remove panels. Returns the ids that were actually standing. */
  destroyPanels(ids) {
    const removed = [];
    for (const id of ids) {
      if (this.alive[id]) { this.alive[id] = 0; removed.push(id); }
    }
    if (removed.length) this.rebuild();
    return removed;
  }

  sectionIntact(sectionId) {
    return this.layout.sections[sectionId].panelIds.every((id) => this.alive[id]);
  }

  reinforce(sectionId) {
    this.reinforced[sectionId] = 1;
  }

  /** Compact state for late joiners. */
  snapshot() {
    const destroyed = [], reinforced = [];
    this.alive.forEach((a, id) => { if (!a) destroyed.push(id); });
    this.reinforced.forEach((r, id) => { if (r) reinforced.push(id); });
    return { destroyed, reinforced };
  }

  applySnapshot({ destroyed = [], reinforced = [] } = {}) {
    this.reset();
    for (const id of destroyed) this.alive[id] = 0;
    for (const id of reinforced) this.reinforced[id] = 1;
    this.rebuild();
  }

  /** Panels whose centres are within `radius` of a point (for explosions). */
  panelsNear(point, radius) {
    const out = [];
    for (const p of this.layout.panels) {
      if (!this.alive[p.id]) continue;
      const dx = p.center[0] - point[0], dy = p.center[1] - point[1], dz = p.center[2] - point[2];
      if (dx * dx + dy * dy + dz * dz <= radius * radius) out.push(p.id);
    }
    return out;
  }
}
