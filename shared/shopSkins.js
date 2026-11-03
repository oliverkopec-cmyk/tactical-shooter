// Shop-only skins (Stage 2K), all original designs drawn in code like every other skin.
//
//   DAILY_SKINS    the pool of 50 the daily shop picks from (6 a day). Never in the crate.
//   LIMITED_SKINS  a few special skins sold for a set number of days (see LIMITED in shared/shop.js), then gone.
//
// Fields are the same as in shared/skins.js. New patterns for these: 'digital' (pixel blocks), 'dots' (a grid of
// studs), 'bands' (racing stripes along the gun), 'split' (two-tone, front and back) and 'tiger' (stripes from the
// top and bottom edges). `source` marks where a skin is sold.

const D = (name, rarity, pattern, body, accent, mark, { metal = 0.5, glow = 0, steel, trim } = {}) => ({
  name, rarity, pattern, body, accent, mark, steel: steel ?? accent, trim: trim ?? mark, metal, glow, source: 'daily',
});

export const DAILY_SKINS = {
  // ---------------------------------------------------------------- rare (20)
  d_harbor: D('Harbor Blue', 'rare', 'bands', 0x24456a, 0x10213a, 0xe8eef5, { metal: 0.5 }),
  d_rust: D('Rust Belt', 'rare', 'digital', 0x7a3a1c, 0x3a1c0e, 0xc2703a, { metal: 0.3 }),
  d_moss: D('Forest Moss', 'rare', 'camo', 0x3a4a2a, 0x1e2a14, 0x6a7a3a, { metal: 0.2 }),
  d_copper: D('Copper Line', 'rare', 'stripes', 0x8a4a28, 0x2a1a12, 0xe0904a, { metal: 0.8 }),
  d_glacier: D('Glacier', 'rare', 'split', 0xbad4e2, 0x4a6a80, 0xeaf6ff, { metal: 0.4 }),
  d_brick: D('Red Brick', 'rare', 'digital', 0x8a2e22, 0x4a1a14, 0xb85a48, { metal: 0.2 }),
  d_sandstorm: D('Sandstorm', 'rare', 'tiger', 0xc2a26a, 0x6a5232, 0x5a4428, { metal: 0.2 }),
  d_navy: D('Navy Dots', 'rare', 'dots', 0x1a2a4a, 0x0e1626, 0xd8dee8, { metal: 0.5 }),
  d_lime: D('Lime Split', 'rare', 'split', 0x2a3a1a, 0x141c0e, 0x9ad83a, { metal: 0.4, glow: 0.05 }),
  d_charcoal: D('Charcoal Tiger', 'rare', 'tiger', 0x3a3d42, 0x1c1e22, 0x9aa2ac, { metal: 0.4 }),
  d_teal: D('Deep Teal', 'rare', 'bands', 0x0e4a4a, 0x062424, 0x3ad8c8, { metal: 0.5, glow: 0.05 }),
  d_clay: D('Terracotta', 'rare', 'solid', 0xb0583a, 0x5a2a1a, 0xe08a6a, { metal: 0.2 }),
  d_steelblue: D('Steel Blue', 'rare', 'stripes', 0x4a6a8a, 0x22344a, 0xb8cce0, { metal: 0.7 }),
  d_khaki: D('Field Khaki', 'rare', 'digital', 0x8a7a52, 0x4a422a, 0x5a5236, { metal: 0.2 }),
  d_plum: D('Plum', 'rare', 'solid', 0x5a2a4a, 0x2a1222, 0xb06a98, { metal: 0.5 }),
  d_tundra: D('Tundra Camo', 'rare', 'camo', 0xc8ccc8, 0x6a706a, 0x3a3e3a, { metal: 0.2 }),
  d_mustard: D('Mustard Band', 'rare', 'bands', 0xb89a2a, 0x4a3e12, 0x1a1a14, { metal: 0.3 }),
  d_ash: D('Ash Dots', 'rare', 'dots', 0x5a5a5e, 0x2a2a2e, 0xe0a040, { metal: 0.4 }),
  d_mint: D('Mint', 'rare', 'split', 0x7ad0b0, 0x2a6a58, 0xe8fff6, { metal: 0.4 }),
  d_bronze: D('Bronze Stripe', 'rare', 'stripes', 0x6a4a22, 0x2e2010, 0xd0a060, { metal: 0.85 }),
  // ---------------------------------------------------------------- epic (18)
  d_hazard: D('Hazard Tape', 'epic', 'tiger', 0xe8c020, 0x2a2a2a, 0x141414, { metal: 0.3, glow: 0.1 }),
  d_synthwave: D('Synthwave', 'epic', 'bands', 0x1a0a2e, 0x2a0e4a, 0xff3ab0, { metal: 0.6, glow: 0.45 }),
  d_pixelfire: D('Pixel Fire', 'epic', 'digital', 0x2a0a06, 0x5a1408, 0xff7a1a, { metal: 0.5, glow: 0.4 }),
  d_icecore: D('Ice Core', 'epic', 'circuit', 0x0e2a3a, 0x061a26, 0x8ae8ff, { metal: 0.8, glow: 0.45 }),
  d_venom: D('Venom', 'epic', 'tiger', 0x0e1a0e, 0x061006, 0x5aff3a, { metal: 0.6, glow: 0.5 }),
  d_rosegold: D('Rose Gold', 'epic', 'split', 0xd89a8a, 0x8a4a4a, 0xffd0c0, { metal: 1, glow: 0.15 }),
  d_carbon: D('Carbon Weave', 'epic', 'dots', 0x16181c, 0x0a0b0d, 0x4a5058, { metal: 0.9 }),
  d_ultraviolet: D('Ultraviolet', 'epic', 'dots', 0x14062a, 0x0a0318, 0xb04aff, { metal: 0.6, glow: 0.55 }),
  d_magma: D('Magma Split', 'epic', 'split', 0x1a0805, 0x3a0e06, 0xff5a1a, { metal: 0.6, glow: 0.5 }),
  d_reef: D('Coral Reef', 'epic', 'camo', 0x0a4a5a, 0x062a34, 0xff8a6a, { metal: 0.5, glow: 0.3 }),
  d_glitch: D('Glitch', 'epic', 'digital', 0x0a0a12, 0x14142a, 0x3affea, { metal: 0.6, glow: 0.5 }),
  d_racing: D('Racing Red', 'epic', 'bands', 0xc0141a, 0x5a0a0e, 0xf8f8f8, { metal: 0.8, glow: 0.05 }),
  d_tealgold: D('Teal and Gold', 'epic', 'stripes', 0x0e4a48, 0x062a28, 0xf0c24a, { metal: 0.9, glow: 0.2 }),
  d_ember: D('Ember Tiger', 'epic', 'tiger', 0x1a0a06, 0x3a1206, 0xff9a2a, { metal: 0.5, glow: 0.45 }),
  d_frostbite: D('Frostbite', 'epic', 'circuit', 0xd8eef8, 0x7aa8c8, 0x2a6aff, { metal: 0.7, glow: 0.35 }),
  d_jungle: D('Jungle Night', 'epic', 'camo', 0x0a1a0e, 0x041006, 0x3aff8a, { metal: 0.4, glow: 0.4 }),
  d_sunset: D('Sunset Bands', 'epic', 'bands', 0x3a0e2a, 0xff6a2a, 0xffd24a, { metal: 0.6, glow: 0.35 }),
  d_marble: D('White Marble', 'epic', 'tiger', 0xeeeae4, 0x9a9890, 0x6a6a72, { metal: 0.6 }),
  // ---------------------------------------------------------------- legendary (12)
  d_supernova: D('Supernova', 'legendary', 'void', 0x06040e, 0x2a0a4a, 0xffe08a, { metal: 0.9, glow: 0.85 }),
  d_plasma: D('Plasma Core', 'legendary', 'circuit', 0x05061a, 0x1a1a6a, 0xff4af0, { metal: 0.9, glow: 0.8 }),
  d_goldleaf: D('Gold Leaf', 'legendary', 'digital', 0x1a1408, 0x5a4410, 0xffd84a, { metal: 1, glow: 0.45 }),
  d_dragonfire: D('Dragonfire', 'legendary', 'flames', 0x1a0404, 0x4a0a06, 0xff3a1a, { metal: 0.8, glow: 0.8 }),
  d_hologram: D('Hologram', 'legendary', 'dots', 0x9ad8e8, 0x4a6aa8, 0xffffff, { metal: 1, glow: 0.6 }),
  d_obsidian: D('Obsidian Blade', 'legendary', 'split', 0x050507, 0x14141a, 0x3affc8, { metal: 1, glow: 0.7 }),
  d_thunder: D('Thunderhead', 'legendary', 'tiger', 0x0a0e1a, 0x1a2a4a, 0x9fe0ff, { metal: 0.9, glow: 0.8 }),
  d_emerald: D('Emerald Crown', 'legendary', 'bands', 0x064a2a, 0x02261a, 0xffd24a, { metal: 1, glow: 0.4 }),
  d_bloodmoon: D('Blood Moon', 'legendary', 'void', 0x0e0204, 0x4a0610, 0xff2a3a, { metal: 0.9, glow: 0.8 }),
  d_starfield: D('Starfield', 'legendary', 'dots', 0x04050e, 0x0a0e2a, 0xffffff, { metal: 0.8, glow: 0.7 }),
  d_inferno2: D('Hellfire', 'legendary', 'tiger', 0x140402, 0x5a1004, 0xffb02a, { metal: 0.8, glow: 0.85 }),
  d_aurora: D('Northern Lights', 'legendary', 'bands', 0x020a14, 0x3aff9a, 0xa04aff, { metal: 0.8, glow: 0.7 }),
};

const L = (name, pattern, body, accent, mark, opts = {}) => ({ ...D(name, 'legendary', pattern, body, accent, mark, opts), source: 'limited' });

export const LIMITED_SKINS = {
  l_firstfrost: L('First Frost', 'circuit', 0xeaf6ff, 0x6aa8d8, 0x2a8aff, { metal: 1, glow: 0.7 }),
  l_harvest: L('Harvest Moon', 'tiger', 0x2a1204, 0xd86a1a, 0xffc24a, { metal: 0.9, glow: 0.75 }),
  l_launch: L('Launch Day', 'split', 0x0a0a0e, 0xf0c24a, 0xffffff, { metal: 1, glow: 0.6 }),
};
