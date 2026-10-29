// What the client gets to see about its own account.

import { ownedOperatorIds } from '../shared/account.js';
import { sanitizeSettings } from '../shared/settings.js';
import { QUESTS } from '../shared/progression.js';
import { DAILY_MONEY_CAP, earnedToday } from './progression.js';
import { SKINS } from '../shared/skins.js';
import { WEAPONS } from '../shared/weapons.js';
import { OPERATORS } from '../shared/operators.js';

// Developer switches (see Accounts): UNLOCK_ALL_SKINS=1 unlocks every skin, and on a local
// test database there is a button that adds Money so the shop can be tried.
let unlockAll = false;
let devTools = false;
export function configureProfile(opts) { unlockAll = !!opts.unlockAll; devTools = !!opts.devTools; }
export const skinsUnlocked = () => unlockAll;
export const devToolsEnabled = () => devTools;

/**
 * What skins the account owns. `owned_skins` holds two kinds of entry: a plain skin id
 * (bought in the old shop, owned on every gun) and "gun:skin" (won from that gun's crate).
 */
function ownership(row) {
  const everyGun = new Set(), perGun = new Map();
  for (const entry of Array.isArray(row.owned_skins) ? row.owned_skins : []) {
    if (typeof entry !== 'string') continue;
    const [a, b] = entry.split(':');
    if (b === undefined) { if (SKINS[a]) everyGun.add(a); }
    else if (WEAPONS[a] && SKINS[b]) { if (!perGun.has(a)) perGun.set(a, new Set()); perGun.get(a).add(b); }
  }
  return { everyGun, perGun };
}

/** Does the account own this skin for this gun? */
export function ownsSkin(row, weapon, skin) {
  if (!WEAPONS[weapon] || !SKINS[skin]) return false;
  if (unlockAll) return true;
  const { everyGun, perGun } = ownership(row);
  return everyGun.has(skin) || !!perGun.get(weapon)?.has(skin);
}

/** { gunId: [skinIds] } of the skins owned for each gun (only guns with at least one). */
export function ownedSkinsByGun(row) {
  const { everyGun, perGun } = ownership(row);
  const out = {};
  for (const gun of Object.keys(WEAPONS)) {
    const list = unlockAll ? Object.keys(SKINS) : [...new Set([...everyGun, ...(perGun.get(gun) || [])])];
    if (list.length) out[gun] = list;
  }
  return out;
}

/** { weaponId: skinId }, with anything unknown or not owned dropped. */
export function equippedSkinsOf(row) {
  const out = {};
  for (const [weapon, skin] of Object.entries(row.equipped_skins || {})) {
    if (ownsSkin(row, weapon, skin)) out[weapon] = skin;
  }
  return out;
}

/** { attack, defense, menu }: the operators the account chose to play and to show in the menu. */
export function equippedOperatorsOf(row) {
  const owned = new Set(ownedOperatorIds(row.owned_operators));
  const e = row.equipped_operators || {};
  const out = {};
  for (const side of ['attack', 'defense']) if (OPERATORS[e[side]]?.team === side && owned.has(e[side])) out[side] = e[side];
  if (owned.has(e.menu) && OPERATORS[e.menu]) out.menu = e.menu;
  return out;
}

/** The account's quest list with each quest's label, target and reward filled in from the definitions. */
export function questsOf(row) {
  const q = row.quests || {};
  return {
    expiresAt: q.expiresAt || null,
    list: (q.list || []).filter((x) => QUESTS[x.id]).map((x) => ({
      id: x.id, label: QUESTS[x.id].label, target: QUESTS[x.id].target, reward: QUESTS[x.id].reward,
      progress: Math.min(QUESTS[x.id].target, x.progress || 0), done: !!x.done,
    })),
  };
}

export function profileOf(row) {
  return {
    id: row.id,
    username: row.username,
    level: row.level,
    xp: row.xp,
    money: row.money,
    polishMoney: row.polish_money,
    rankPoints: row.rank_points,
    ownedOperators: ownedOperatorIds(row.owned_operators),
    ownedSkins: ownedSkinsByGun(row),
    equippedSkins: equippedSkinsOf(row),
    equippedOperators: equippedOperatorsOf(row),
    skinsUnlocked: unlockAll,
    dailyMoney: { earned: earnedToday(row.stats), limit: DAILY_MONEY_CAP },
    devTools,
    settings: sanitizeSettings(row.settings),
    quests: questsOf(row),
    stats: row.stats || {},
  };
}
