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
