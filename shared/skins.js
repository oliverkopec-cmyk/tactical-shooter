// Gun skins. A skin recolours a gun and can add a pattern drawn in code (no
// image files). Any skin fits any gun; each gun has its own equipped skin.
//
//   body / accent   replace the gun's own two colours
//   pattern         'solid' | 'stripes' | 'camo' | 'circuit' | 'flames' | 'void'
//   mark            colour of the pattern marks
//   metal / glow    how shiny (0-1) and how much it glows (0-1)

export const RARITIES = {
  common: { id: 'common', name: 'Common', color: '#b0b6bd', order: 0 },
  rare: { id: 'rare', name: 'Rare', color: '#4a90e2', order: 1 },
  epic: { id: 'epic', name: 'Epic', color: '#b04ae8', order: 2 },
  legendary: { id: 'legendary', name: 'Legendary', color: '#f0a020', order: 3 },
};

export const SKINS = {
  // ---------------------------------------------------------------- common (every account owns these)
  olive: { name: 'Olive Drab', rarity: 'common', pattern: 'solid', body: 0x4b5a3a, accent: 0x2e3826, mark: 0x4b5a3a, metal: 0.2, glow: 0 },
  sand: { name: 'Desert Sand', rarity: 'common', pattern: 'solid', body: 0xb59a6b, accent: 0x6b5a3a, mark: 0xb59a6b, metal: 0.2, glow: 0 },
  slate: { name: 'Slate Stripe', rarity: 'common', pattern: 'stripes', body: 0x3d4650, accent: 0x20262c, mark: 0x8b95a3, metal: 0.3, glow: 0 },
  urban: { name: 'Urban Grey', rarity: 'common', pattern: 'solid', body: 0x6f757c, accent: 0x33373b, mark: 0x6f757c, metal: 0.3, glow: 0 },
  // ---------------------------------------------------------------- rare
  cobalt: { name: 'Cobalt', rarity: 'rare', pattern: 'solid', body: 0x1f55a8, accent: 0x0e2a55, mark: 0x4a90e2, metal: 0.6, glow: 0.05 },
  crimson: { name: 'Crimson Stripe', rarity: 'rare', pattern: 'stripes', body: 0x2b2b30, accent: 0x6a1414, mark: 0xd8323a, metal: 0.5, glow: 0.05 },
  arctic: { name: 'Arctic Camo', rarity: 'rare', pattern: 'camo', body: 0xdde6ee, accent: 0x8fa3b5, mark: 0x7e93a8, metal: 0.3, glow: 0 },
  // ---------------------------------------------------------------- epic
  circuit: { name: 'Neon Circuit', rarity: 'epic', pattern: 'circuit', body: 0x10161f, accent: 0x0a3a44, mark: 0x39f0ff, metal: 0.7, glow: 0.45 },
  amethyst: { name: 'Amethyst', rarity: 'epic', pattern: 'solid', body: 0x6a2bb0, accent: 0x2a0f4a, mark: 0xd18cff, metal: 0.8, glow: 0.35 },
  toxic: { name: 'Toxic Camo', rarity: 'epic', pattern: 'camo', body: 0x1c2a1a, accent: 0x0e1a0e, mark: 0x7dff3a, metal: 0.5, glow: 0.4 },
  // ---------------------------------------------------------------- legendary
  gilded: { name: 'Gilded', rarity: 'legendary', pattern: 'solid', body: 0xd9a824, accent: 0x7a5a10, mark: 0xfff0a0, metal: 1, glow: 0.3 },
  inferno: { name: 'Inferno', rarity: 'legendary', pattern: 'flames', body: 0x1a0e0a, accent: 0x5a1a08, mark: 0xff7a1a, metal: 0.7, glow: 0.7 },
  void: { name: 'Void', rarity: 'legendary', pattern: 'void', body: 0x07060d, accent: 0x1a0f3a, mark: 0xa56bff, metal: 0.9, glow: 0.8 },
};

export const SKIN_IDS = Object.keys(SKINS);
/** Skins sorted by rarity, then name, for menus. */
export function skinList() {
  return SKIN_IDS.map((id) => ({ id, ...SKINS[id], rarityInfo: RARITIES[SKINS[id].rarity] }))
    .sort((a, b) => a.rarityInfo.order - b.rarityInfo.order || a.name.localeCompare(b.name));
}

export const hexColor = (n) => `#${n.toString(16).padStart(6, '0')}`;

// ---------------------------------------------------------------- crates

/**
 * Every gun has one crate. It holds every skin, and the skin you get is picked by the
 * server: first a rarity by these odds, then one skin of that rarity at random.
 * A skin you already own for that gun refunds half the price in Money. Crates cost
 * Money only (never Polish Money).
 */
export const CRATE = {
  price: 900,
  refund: 450,
  odds: { common: 0.6, rare: 0.25, epic: 0.12, legendary: 0.03 },
};

/** Skins in a crate, grouped by rarity: { common: [ids], rare: [...], ... }. */
export function crateContents() {
  const out = { common: [], rare: [], epic: [], legendary: [] };
  for (const id of SKIN_IDS) out[SKINS[id].rarity].push(id);
  return out;
}

/** Pick a skin. `randInt(n)` must return a whole number in 0..n-1 (the server passes a secure one). */
export function rollCrate(randInt) {
  // Odds are in parts per ten thousand so the draw is exact
  const roll = randInt(10000);
  let acc = 0, rarity = 'legendary';
  for (const [r, p] of Object.entries(CRATE.odds)) {
    acc += Math.round(p * 10000);
    if (roll < acc) { rarity = r; break; }
  }
  const pool = crateContents()[rarity];
  return { rarity, skin: pool[randInt(pool.length)] };
}
