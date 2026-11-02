// The 40 Exclusive skins: gift-only (never in a crate or the shop), given by an admin.
// Owned on every gun, like any skin bought for all guns. Each one is drawn by an animated
// effect in client/src/exclusiveSkins.js:
//
//   fx          which effect draws the body and furniture (lava, space, storm, crystal, ...)
//   c1, c2, c3  its three colours: base, second, glow
//   scale       pattern size (bigger = smaller, busier marks)
//   speed       how fast it moves
//   glow        how brightly the glowing parts shine (0-2)
//   variant     a second look some effects have (0 or 1)
//   particles   optional { kind: 'rise' | 'fall' | 'drift' | 'orbit', color, count, size } floating around the gun
//
// body / accent / mark are filled in from c1-c3 so menus can draw a swatch the same way as for other skins.

const X = (name, fx, c1, c2, c3, { scale = 9, speed = 1, glow = 1, variant = 0, metal = 0.6, particles = null } = {}) => ({
  name, rarity: 'exclusive', fx, c1, c2, c3, scale, speed, glow, variant, metal, particles,
  pattern: 'solid', body: c1, accent: c2, mark: c3, steel: c1, trim: c3,
});

export const EXCLUSIVE_SKINS = {
  x_molten: X('Molten Core', 'lava', 0x1a0805, 0xff4a0a, 0xffd23a, { scale: 9, speed: 1, glow: 1.4, particles: { kind: 'rise', color: 0xff7a1a, count: 26, size: 0.02 } }),
  x_coldmagma: X('Cobalt Magma', 'lava', 0x050a1a, 0x1a5aff, 0x8ae8ff, { scale: 13, speed: 0.7, glow: 1.3, particles: { kind: 'rise', color: 0x5ab0ff, count: 20, size: 0.018 } }),
  x_deepspace: X('Deep Space', 'space', 0x05061a, 0x3a1c8a, 0xffffff, { scale: 8, speed: 0.6, glow: 1.2, particles: { kind: 'drift', color: 0xcfd8ff, count: 30, size: 0.012 } }),
  x_nebula: X('Nebula Bloom', 'space', 0x140828, 0xd0408a, 0x7ff0ff, { scale: 5, speed: 0.9, glow: 1.3 }),
  x_storm: X('Electric Storm', 'storm', 0x070d1c, 0x2a4a7a, 0xbfe6ff, { scale: 7, speed: 1.2, glow: 1.6, particles: { kind: 'orbit', color: 0x9fd8ff, count: 18, size: 0.012 } }),
  x_tempest: X('Violet Tempest', 'storm', 0x0d0618, 0x5a2a8a, 0xe0a0ff, { scale: 10, speed: 1.5, glow: 1.6 }),
  x_frozen: X('Frozen Crystal', 'crystal', 0x9fd6f2, 0x2a6ea8, 0xffffff, { scale: 8, speed: 1, glow: 0.9, metal: 0.9, particles: { kind: 'fall', color: 0xffffff, count: 30, size: 0.014 } }),
  x_rosequartz: X('Rose Quartz', 'crystal', 0xf2b6c8, 0x9a3a6a, 0xfff0f6, { scale: 12, speed: 0.8, glow: 0.8, metal: 0.9 }),
  x_neoncity: X('Neon City', 'neon', 0x07060f, 0xff2aa8, 0x2af0ff, { scale: 10, speed: 1, glow: 1.4 }),
  x_nightmarket: X('Night Market', 'neon', 0x0b0904, 0xffa020, 0x5aff8a, { scale: 14, speed: 0.7, glow: 1.3 }),
  x_dragon: X('Dragon Scales', 'scales', 0x0a3a24, 0x3affb0, 0xffd24a, { scale: 9, speed: 0.6, glow: 0.9, metal: 0.85 }),
  x_wyrm: X('Wyrm Ember', 'scales', 0x2a0505, 0xff3a2a, 0xffb020, { scale: 13, speed: 0.9, glow: 1.1, metal: 0.8, particles: { kind: 'rise', color: 0xff5020, count: 16, size: 0.016 } }),
  x_goldcircuit: X('Golden Circuitry', 'circuit', 0x0a0907, 0xb08420, 0xffe28a, { scale: 9, speed: 1, glow: 1.5, metal: 0.9 }),
  x_quantum: X('Quantum Trace', 'circuit', 0x050d1c, 0x6ab8ff, 0xffffff, { scale: 13, speed: 1.6, glow: 1.5, metal: 0.8 }),
  x_ocean: X('Ocean Waves', 'waves', 0x031a3a, 0x0a7ab0, 0xc8faff, { scale: 6, speed: 1, glow: 1, particles: { kind: 'rise', color: 0xbff4ff, count: 18, size: 0.012 } }),
  x_abyss: X('Tidal Abyss', 'waves', 0x010806, 0x053a2a, 0x3affc8, { scale: 9, speed: 0.6, glow: 1.4 }),
  x_aurora: X('Aurora', 'aurora', 0x030812, 0x3aff9a, 0xa04aff, { scale: 6, speed: 0.8, glow: 1.4 }),
  x_solaraurora: X('Solar Flare', 'aurora', 0x120604, 0xffc23a, 0xff2a5a, { scale: 9, speed: 1.1, glow: 1.4, particles: { kind: 'drift', color: 0xffd27a, count: 20, size: 0.012 } }),
  x_blossom: X('Cherry Blossom', 'blossom', 0x2a0e1a, 0xffb6d2, 0xff6aa8, { scale: 6, speed: 1, glow: 0.7, particles: { kind: 'fall', color: 0xffb6d2, count: 22, size: 0.022 } }),
  x_sakura: X('Midnight Sakura', 'blossom', 0x060a1e, 0xf2f4ff, 0x8aa8ff, { scale: 8, speed: 0.7, glow: 0.8 }),
  x_carbongold: X('Carbon Gold', 'carbon', 0x0b0b0c, 0xd9a824, 0xfff0a0, { scale: 9, speed: 1, glow: 1, metal: 0.9 }),
  x_carbonfrost: X('Carbon Frost', 'carbon', 0x0a0c0e, 0x9ad8ff, 0xffffff, { scale: 12, speed: 0.8, glow: 1, metal: 0.9, variant: 1 }),
  x_glitch: X('Glitch', 'glitch', 0x16161c, 0x5a5a6e, 0xff2a6a, { scale: 7, speed: 1, glow: 1.4 }),
  x_corrupt: X('Corrupted Signal', 'glitch', 0x020a04, 0x0a3a14, 0x3aff6a, { scale: 10, speed: 1.4, glow: 1.4, variant: 1 }),
  x_holo: X('Holographic', 'holo', 0x8a8f9a, 0xffffff, 0xffffff, { scale: 8, speed: 1, glow: 1, metal: 1 }),
  x_prism: X('Prism Shard', 'holo', 0x2a2a3a, 0xc8b0ff, 0xffffff, { scale: 7, speed: 0.8, glow: 1.2, metal: 1, variant: 1 }),
  x_plasma: X('Plasma Core', 'plasma', 0x6a1aff, 0xff3ab0, 0x3ad0ff, { scale: 7, speed: 1.2, glow: 1.2 }),
  x_acid: X('Acid Rush', 'plasma', 0x2aff3a, 0xfff03a, 0x0a6a2a, { scale: 11, speed: 1.6, glow: 1.1 }),
  x_marble: X('Gold-Veined Marble', 'marble', 0xeceae4, 0xc8901a, 0xffd860, { scale: 7, speed: 0.8, glow: 0.7, metal: 0.4 }),
  x_obsidian: X('Obsidian Vein', 'marble', 0x08070a, 0xff2a1a, 0xff8a3a, { scale: 9, speed: 1, glow: 1.5, metal: 0.8, variant: 1 }),
  x_shield: X('Energy Shield', 'hexes', 0x041018, 0x2ad8ff, 0xffffff, { scale: 9, speed: 1, glow: 1.4 }),
  x_hive: X('Hive Pulse', 'hexes', 0x120a02, 0xffb020, 0xfff0a0, { scale: 13, speed: 1.3, glow: 1.3, metal: 0.8 }),
  x_phoenix: X('Phoenix Flame', 'fire', 0x200502, 0xff5a0a, 0xffe24a, { scale: 6, speed: 1, glow: 1.4, particles: { kind: 'rise', color: 0xffa020, count: 30, size: 0.02 } }),
  x_spiritfire: X('Spirit Fire', 'fire', 0x02061a, 0x2a6aff, 0xd8f4ff, { scale: 8, speed: 1.3, glow: 1.5, particles: { kind: 'rise', color: 0x8ad8ff, count: 24, size: 0.016 } }),
  x_toxic: X('Toxic Bloom', 'toxic', 0x0a1a06, 0x3a8a14, 0x9aff3a, { scale: 8, speed: 1, glow: 1.3, particles: { kind: 'rise', color: 0x9aff3a, count: 18, size: 0.014 } }),
  x_venom: X('Venom', 'toxic', 0x12041a, 0x6a1a8a, 0x3aff9a, { scale: 12, speed: 0.8, glow: 1.3 }),
  x_synthwave: X('Synthwave', 'synth', 0x14042a, 0xff3a8a, 0x3af0ff, { scale: 8, speed: 1, glow: 1.4 }),
  x_damascus: X('Damascus', 'damascus', 0x2a2d33, 0x9aa3ad, 0xffffff, { scale: 7, speed: 0.8, glow: 0.5, metal: 1 }),
  x_royal: X('Royal Damascus', 'damascus', 0x1a0a2a, 0xd9a824, 0xfff0a0, { scale: 10, speed: 0.6, glow: 0.8, metal: 1 }),
  x_pixel: X('Pixel Shift', 'pixels', 0x1a1a3a, 0x3a8aff, 0xff3a8a, { scale: 8, speed: 1, glow: 1 }),
};

export const EXCLUSIVE_IDS = Object.keys(EXCLUSIVE_SKINS);
