// Ranks, levels and daily quests: the definitions both sides need. The numbers
// that decide what you earn live on the server only (server/progression.js).

// ---------------------------------------------------------------- ranks

// Six ranks, no tiers. Each takes 200 points to climb, and the last climb, from Diamond to Champion, takes 500.
export const RANKS = [
  { id: 'bronze', name: 'Bronze', color: '#c0753a', floor: 0 },
  { id: 'silver', name: 'Silver', color: '#b9c3cf', floor: 200 },
  { id: 'gold', name: 'Gold', color: '#f0b43c', floor: 400 },
  { id: 'platinum', name: 'Platinum', color: '#4fd1c5', floor: 600 },
  { id: 'diamond', name: 'Diamond', color: '#6aa8ff', floor: 800 },
  { id: 'champion', name: 'Champion', color: '#d65cff', floor: 1300 },
];

/** Position in the rank ladder (0 = Bronze ... 5 = Champion), to tell promotions from demotions. */
export function rankStep(points) {
  const p = Math.max(0, Math.floor(points || 0));
  let step = 0;
  while (step + 1 < RANKS.length && p >= RANKS[step + 1].floor) step++;
  return step;
}

/**
 * Everything a menu needs to show for a number of rank points:
 * { id, name, label, color, floor, ceiling (null for Champion), progress (0-1), nextLabel }
 */
export function rankInfo(points) {
  const p = Math.max(0, Math.floor(points || 0));
  const rank = RANKS[rankStep(p)], next = RANKS[rankStep(p) + 1];
  if (!next) return { ...rank, label: rank.name, ceiling: null, progress: 1, nextLabel: null };
  return { ...rank, label: rank.name, ceiling: next.floor, progress: (p - rank.floor) / (next.floor - rank.floor), nextLabel: next.name };
}

// ---------------------------------------------------------------- levels

// Level n needs 125 * n * (n - 1) XP in total: 250 for level 2, 750 for level 3, 1500 for level 4...
export const xpForLevel = (level) => 125 * level * (level - 1);
export function levelFromXp(xp) {
  return Math.max(1, Math.floor((1 + Math.sqrt(1 + (4 * Math.max(0, xp || 0)) / 125)) / 2));
}

// ---------------------------------------------------------------- daily quests

// stat: which per-match number the quest counts (see matchStats in server/progression.js)
// team: only offered to players who can actually do it (a quest list never has more than one of these)
export const QUESTS = {
  kills_10: { label: 'Get 10 kills', stat: 'kills', target: 10, reward: 150 },
  headshots_3: { label: 'Get 3 headshot kills', stat: 'headshots', target: 3, reward: 150 },
  wins_2: { label: 'Win 2 matches', stat: 'wins', target: 2, reward: 250 },
  played_3: { label: 'Play 3 matches', stat: 'played', target: 3, reward: 150 },
  rounds_8: { label: 'Win 8 rounds', stat: 'roundsWon', target: 8, reward: 200 },
  utility_5: { label: 'Use 5 utilities', stat: 'utilities', target: 5, reward: 120 },
  objective_60: { label: 'Spend 60 seconds on the objective', stat: 'objSecs', target: 60, reward: 150 },
  plants_3: { label: 'Plant 3 breach charges', stat: 'plants', target: 3, reward: 150, team: 'attack' },
  reinforce_5: { label: 'Reinforce 5 walls', stat: 'reinforced', target: 5, reward: 150, team: 'defense' },
  barricade_3: { label: 'Build 3 barricades', stat: 'barricades', target: 3, reward: 150, team: 'defense' },
};
export const QUEST_COUNT = 3;
export const QUEST_LIFETIME_MS = 24 * 60 * 60 * 1000;
