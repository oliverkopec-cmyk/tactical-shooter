// What the client gets to see about its own account.

import { ownedOperatorIds } from '../shared/account.js';
import { sanitizeSettings } from '../shared/settings.js';
import { QUESTS } from '../shared/progression.js';
import { SKINS, SKIN_IDS, FREE_SKINS } from '../shared/skins.js';
import { WEAPONS } from '../shared/weapons.js';
import { OPERATORS } from '../shared/operators.js';

// Developer switches (see Accounts): UNLOCK_ALL_SKINS=1 unlocks every skin, and on a local
// test database there is a button that adds Money so the shop can be tried.
let unlockAll = false;
let devTools = false;
export function configureProfile(opts) { unlockAll = !!opts.unlockAll; devTools = !!opts.devTools; }
export const skinsUnlocked = () => unlockAll;
export const devToolsEnabled = () => devTools;

/** Every skin the account may equip: the free ones, what it bought, or all of them in dev mode. */
export function ownedSkinsOf(row) {
  if (unlockAll) return [...SKIN_IDS];
  const bought = Array.isArray(row.owned_skins) ? row.owned_skins.filter((id) => SKINS[id]) : [];
  return [...new Set([...FREE_SKINS, ...bought])];
}

/** { weaponId: skinId }, with anything unknown or not owned dropped. */
export function equippedSkinsOf(row) {
  const owned = new Set(ownedSkinsOf(row));
  const out = {};
  for (const [weapon, skin] of Object.entries(row.equipped_skins || {})) {
    if (WEAPONS[weapon] && owned.has(skin)) out[weapon] = skin;
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
    ownedSkins: ownedSkinsOf(row),
    equippedSkins: equippedSkinsOf(row),
    equippedOperators: equippedOperatorsOf(row),
    skinsUnlocked: unlockAll,
    devTools,
    settings: sanitizeSettings(row.settings),
    quests: questsOf(row),
    stats: row.stats || {},
  };
}
