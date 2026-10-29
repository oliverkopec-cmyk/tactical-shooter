// Ranks, levels and daily quests: the definitions both sides need. The numbers
// that decide what you earn live on the server only (server/progression.js).

// ---------------------------------------------------------------- ranks

export const RANK_POINTS_PER_TIER = 100;
const ROMAN = ['I', 'II', 'III'];

// Five ranks with three tiers each (I lowest), then Champion with no tiers.
export const RANKS = [
  { id: 'bronze', name: 'Bronze', color: '#c0753a' },
  { id: 'silver', name: 'Silver', color: '#b9c3cf' },
  { id: 'gold', name: 'Gold', color: '#f0b43c' },
  { id: 'platinum', name: 'Platinum', color: '#4fd1c5' },
  { id: 'diamond', name: 'Diamond', color: '#6aa8ff' },
];
export const CHAMPION = { id: 'champion', name: 'Champion', color: '#d65cff' };
const CHAMPION_AT = RANKS.length * 3 * RANK_POINTS_PER_TIER;   // 1500

/**
 * Everything a menu needs to show for a number of rank points:
 * { id, name, tier (1-3, 0 for Champion), label, color, floor, ceiling, progress (0-1), nextLabel }
 */
export function rankInfo(points) {
  const p = Math.max(0, Math.floor(points || 0));
  if (p >= CHAMPION_AT) {
    return { ...CHAMPION, tier: 0, label: 'Champion', floor: CHAMPION_AT, ceiling: null, progress: 1, nextLabel: null };
  }
  const step = Math.floor(p / RANK_POINTS_PER_TIER);        // 0..14
  const rank = RANKS[Math.floor(step / 3)], tier = (step % 3) + 1;
  const floor = step * RANK_POINTS_PER_TIER;
  const next = step + 1 >= RANKS.length * 3 ? CHAMPION.name : `${RANKS[Math.floor((step + 1) / 3)].name} ${ROMAN[(step + 1) % 3]}`;
  return {
    ...rank, tier, label: `${rank.name} ${ROMAN[tier - 1]}`,
    floor, ceiling: floor + RANK_POINTS_PER_TIER, progress: (p - floor) / RANK_POINTS_PER_TIER, nextLabel: next,
  };
}

/** Position in the rank ladder (0 = Bronze I ... 15 = Champion), to tell promotions from demotions. */
export const rankStep = (points) => Math.min(RANKS.length * 3, Math.floor(Math.max(0, points || 0) / RANK_POINTS_PER_TIER));

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
