// Account rules shared by the sign-up form and the server.

import { OPERATORS } from './operators.js';

export const USERNAME_MIN = 3;
export const USERNAME_MAX = 16;
export const PASSWORD_MIN = 6;
export const PASSWORD_MAX = 72; // bcrypt only uses the first 72 bytes

/** Returns an error message, or '' if the username is allowed. */
export function usernameError(name) {
  if (typeof name !== 'string') return 'Enter a username.';
  if (name.length < USERNAME_MIN || name.length > USERNAME_MAX) return `Usernames are ${USERNAME_MIN}-${USERNAME_MAX} characters.`;
  if (!/^[A-Za-z0-9_.-]+$/.test(name)) return 'Usernames can use letters, numbers, _ . and - only.';
  return '';
}

export function passwordError(password) {
  if (typeof password !== 'string' || password.length < PASSWORD_MIN) return `Passwords need at least ${PASSWORD_MIN} characters.`;
  if (new TextEncoder().encode(password).length > PASSWORD_MAX) return `Passwords can be at most ${PASSWORD_MAX} characters.`;
  return '';
}

/** Operators every account owns. Operators with a `price` have to be bought. */
export function isFreeOperator(id) {
  return !!OPERATORS[id] && !OPERATORS[id].price;
}

/** Everything the account can play: the free operators plus the ones it bought. */
export function ownedOperatorIds(purchased = []) {
  return Object.keys(OPERATORS).filter((id) => isFreeOperator(id) || purchased.includes(id));
}
