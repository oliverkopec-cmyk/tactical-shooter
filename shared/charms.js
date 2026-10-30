// Gun charms: small objects that hang from the side of a gun and swing as you move.
// 30 original charms in the same four rarities as skins. Models are drawn in code on the
// client (client/src/charmModels.js); this file is the list both sides agree on.
//
// You get charms two ways:
//   - levelling up: one charm every CHARM_LEVEL_STEP levels, from the CHARM_LEVEL_REWARDS list
//   - the charm crate in the shop: any of the 30, same odds, price and duplicate refund as a skin crate
// One charm can be equipped per gun, and other players see it.

import { CRATE } from './skins.js';

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

/** The charm crate costs and pays out like a skin crate (Money only; a duplicate refunds half). */
export const CHARM_CRATE = { price: CRATE.price, refund: CRATE.refund, odds: CRATE.odds };

export const RARITY_ORDER = ['common', 'rare', 'epic', 'legendary'];

/** Charms in the crate, grouped by rarity. */
export function charmCrateContents() {
  const out = { common: [], rare: [], epic: [], legendary: [] };
  for (const id of CHARM_IDS) out[CHARMS[id].rarity].push(id);
  return out;
}

/** Pick a charm. `randInt(n)` must return a whole number in 0..n-1 (the server passes a secure one). */
export function rollCharmCrate(randInt) {
  const roll = randInt(10000);
  let acc = 0, rarity = 'legendary';
  for (const [r, p] of Object.entries(CHARM_CRATE.odds)) {
    acc += Math.round(p * 10000);
    if (roll < acc) { rarity = r; break; }
  }
  const pool = charmCrateContents()[rarity];
  return { rarity, charm: pool[randInt(pool.length)] };
}

/** Charms sorted by rarity, then name, for menus. */
export function charmList() {
  return CHARM_IDS.map((id) => ({ id, ...CHARMS[id] }))
    .sort((a, b) => RARITY_ORDER.indexOf(a.rarity) - RARITY_ORDER.indexOf(b.rarity) || a.name.localeCompare(b.name));
}
