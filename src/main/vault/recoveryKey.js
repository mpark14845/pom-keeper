'use strict';

const crypto = require('node:crypto');

// Crockford base32: no I, L, O or U, so the key is easy to read and type.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const KEY_LENGTH = 24; // 24 chars x 5 bits = 120 bits of randomness

function generateRecoveryKey() {
  const bytes = crypto.randomBytes(KEY_LENGTH);
  let out = '';
  for (let i = 0; i < KEY_LENGTH; i++) out += ALPHABET[bytes[i] & 31];
  return formatRecoveryKey(out);
}

function formatRecoveryKey(raw) {
  return raw.match(/.{1,4}/g).join('-');
}

/**
 * Normalize what a person typed: ignore case, spaces and dashes, and map the
 * look-alike letters Crockford base32 leaves out (O→0, I/L→1).
 * Returns the canonical dashed form, or null if it can't be a valid key.
 */
function normalizeRecoveryKey(input) {
  if (typeof input !== 'string') return null;
  const cleaned = input
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
  if (cleaned.length !== KEY_LENGTH) return null;
  for (const ch of cleaned) if (!ALPHABET.includes(ch)) return null;
  return formatRecoveryKey(cleaned);
}

module.exports = { generateRecoveryKey, normalizeRecoveryKey, KEY_LENGTH };
