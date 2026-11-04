// Gun charms: small objects that hang from the side of a gun and swing as you move.
// 40 original charms in the same four rarities as skins. Models are drawn in code on the
// client (client/src/charmModels.js); this file is the list both sides agree on.
//
// You get charms two ways:
//   - levelling up: one charm every CHARM_LEVEL_STEP levels, from the CHARM_LEVEL_REWARDS list
//   - the crate in the shop (shared/shop.js), which holds every charm as well as every crate skin
//   - Christmas (`source: 'christmas'`, Stage M): only from the Christmas crate and the Christmas presents
// One charm can be equipped per gun, and other players see it.

export const CHARMS = {
  // ---------------------------------------------------------------- common
  dog_tag: { name: 'Dog Tag', rarity: 'common' },
  brass_bullet: { name: 'Brass Bullet', rarity: 'common' },
  dice: { name: 'Lucky Dice', rarity: 'common' },
  padlock: { name: 'Padlock', rarity: 'common' },
  key: { name: 'Old Key', rarity: 'common' },
  gear: { name: 'Cog', rarity: 'common' },
  clover: { name: 'Four-Leaf Clover', rarity: 'common' },
  horseshoe: { name: 'Horseshoe', rarity: 'common' },
  feather: { name: 'Feather', rarity: 'common' },
  coin: { name: 'Gold Coin', rarity: 'common' },
  compass: { name: 'Compass', rarity: 'common' },
  nut: { name: 'Hex Nut', rarity: 'common' },
  // ---------------------------------------------------------------- rare
  skull: { name: 'Little Skull', rarity: 'rare' },
  medal: { name: 'Service Medal', rarity: 'rare' },
  tiny_shield: { name: 'Tiny Shield', rarity: 'rare' },
  star: { name: 'Gold Star', rarity: 'rare' },
  heart: { name: 'Heart', rarity: 'rare' },
  moon: { name: 'Crescent Moon', rarity: 'rare' },
  mini_grenade: { name: 'Mini Grenade', rarity: 'rare' },
  lightning: { name: 'Lightning Bolt', rarity: 'rare' },
  anchor: { name: 'Anchor', rarity: 'rare' },
  // ---------------------------------------------------------------- epic
  crown: { name: 'Crown', rarity: 'epic' },
  gem: { name: 'Cut Diamond', rarity: 'epic' },
  fang: { name: 'Dragon Fang', rarity: 'epic' },
  orb: { name: 'Crystal Orb', rarity: 'epic' },
  rocket: { name: 'Toy Rocket', rarity: 'epic' },
  flame: { name: 'Living Flame', rarity: 'epic' },
  // ---------------------------------------------------------------- legendary
  polish_eagle: { name: 'White Eagle', rarity: 'legendary' },
  golden_dragon: { name: 'Golden Dragon', rarity: 'legendary' },
  galaxy: { name: 'Galaxy Orb', rarity: 'legendary' },
  // ---------------------------------------------------------------- Christmas (Stage M)
  xmas_bauble: { name: 'Bauble', rarity: 'common', source: 'christmas' },
  xmas_bell: { name: 'Jingle Bell', rarity: 'common', source: 'christmas' },
  xmas_candy_cane: { name: 'Candy Cane', rarity: 'common', source: 'christmas' },
  xmas_snowflake: { name: 'Snowflake', rarity: 'common', source: 'christmas' },
  xmas_stocking: { name: 'Little Stocking', rarity: 'rare', source: 'christmas' },
  xmas_gingerbread: { name: 'Gingerbread Person', rarity: 'rare', source: 'christmas' },
  xmas_present: { name: 'Mini Present', rarity: 'rare', source: 'christmas' },
  xmas_snowman: { name: 'Tiny Snowman', rarity: 'epic', source: 'christmas' },
  xmas_reindeer: { name: 'Reindeer', rarity: 'epic', source: 'christmas' },
  xmas_star: { name: 'Christmas Star', rarity: 'legendary', source: 'christmas' },
};

export const CHARM_IDS = Object.keys(CHARMS);

/** Charms handed out for levelling up, in order: the first at level CHARM_LEVEL_STEP, the next at twice that, and so on. */
export const CHARM_LEVEL_STEP = 2;
export const CHARM_LEVEL_REWARDS = [
  'dog_tag', 'brass_bullet', 'dice', 'padlock', 'key', 'gear', 'clover', 'horseshoe', 'feather', 'coin', 'compass', 'nut',
  'skull', 'medal', 'tiny_shield',
];

/** The level at which a level reward unlocks, or null if the charm is crate-only. */
export function charmUnlockLevel(id) {
  const i = CHARM_LEVEL_REWARDS.indexOf(id);
  return i < 0 ? null : (i + 1) * CHARM_LEVEL_STEP;
}

/** The charms a player of this level has earned by levelling up. */
export function charmsFromLevel(level) {
  return CHARM_LEVEL_REWARDS.filter((id) => charmUnlockLevel(id) <= (level || 1));
}

export const RARITY_ORDER = ['common', 'rare', 'epic', 'legendary'];

/** Charms in the crate, grouped by rarity (Christmas charms have their own crate). */
export function charmCrateContents() {
  const out = { common: [], rare: [], epic: [], legendary: [] };
  for (const id of CHARM_IDS) if (!CHARMS[id].source) out[CHARMS[id].rarity].push(id);
  return out;
}

/** Charms sorted by rarity, then name, for menus. */
export function charmList() {
  return CHARM_IDS.map((id) => ({ id, ...CHARMS[id] }))
    .sort((a, b) => RARITY_ORDER.indexOf(a.rarity) - RARITY_ORDER.indexOf(b.rarity) || a.name.localeCompare(b.name));
}
