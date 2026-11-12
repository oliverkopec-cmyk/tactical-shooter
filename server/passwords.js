// Password hashing (Stage C2): PBKDF2-SHA256 through Web Crypto, which works the same in Node and in Cloudflare
// Workers. Older accounts still have a bcrypt hash: it is checked with bcryptjs (plain JavaScript, so it runs in a
// Worker too) and replaced with a PBKDF2 hash on that player's next successful login (see server/api.js).
//
// Stored as: pbkdf2_sha256$<iterations>$<salt, base64>$<hash, base64>
//
// 100,000 iterations is the most Cloudflare Workers allow. Checking one takes about 17 ms of CPU there (Stage C0).

import bcrypt from 'bcryptjs';

export const PBKDF2_ITERATIONS = 100_000;
const PREFIX = 'pbkdf2_sha256';
const SALT_BYTES = 16;
const HASH_BITS = 256;

const toB64 = (bytes) => btoa(String.fromCharCode(...bytes));
const fromB64 = (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

async function derive(password, salt, iterations) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, HASH_BITS));
}

/** Same length and same bytes, taking the same time whatever the answer. */
function equal(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export const isBcrypt = (stored) => typeof stored === 'string' && /^\$2[aby]\$\d\d\$/.test(stored);
export const isPbkdf2 = (stored) => typeof stored === 'string' && stored.startsWith(`${PREFIX}$`);

export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = await derive(password, salt, PBKDF2_ITERATIONS);
  return `${PREFIX}$${PBKDF2_ITERATIONS}$${toB64(salt)}$${toB64(hash)}`;
}

/**
 * Check a password against what is stored. { ok, upgrade }: upgrade is a new PBKDF2 hash to store in place of an
 * old bcrypt one (only when the password was right), otherwise null.
 */
export async function verifyPassword(password, stored) {
  if (typeof password !== 'string') return { ok: false, upgrade: null };
  if (isPbkdf2(stored)) {
    const [, iter, salt, hash] = stored.split('$');
    const iterations = Number(iter);
    if (!Number.isInteger(iterations) || iterations < 1 || iterations > PBKDF2_ITERATIONS) return { ok: false, upgrade: null };
    let expected, saltBytes;
    try { expected = fromB64(hash); saltBytes = fromB64(salt); } catch { return { ok: false, upgrade: null }; }
    const ok = equal(await derive(password, saltBytes, iterations), expected);
    return { ok, upgrade: ok && iterations < PBKDF2_ITERATIONS ? await hashPassword(password) : null };
  }
  if (isBcrypt(stored)) {
    const ok = await bcrypt.compare(password, stored);
    return { ok, upgrade: ok ? await hashPassword(password) : null };
  }
  return { ok: false, upgrade: null };
}

// Checked against when the username doesn't exist, so a wrong username takes as long to reject as a wrong password
let dummy = null;
export async function rejectSlowly(password) {
  dummy ||= hashPassword(crypto.getRandomValues(new Uint8Array(16)).join(''));
  await verifyPassword(String(password || ''), await dummy);
  return { ok: false, upgrade: null };
}

/** The password functions, run right here (Node). The Worker runs them inside a Durable Object instead (worker/index.js). */
export const localPasswords = { hash: hashPassword, verify: verifyPassword, reject: rejectSlowly };
