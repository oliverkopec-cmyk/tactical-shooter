// Talks to the account API. The login itself lives in an httpOnly cookie the
// browser sends automatically, so no token is ever handled here.

import { settings, onSettingsChange } from './settings.js';

async function call(method, path, body) {
  try {
    const res = await fetch(`/api/${path}`, {
      method,
      credentials: 'same-origin',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    return res.ok ? data : { error: data.error || `Server error (${res.status}).` };
  } catch {
    return { error: 'Could not reach the server.' };
  }
}

export const getSession = () => call('GET', 'session');
export const signUp = (username, password) => call('POST', 'signup', { username, password });
export const logIn = (username, password) => call('POST', 'login', { username, password });
export const logOut = () => call('POST', 'logout');

/** Save setting changes to the account, batched so dragging a slider sends one request. */
export function syncSettingsToAccount(isLoggedIn) {
  let timer = null;
  onSettingsChange(() => {
    if (!isLoggedIn()) return;
    clearTimeout(timer);
    timer = setTimeout(() => call('PUT', 'settings', { settings }), 600);
  });
}

/** Equip a skin on a gun (skin null = default look). Returns { account } or { error }. */
export const equipSkin = (weapon, skin) => call('PUT', 'equip/skin', { weapon, skin });
/** Equip an operator for their side; they also become the one shown in the main menu. */
export const equipOperator = (operator) => call('PUT', 'equip/operator', { operator });

/** Local test database only: adds Money so the shop can be tried. */
export const devMoney = () => call('POST', 'dev/money');

/** Buy an operator with Money. The server checks the price, your Money and ownership. */
export const buyOperator = (operator) => call('POST', 'operators/buy', { operator });

/** Open the crate. The server charges the Money and draws a skin on a gun or a charm: { account, result } or { error }. */
export const openCrate = (kind = 'crate') => call('POST', kind === 'christmas' ? 'crates/christmas/open' : 'crates/open');

/** What the shop sells right now (daily items, Limited skins, the crate), with this account's prices. */
export const getShop = () => call('GET', 'shop');
/** Buy a daily item or a Limited skin by its id: { account, bought, shop } or { error }. */
export const buyShopItem = (id) => call('POST', 'shop/buy', { id });

// ---------------------------------------------------------------- friends
export const getFriends = () => call('GET', 'friends');
export const searchPlayers = (q) => call('GET', `friends/search?q=${encodeURIComponent(q)}`);
export const sendFriendRequest = (username) => call('POST', 'friends/request', { username });
export const answerFriendRequest = (id, accept) => call('POST', 'friends/respond', { id, accept });
export const removeFriend = (id) => call('POST', 'friends/remove', { id });

/** Equip a charm on a gun (charm null = take it off). Returns { account } or { error }. */
export const equipCharm = (weapon, charm) => call('PUT', 'equip/charm', { weapon, charm });
