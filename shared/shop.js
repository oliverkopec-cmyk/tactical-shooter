// The shop (Stage 2K): the daily shop, the Limited section and the one crate. Shared so the client can show the
// same rules it is held to, but the server decides everything that costs Money (server/shop.js).
//
// - Daily shop: every day at SHOP.resetHourUTC, SHOP.dailyCount skins are picked from the pool of 50
//   (DAILY_SKINS in shared/shopSkins.js) and sold for 24 hours. The pick depends only on the day, so every
//   player sees the same shop and it can't be rerolled. Each item is that skin for one gun, picked at random;
//   SHOP.packs of them are skin packs: the skin on SHOP.packGuns different guns, picked at random each time.
// - Limited: the skins in LIMITED, each on sale between its dates (UTC), owned on every gun once bought.
// - Prices are by rarity (SHOP.prices); a pack costs SHOP.packPrice times the single price.
// - Everything costs Money only, never Polish Money.

import { SKINS, CRATE, crateContents } from './skins.js';
import { charmCrateContents } from './charms.js';
import { WEAPONS } from './weapons.js';
import { DAILY_SKINS } from './shopSkins.js';

export const SHOP = {
  resetHourUTC: 0,          // a new daily shop every day at 00:00 UTC (11:00 in Sydney in summer, 10:00 in winter)
  dailyCount: 6,
  packs: 2,                 // how many of the daily items are skin packs
  packGuns: 5,
  prices: { rare: 3000, epic: 5000, legendary: 8000 },
  packPrice: 3,             // a 5-gun pack costs 3 times a single skin
};

// The Limited section. Dates are UTC days: on sale from the start of `from` until the start of `until`.
export const LIMITED = [
  { skin: 'l_firstfrost', price: 12000, from: '2026-11-03', until: '2026-11-11' },
  { skin: 'l_harvest', price: 12000, from: '2026-11-03', until: '2026-11-18' },
  { skin: 'l_launch', price: 15000, from: '2026-11-03', until: '2026-12-04' },
];

const DAY = 24 * 60 * 60 * 1000;
const OFFSET = SHOP.resetHourUTC * 60 * 60 * 1000;

/** Which shop day a time falls in (a whole number that goes up by one at every reset). */
export const shopDay = (ms) => Math.floor((ms - OFFSET) / DAY);
/** When a shop day starts (ms). */
export const shopDayStart = (day) => day * DAY + OFFSET;

/** Guns a shop skin can be sold for (not the ballistic shield, which has almost nothing to paint). */
export const SHOP_GUNS = Object.keys(WEAPONS).filter((id) => !WEAPONS[id].shield);

function random(seed) {
  let a = (seed * 2654435761) >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function shuffled(list, rnd) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

const POOL = Object.keys(DAILY_SKINS);
const FIRST_DAY = 20750;          // the shop's first day (late October 2026): each day's picks avoid the day before's
const picksCache = new Map();

/** The skins on sale on a day: a shuffle of the pool for that day, leaving out the day before's skins. */
function picksOf(day) {
  if (picksCache.has(day)) return picksCache.get(day);
  let prev = [];
  // Walk forward from the newest day already worked out (or from the first day): each day needs the one before
  const known = [...picksCache.keys()].filter((k) => k < day);
  for (let d = known.length ? Math.max(...known) + 1 : FIRST_DAY; d <= day; d++) {
    if (picksCache.has(d)) { prev = picksCache.get(d); continue; }
    const before = picksCache.get(d - 1) || (d > FIRST_DAY ? prev : []);
    const skip = new Set(before);
    const picks = shuffled(POOL, random(d * 7919 + 17)).filter((id) => !skip.has(id)).slice(0, SHOP.dailyCount);
    picksCache.set(d, picks);
    prev = picks;
  }
  if (picksCache.size > 400) for (const k of [...picksCache.keys()].sort((a, b) => a - b).slice(0, 200)) if (k < day - 2) picksCache.delete(k);
  return picksCache.get(day) || shuffled(POOL, random(day * 7919 + 17)).slice(0, SHOP.dailyCount);
}

/** The price of a daily item. */
export const dailyPrice = (skin, pack) => SHOP.prices[SKINS[skin].rarity] * (pack ? SHOP.packPrice : 1);

/**
 * The daily shop of a day: [{ id, skin, rarity, guns: [gun ids], pack, price }], most expensive first. Yesterday's
 * skins are left out where possible, so the shop changes every day.
 */
export function dailyShop(day) {
  const rnd = random(day * 104729 + 5);
  const picks = picksOf(day);
  const packSlots = new Set(shuffled([...picks.keys()], rnd).slice(0, SHOP.packs));
  const items = picks.map((skin, i) => {
    const pack = packSlots.has(i);
    const guns = shuffled(SHOP_GUNS, rnd).slice(0, pack ? SHOP.packGuns : 1);
    return { id: `d${day}-${i}`, skin, rarity: SKINS[skin].rarity, guns, pack, price: dailyPrice(skin, pack) };
  });
  return items.sort((a, b) => b.price - a.price);
}

/** The Limited skins on sale at this time: [{ id, skin, price, until (ms) }]. */
export function limitedNow(ms) {
  return LIMITED.filter((l) => SKINS[l.skin] && Date.parse(`${l.from}T00:00:00Z`) <= ms && ms < Date.parse(`${l.until}T00:00:00Z`))
    .map((l) => ({ id: `l-${l.skin}`, skin: l.skin, rarity: SKINS[l.skin].rarity, price: l.price, until: Date.parse(`${l.until}T00:00:00Z`) }));
}

// ---------------------------------------------------------------- the crate

/** What the crate holds: { skins: { rarity: [ids] }, charms: { rarity: [ids] } } (skins come on any gun). */
export const crateItems = () => ({ skins: crateContents(), charms: charmCrateContents() });

/**
 * Draw from the crate. `randInt(n)` must return a whole number in 0..n-1 (the server passes a secure one).
 * Returns { kind: 'gun', rarity, weapon, skin } or { kind: 'charm', rarity, charm }.
 */
export function rollMystery(randInt, guns = Object.keys(WEAPONS), crate = CRATE, items = crateItems()) {
  const roll = randInt(10000);
  let acc = 0, rarity = 'legendary';
  for (const [r, p] of Object.entries(crate.odds)) {
    acc += Math.round(p * 10000);
    if (roll < acc) { rarity = r; break; }
  }
  const { skins, charms } = items;
  const charm = charms[rarity].length && randInt(10000) < Math.round(crate.charmChance * 10000);
  if (charm) return { kind: 'charm', rarity, charm: charms[rarity][randInt(charms[rarity].length)] };
  return { kind: 'gun', rarity, weapon: guns[randInt(guns.length)], skin: skins[rarity][randInt(skins[rarity].length)] };
}
