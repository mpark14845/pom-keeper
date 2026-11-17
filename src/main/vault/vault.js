'use strict';

/**
 * Key handling for POM Keeper (spec section 4.1).
 *
 * A random 256-bit Data Key (DK) encrypts the database. DK is stored twice in
 * the key header file, each copy wrapped with AES-256-GCM:
 *   - by a key derived (scrypt) from the master password
 *   - by a key derived (scrypt) from the recovery key
 * The header file holds no secret in plain form.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { generateRecoveryKey, normalizeRecoveryKey } = require('./recoveryKey');

const HEADER_VERSION = 1;
const AAD = Buffer.from('pomkeeper-dk-v1');
const DEFAULT_KDF = { name: 'scrypt', N: 2 ** 17, r: 8, p: 1 };

class VaultError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function deriveKey(secret, salt, kdf) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(
      Buffer.from(secret.normalize('NFKC'), 'utf8'),
      salt,
      32,
      { N: kdf.N, r: kdf.r, p: kdf.p, maxmem: 256 * kdf.N * kdf.r + 1024 * 1024 },
      (err, key) => (err ? reject(err) : resolve(key))
    );
  });
}

function wrap(dk, kek) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', kek, iv);
  cipher.setAAD(AAD);
  const ct = Buffer.concat([cipher.update(dk), cipher.final()]);
  return { iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ct: ct.toString('base64') };
}

function unwrap(entry, kek) {
  const decipher = crypto.createDecipheriv('aes-256-gcm', kek, Buffer.from(entry.iv, 'base64'));
  decipher.setAAD(AAD);
  decipher.setAuthTag(Buffer.from(entry.tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(entry.ct, 'base64')), decipher.final()]);
}

async function makeSlot(secret, dk, kdf) {
  const salt = crypto.randomBytes(16);
  const kek = await deriveKey(secret, salt, kdf);
  return { salt: salt.toString('base64'), ...wrap(dk, kek) };
}

async function openSlot(slot, secret, kdf) {
  const kek = await deriveKey(secret, Buffer.from(slot.salt, 'base64'), kdf);
  try {
    return unwrap(slot, kek);
  } catch {
    return null; // GCM auth failure = wrong secret
  }
}

function writeHeaderAtomic(file, header) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(header, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

class Vault {
  /** @param {string} headerPath full path to pomkeeper.keys.json */
  constructor(headerPath, { kdf = DEFAULT_KDF } = {}) {
    this.headerPath = headerPath;
    this.kdf = kdf;
  }

  exists() {
    return fs.existsSync(this.headerPath);
  }

  readHeader() {
    const header = JSON.parse(fs.readFileSync(this.headerPath, 'utf8'));
    if (header.version !== HEADER_VERSION) {
      throw new VaultError('UNSUPPORTED', `Unsupported key file version ${header.version}`);
    }
    return header;
  }

  /** First run: returns the new data key and the recovery key to show once. */
  async create(password) {
    if (this.exists()) throw new VaultError('EXISTS', 'A vault already exists here.');
    const dk = crypto.randomBytes(32);
    const recoveryKey = generateRecoveryKey();
    const header = {
      version: HEADER_VERSION,
      kdf: this.kdf,
      password: await makeSlot(password, dk, this.kdf),
      recovery: await makeSlot(recoveryKey, dk, this.kdf),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    fs.mkdirSync(path.dirname(this.headerPath), { recursive: true });
    writeHeaderAtomic(this.headerPath, header);
    return { dk, recoveryKey };
  }

  async unlockWithPassword(password) {
    const header = this.readHeader();
    const dk = await openSlot(header.password, password, header.kdf);
    if (!dk) throw new VaultError('BAD_PASSWORD', 'That password is not correct.');
    return dk;
  }

  async unlockWithRecoveryKey(input) {
    const key = normalizeRecoveryKey(input);
    if (!key) throw new VaultError('BAD_RECOVERY_FORMAT', 'A recovery key has 24 letters and numbers.');
    const header = this.readHeader();
    const dk = await openSlot(header.recovery, key, header.kdf);
    if (!dk) throw new VaultError('BAD_RECOVERY', 'That recovery key is not correct.');
    return dk;
  }

  /** Re-wraps the data key under a new password. Data is not re-encrypted. */
  async setPassword(dk, newPassword) {
    const header = this.readHeader();
    header.password = await makeSlot(newPassword, dk, header.kdf);
    header.updatedAt = new Date().toISOString();
    writeHeaderAtomic(this.headerPath, header);
  }

  /** Replaces the recovery key; the old one stops working. Returns the new key. */
  async regenerateRecoveryKey(dk) {
    const header = this.readHeader();
    const recoveryKey = generateRecoveryKey();
    header.recovery = await makeSlot(recoveryKey, dk, header.kdf);
    header.updatedAt = new Date().toISOString();
    writeHeaderAtomic(this.headerPath, header);
    return recoveryKey;
  }
}

module.exports = { Vault, VaultError, DEFAULT_KDF };
