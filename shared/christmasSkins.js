// Christmas skins (Stage M), all original designs drawn in code.
//
//   CHRISTMAS_LIMITED_SKINS  7 animated skins, one each from the presents of the last 7 days before Christmas (18-24
//                            December, in this order). Owned on every gun. Never sold, never in a crate, and an admin
//                            can't gift them.
//   CHRISTMAS_CRATE_SKINS    10 skins that only come from the Christmas crate, on a random gun, like the normal crate.
//
// All 17 are drawn by effects in client/src/exclusiveSkins.js, with raised detail that catches the light. Fields are
// the same as in shared/exclusiveSkins.js. `source` keeps them out of the normal crate and out of the Operators tab
// until they are owned.

// c1-c3: the effect's colours. sc / tc: the colours of the metal parts and of the small parts (sights, vents).
const X = (name, rarity, source, fx, c1, c2, c3, { scale = 9, speed = 1, glow = 1, metal = 0.5, particles = null, sc = c1, tc = c3 } = {}) => ({
  name, rarity, source, fx, c1, c2, c3, sc, tc, scale, speed, glow, variant: 0, metal, particles,
  pattern: 'solid', body: c1, accent: c2, mark: c3, steel: sc, trim: tc,
});
const L = (...args) => X(args[0], 'exclusive', 'christmas', ...args.slice(1));
const C = (name, rarity, ...rest) => X(name, rarity, 'christmas_crate', ...rest);

export const CHRISTMAS_LIMITED_SKINS = {
  xl_candycane: L('Candy Cane', 'candy', 0xf8f2ec, 0xc8101c, 0xfff6f0, { scale: 11, speed: 0.8, glow: 0.7, metal: 0.2, sc: 0xd8dce2, tc: 0xc8101c, particles: { kind: 'drift', color: 0xffffff, count: 22, size: 0.009 } }),
  xl_wrapping: L('Wrapping Paper', 'wrap', 0xa8121c, 0xf4cf5a, 0x116e3c, { scale: 17, speed: 1, glow: 1, metal: 0.3, sc: 0xd8a830, tc: 0x116e3c, particles: { kind: 'rise', color: 0xf4cf5a, count: 20, size: 0.01 } }),
  xl_gingerbread: L('Gingerbread', 'ginger', 0x8f5222, 0xfaf4e8, 0xe43a34, { scale: 19, speed: 0.8, glow: 0.8, metal: 0, sc: 0x3a2014, tc: 0xfaf4e8, particles: { kind: 'fall', color: 0xfaf4e8, count: 14, size: 0.008 } }),
  xl_frosted: L('Frosted Ice', 'frost', 0x7fb8e0, 0xdff4ff, 0xffffff, { scale: 10, speed: 1, glow: 1, metal: 0.6, sc: 0xcfe4f4, tc: 0xffffff, particles: { kind: 'drift', color: 0xe8f8ff, count: 28, size: 0.012 } }),
  xl_ornament: L('Red and Gold Ornament', 'ornament', 0xa00c18, 0xecb62c, 0xfff0b0, { scale: 17, speed: 1, glow: 1, metal: 1, sc: 0xecb62c, tc: 0xfff0b0, particles: { kind: 'orbit', color: 0xffe08a, count: 22, size: 0.01 } }),
  xl_snowypine: L('Snowy Pine', 'pine', 0x10331c, 0x2f7038, 0xf6fcff, { scale: 15, speed: 1, glow: 0.9, metal: 0, sc: 0x4a3020, tc: 0xf6fcff, particles: { kind: 'fall', color: 0xffffff, count: 34, size: 0.014 } }),
  xl_lights: L('Festive Lights', 'twinkle', 0x0c1a12, 0x1f4028, 0xffe8b0, { scale: 17, speed: 1, glow: 1.2, metal: 0.3, sc: 0x1a1c1e, tc: 0xffc860, particles: { kind: 'drift', color: 0xffd890, count: 18, size: 0.01 } }),
};

export const CHRISTMAS_LIMITED_IDS = Object.keys(CHRISTMAS_LIMITED_SKINS);

export const CHRISTMAS_CRATE_SKINS = {
  // ---------------------------------------------------------------- common: still, soft materials
  xc_wool: C('Winter Wool', 'common', 'knit', 0xb02a2c, 0xf2eadc, 0x1f5a38, { scale: 90, speed: 0, glow: 0, metal: 0, sc: 0x3a3a3e, tc: 0xf2eadc }),
  xc_holly: C('Holly Leaf', 'common', 'holly', 0x1a4f2e, 0x2f7a42, 0xd01c24, { scale: 22, speed: 0, glow: 0.3, metal: 0.1, sc: 0x2a2e28, tc: 0xd01c24 }),
  xc_candle: C('Candle Wax', 'common', 'wax', 0xeadfc6, 0xcdb78c, 0xffb860, { scale: 20, speed: 0.6, glow: 0.45, metal: 0, sc: 0x7a6238, tc: 0xc8141e }),
  // ---------------------------------------------------------------- rare: rich materials
  xc_sleigh: C('Sleigh Bells', 'rare', 'leather', 0x7c1216, 0x3e0a0c, 0xf2c84a, { scale: 22, speed: 0.8, glow: 0.8, metal: 0.25, sc: 0xc89c34, tc: 0xf2c84a }),
  xc_mulled: C('Mulled Wine', 'rare', 'mulled', 0x3c0a1e, 0x8a1838, 0xf09a40, { scale: 26, speed: 0.7, glow: 0.8, metal: 0.5, sc: 0x2a1016, tc: 0xf09a40 }),
  xc_snowfall: C('Fresh Snowfall', 'rare', 'drift', 0xeaf2f8, 0x9db8d0, 0xffffff, { scale: 30, speed: 0.8, glow: 0.7, metal: 0.05, sc: 0x7288a0, tc: 0xdcecf8 }),
  // ---------------------------------------------------------------- epic: glowing and moving
  xc_tinsel: C('Silver Tinsel', 'epic', 'tinsel', 0xaeb8c4, 0xf4f8ff, 0xffe8a8, { scale: 22, speed: 1, glow: 1, metal: 1, sc: 0xdfe6ee, tc: 0xffe8a8, particles: { kind: 'drift', color: 0xffffff, count: 22, size: 0.009 } }),
  xc_nightstar: C('Northern Star', 'epic', 'nightstar', 0x081430, 0x2a7a90, 0xfff0b0, { scale: 28, speed: 1, glow: 1.3, metal: 0.6, sc: 0x18284a, tc: 0xfff0b0, particles: { kind: 'orbit', color: 0xfff0b0, count: 16, size: 0.009 } }),
  // ---------------------------------------------------------------- legendary: the full show
  xc_yulefire: C('Yule Fire', 'legendary', 'yule', 0x1c0e08, 0xff5a10, 0xffd860, { scale: 24, speed: 1, glow: 1.5, metal: 0.2, sc: 0x24120a, tc: 0xff8a20, particles: { kind: 'rise', color: 0xff9a30, count: 34, size: 0.016 } }),
  xc_silentnight: C('Silent Night', 'legendary', 'silent', 0x050a20, 0xdfeaff, 0xffe8a0, { scale: 16, speed: 1, glow: 1.3, metal: 0.5, sc: 0x101a3c, tc: 0xffe8a0, particles: { kind: 'fall', color: 0xffffff, count: 36, size: 0.013 } }),
};
