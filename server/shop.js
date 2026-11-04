// The shop on the server (Stage 2K): what is on sale right now and what buying it does. Every price, item and
// result is worked out here from shared/shop.js; the client only says which item it wants. Money only.

import crypto from 'node:crypto';
import { CRATE } from '../shared/skins.js';
import { SHOP, SHOP_GUNS, shopDay, shopDayStart, dailyShop, limitedNow, rollMystery, crateItems } from '../shared/shop.js';
import { CHRISTMAS, christmasOn, christmasCrateItems } from '../shared/christmas.js';
import { ownsSkin, ownsCharm } from './profile.js';

const ownedAll = (row, skin) => Array.isArray(row.owned_skins) && row.owned_skins.includes(skin);

/** What the shop shows this account now (prices for packs already partly owned are reduced). */
export function shopState(row, now = Date.now(), eventNow = now) {
  const day = shopDay(now);
  const daily = dailyShop(day).map((it) => ({ ...it, ...priceFor(row, it) }));
  const limited = limitedNow(now).map((it) => ({ ...it, owned: ownedAll(row, it.skin) }));
  return {
    now, day, resetsAt: shopDayStart(day + 1), daily, limited,
    crate: { price: CRATE.price, refund: CRATE.refund, odds: CRATE.odds, charmChance: CRATE.charmChance, contents: crateItems() },
    christmasCrate: christmasOn(eventNow) ? { ...CHRISTMAS.crate, contents: christmasCrateItems(), until: CHRISTMAS.themeUntil - (eventNow - now) } : null,
    rules: { prices: SHOP.prices, packPrice: SHOP.packPrice, packGuns: SHOP.packGuns },
  };
}

/** For a daily item: which of its guns the account still lacks, and what it costs now. */
function priceFor(row, it) {
  const missing = it.guns.filter((g) => !ownsSkin(row, g, it.skin));
  const price = !missing.length ? 0 : it.pack ? Math.round((it.price * missing.length) / it.guns.length / 10) * 10 : it.price;
  return { missing, owned: missing.length === 0, price, fullPrice: it.price };
}

/**
 * Buy an item: a daily item (`d<day>-<n>`) or a Limited skin (`l-<skin>`), only while it is on sale.
 * Returns { add: [owned_skins entries], price, skin, guns } or { error }.
 */
export function purchase(row, id, now = Date.now()) {
  const key = String(id || '');
  if (key.startsWith('l-')) {
    const it = limitedNow(now).find((l) => l.id === key);
    if (!it) return { error: 'That skin is not on sale any more.' };
    if (ownedAll(row, it.skin)) return { error: 'You already own that skin.' };
    return { add: [it.skin], price: it.price, skin: it.skin, guns: 'all' };
  }
  const it = dailyShop(shopDay(now)).find((d) => d.id === key);
  if (!it) return { error: 'That item has left the shop. Have a look at today\'s.' };
  const { missing, price } = priceFor(row, it);
  if (!missing.length) return { error: 'You already own that.' };
  return { add: missing.map((g) => `${g}:${it.skin}`), price, skin: it.skin, guns: missing };
}

/** What a draw from a crate means for an account: the result, and the entries to add (nothing but the refund if it's a duplicate). */
function settle(row, r, crate) {
  if (r.kind === 'charm') {
    const duplicate = ownsCharm(row, r.charm);
    return { result: { ...r, duplicate, refund: duplicate ? crate.refund : 0, price: crate.price }, skins: [], charms: duplicate ? [] : [r.charm] };
  }
  const duplicate = ownsSkin(row, r.weapon, r.skin);
  return { result: { ...r, duplicate, refund: duplicate ? crate.refund : 0, price: crate.price }, skins: duplicate ? [] : [`${r.weapon}:${r.skin}`], charms: [] };
}

/** Open the crate for an account row: { result, money delta, entries to add }. */
export function openCrate(row) {
  return settle(row, rollMystery((n) => crypto.randomInt(n)), CRATE);
}

/** Open the Christmas crate (also opened by the presents): a Christmas skin on a random gun, or a Christmas charm. */
export function rollChristmasCrate(row, rand = (n) => crypto.randomInt(n)) {
  return settle(row, rollMystery(rand, SHOP_GUNS, CHRISTMAS.crate, christmasCrateItems()), CHRISTMAS.crate);
}

