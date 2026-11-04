// The Christmas event (Stage M): every date and rule, shared so the client can show what the server enforces. The
// server's clock and server/christmas.js decide everything that matters; a player's own clock changes nothing.
//
// All dates are Sydney time. Sydney is on daylight time (UTC+11) for the whole event, so the offset is written in.
// To run the event in another year, change the three dates here.

import { CHARMS, CHARM_IDS } from './charms.js';
import { SKINS } from './skins.js';
import { CHRISTMAS_CRATE_SKINS, CHRISTMAS_LIMITED_IDS } from './christmasSkins.js';

const DAY = 24 * 60 * 60 * 1000;
const sydney = (date) => Date.parse(`${date}T00:00:00+11:00`);

export const CHRISTMAS = {
  themeFrom: sydney('2026-11-20'),    // the menu theme, countdown and crate start, and so do the presents
  day: sydney('2026-12-25'),          // Christmas Day: the countdown reaches zero
  themeUntil: sydney('2027-01-03'),   // the end of 2 January: everything goes, and what you got stays yours
  presentDays: 35,                    // the first present is 35 days before Christmas, the last on Christmas Eve
  skinDays: 7,                        // the last 7 presents hold a limited skin and skinMoney
  skinMoney: 1500,
  money: { min: 1000, max: 1250, step: 50 },
  chances: { money: 0.5, charm: 0.3, crate: 0.2 },   // what a present before the last 7 days holds
  crate: {
    price: 1200,
    refund: 600,
    odds: { common: 0.55, rare: 0.28, epic: 0.14, legendary: 0.03 },
    charmChance: 0.4,
  },
};

/** Added to a present's day to give it an id that can't clash with an admin gift's. */
export const PRESENT_BASE = 1000000;

const ids = (table, filter) => Object.keys(table).filter((id) => filter(table[id]));
export const CHRISTMAS_CHARM_IDS = CHARM_IDS.filter((id) => CHARMS[id].source === 'christmas');

/** What the Christmas crate holds: { skins: { rarity: [ids] }, charms: { rarity: [ids] } }. The limited skins are never in it. */
export function christmasCrateItems() {
  const byRarity = (list, table) => {
    const out = { common: [], rare: [], epic: [], legendary: [] };
    for (const id of list) out[table[id].rarity].push(id);
    return out;
  };
  return { skins: byRarity(ids(CHRISTMAS_CRATE_SKINS, () => true), SKINS), charms: byRarity(CHRISTMAS_CHARM_IDS, CHARMS) };
}

/** The menu theme, countdown and crate are on. */
export const christmasOn = (now) => now >= CHRISTMAS.themeFrom && now < CHRISTMAS.themeUntil;

/** Whole days until Christmas, counting today: 35 all day on 20 November, 1 on Christmas Eve, 0 or less from Christmas Day. */
export const daysBefore = (now) => Math.ceil((CHRISTMAS.day - now) / DAY);

/** The presents that have opened by now (a day number each, oldest first). Missed days stay open until the event ends. */
export function presentsOpen(now) {
  if (!christmasOn(now)) return [];
  const out = [];
  for (let d = CHRISTMAS.presentDays; d >= Math.max(1, daysBefore(now)); d--) out.push(d);
  return out;
}

/** The limited skin in a present, or null. Each of the last 7 days has its own. */
export const presentSkin = (day) => (day >= 1 && day <= CHRISTMAS.skinDays ? CHRISTMAS_LIMITED_IDS[CHRISTMAS.skinDays - day] : null);

/** A present's date, like "18 December". */
export function presentDate(day) {
  const d = new Date(CHRISTMAS.day - day * DAY + 11 * 60 * 60 * 1000);
  return `${d.getUTCDate()} ${d.getUTCMonth() === 10 ? 'November' : 'December'}`;
}

/** When the next thing changes (the next midnight in Sydney during the event), or null when it is over. */
export function nextChange(now) {
  if (now < CHRISTMAS.themeFrom) return CHRISTMAS.themeFrom;
  if (now >= CHRISTMAS.themeUntil) return null;
  return CHRISTMAS.themeFrom + (Math.floor((now - CHRISTMAS.themeFrom) / DAY) + 1) * DAY;
}

/** What the menu needs to know. `claimed`: the days this account has already opened. */
export function christmasState(now, claimed = []) {
  const done = new Set(claimed);
  return {
    now,
    theme: christmasOn(now),
    christmasAt: CHRISTMAS.day,
    nextChange: nextChange(now),
    presents: presentsOpen(now).filter((d) => !done.has(d)).map((day) => ({ day, date: presentDate(day), special: day <= CHRISTMAS.skinDays })),
  };
}

/** The line under the top bar: "Christmas in 12d 04h 33m 10s", then "Merry Christmas!". */
export function countdownText(now) {
  const s = Math.floor((CHRISTMAS.day - now) / 1000);
  if (s <= 0) return 'Merry Christmas!';
  const pad = (n) => String(n).padStart(2, '0');
  return `Christmas in ${Math.floor(s / 86400)}d ${pad(Math.floor((s % 86400) / 3600))}h ${pad(Math.floor((s % 3600) / 60))}m ${pad(s % 60)}s`;
}
