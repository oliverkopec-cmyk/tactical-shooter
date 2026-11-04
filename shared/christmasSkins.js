// Christmas skins (Stage M), all original designs drawn in code.
//
//   CHRISTMAS_LIMITED_SKINS  7 animated skins, one each from the presents of the last 7 days before Christmas (18-24
//                            December, in this order). Owned on every gun. Never sold, never in a crate, and an admin
//                            can't gift them. Their effects are in client/src/exclusiveSkins.js.
//   CHRISTMAS_CRATE_SKINS    10 skins that only come from the Christmas crate, on a random gun, like the normal crate.
//
// Fields are the same as in shared/skins.js and shared/exclusiveSkins.js. `source` keeps them out of the normal crate
// and out of the Operators tab until they are owned.

const X = (name, fx, c1, c2, c3, { scale = 9, speed = 1, glow = 1, metal = 0.5, particles = null } = {}) => ({
  name, rarity: 'exclusive', source: 'christmas', fx, c1, c2, c3, scale, speed, glow, variant: 0, metal, particles,
  pattern: 'solid', body: c1, accent: c2, mark: c3, steel: c1, trim: c3,
});

export const CHRISTMAS_LIMITED_SKINS = {
  xl_candycane: X('Candy Cane', 'candy', 0xf6f0ea, 0xc8141e, 0xfff6f0, { scale: 8, speed: 0.8, glow: 0.45, metal: 0.2 }),
  xl_wrapping: X('Wrapping Paper', 'wrap', 0xa8161e, 0xf2d46a, 0x0f6a3a, { scale: 17, speed: 1, glow: 1, metal: 0.3 }),
  xl_gingerbread: X('Gingerbread', 'ginger', 0x8a4f22, 0xf7f2e6, 0xe8403a, { scale: 19, speed: 0.8, glow: 0.8, metal: 0 }),
  xl_frosted: X('Frosted Ice', 'frost', 0x9ccbe8, 0xe8f8ff, 0xffffff, { scale: 8, speed: 1, glow: 0.9, metal: 0.6, particles: { kind: 'drift', color: 0xe8f8ff, count: 24, size: 0.012 } }),
  xl_ornament: X('Red and Gold Ornament', 'ornament', 0xa80f1a, 0xe8b22a, 0xfff0b0, { scale: 17, speed: 1, glow: 1, metal: 1 }),
  xl_snowypine: X('Snowy Pine', 'pine', 0x14391f, 0x2f6a35, 0xf4fbff, { scale: 13, speed: 1, glow: 0.9, metal: 0, particles: { kind: 'fall', color: 0xffffff, count: 30, size: 0.014 } }),
  xl_lights: X('Festive Lights', 'twinkle', 0x0d1712, 0x1c3a24, 0xffe8b0, { scale: 17, speed: 1, glow: 1.2, metal: 0.3 }),
};

export const CHRISTMAS_LIMITED_IDS = Object.keys(CHRISTMAS_LIMITED_SKINS);

const C = (name, rarity, pattern, body, accent, mark, { metal = 0.4, glow = 0, steel, trim } = {}) => ({
  name, rarity, pattern, body, accent, mark, steel: steel ?? accent, trim: trim ?? mark, metal, glow, source: 'christmas_crate',
});

export const CHRISTMAS_CRATE_SKINS = {
  // ---------------------------------------------------------------- common
  xc_wool: C('Winter Wool', 'common', 'stripes', 0xb8342e, 0x5a1a18, 0xf0e8dc, { metal: 0.05 }),
  xc_holly: C('Holly Leaf', 'common', 'camo', 0x1f5a34, 0x0f3320, 0x3f8a4e, { metal: 0.2 }),
  xc_candle: C('Candle Wax', 'common', 'solid', 0xe6dcc4, 0x9a8a68, 0xe6dcc4, { metal: 0.1, steel: 0x6a5a40, trim: 0xc8141e }),
  // ---------------------------------------------------------------- rare
  xc_sleigh: C('Sleigh Bells', 'rare', 'dots', 0x7a1418, 0x3a0a0c, 0xf2c84a, { metal: 0.6 }),
  xc_mulled: C('Mulled Wine', 'rare', 'bands', 0x4a0e24, 0x24060f, 0xd8924a, { metal: 0.5, glow: 0.05 }),
  xc_snowfall: C('Fresh Snowfall', 'rare', 'digital', 0xe8f0f6, 0x9ab0c0, 0x5a7288, { metal: 0.2 }),
  // ---------------------------------------------------------------- epic
  xc_tinsel: C('Silver Tinsel', 'epic', 'tiger', 0xc4ced8, 0x5a6470, 0xfff4c8, { metal: 0.95, glow: 0.25 }),
  xc_nightstar: C('Northern Star', 'epic', 'circuit', 0x0a1830, 0x06101f, 0xffe08a, { metal: 0.7, glow: 0.5 }),
  // ---------------------------------------------------------------- legendary
  xc_yulefire: C('Yule Fire', 'legendary', 'flames', 0x1a0a06, 0x0f3320, 0xff9a2a, { metal: 0.7, glow: 0.75 }),
  xc_silentnight: C('Silent Night', 'legendary', 'void', 0x050818, 0x0f1c48, 0xeaf4ff, { metal: 0.9, glow: 0.75 }),
};
