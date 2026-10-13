// Local password hashing with Node's built-in scrypt (no extra dependency). Format: scrypt$N$r$p$salt$hash (base64).
import crypto from 'node:crypto';

const N = 16384;
const R = 8;
const P = 1;
const KEYLEN = 64;

const scrypt = (pw, salt, n, r, p) => new Promise((resolve, reject) => {
  crypto.scrypt(String(pw).normalize('NFKC'), salt, KEYLEN, { N: n, r, p, maxmem: 64 * 1024 * 1024 }, (err, key) => (err ? reject(err) : resolve(key)));
});

export async function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(pw, salt, N, R, P);
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(pw, stored) {
  if (typeof stored !== 'string' || !stored.startsWith('scrypt$')) return false;
  const [, n, r, p, salt, hash] = stored.split('$');
  const expected = Buffer.from(hash, 'base64');
  const key = await scrypt(pw, Buffer.from(salt, 'base64'), Number(n), Number(r), Number(p));
  return key.length === expected.length && crypto.timingSafeEqual(key, expected);
}

/** Spend the same time as a real check when the user does not exist (prevents user-name probing by timing). */
let dummy;
export async function burnPasswordCheck(pw) {
  dummy ||= await hashPassword('not-a-real-password');
  await verifyPassword(pw, dummy);
}

/** Readable random temporary password that satisfies any policy the admin can configure. */
export function generateTemporaryPassword(length = 14) {
  const sets = ['ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghijkmnopqrstuvwxyz', '23456789', '!@#$%*-_=+?'];
  const all = sets.join('');
  const pick = (s) => s[crypto.randomInt(s.length)];
  const chars = sets.map(pick);
  while (chars.length < length) chars.push(pick(all));
  for (let i = chars.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [chars[i], chars[j]] = [chars[j], chars[i]]; }
  return chars.join('');
}
