// What the client gets to see about its own account.

import { ownedOperatorIds } from '../shared/account.js';
import { sanitizeSettings } from '../shared/settings.js';
import { QUESTS } from '../shared/progression.js';

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
    ownedSkins: row.owned_skins,
    equippedSkins: row.equipped_skins,
    settings: sanitizeSettings(row.settings),
    quests: questsOf(row),
    stats: row.stats || {},
  };
}
