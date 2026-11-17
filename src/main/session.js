'use strict';

/**
 * Holds the app's locked/unlocked state (spec 4.2). The data key and the open
 * database live only here, in the main process, and only while unlocked.
 */

const path = require('node:path');
const { EventEmitter } = require('node:events');
const { Vault, VaultError } = require('./vault/vault');
const { openDatabase, getSettings, setSettings } = require('./db/database');

const MIN_PASSWORD_LENGTH = 10;
const LOCK_MIN = 5;
const LOCK_MAX = 240;

class Session extends EventEmitter {
  constructor(dataDir, { kdf, now = () => Date.now() } = {}) {
    super();
    this.dataDir = dataDir;
    this.dbPath = path.join(dataDir, 'pomkeeper.db');
    this.vault = new Vault(path.join(dataDir, 'pomkeeper.keys.json'), kdf ? { kdf } : {});
    this.now = now;
    this.db = null;
    this.dk = null;
    this.pendingRecoveryKey = null; // shown once after setup or regeneration
    this.failedAttempts = 0;
    this.lockedUntil = 0;
    this.idleTimer = null;
  }

  get state() {
    if (!this.vault.exists()) return 'new';
    return this.db ? 'unlocked' : 'locked';
  }

  static validatePassword(pw) {
    if (typeof pw !== 'string' || pw.length < MIN_PASSWORD_LENGTH) {
      throw new VaultError('WEAK_PASSWORD', `Use at least ${MIN_PASSWORD_LENGTH} characters.`);
    }
  }

  async setup(password) {
    Session.validatePassword(password);
    const { dk, recoveryKey } = await this.vault.create(password);
    this.#open(dk);
    this.pendingRecoveryKey = recoveryKey;
    return recoveryKey;
  }

  #checkThrottle() {
    const wait = this.lockedUntil - this.now();
    if (wait > 0) {
      throw new VaultError('THROTTLED', `Too many attempts. Try again in ${Math.ceil(wait / 1000)} seconds.`);
    }
  }

  #recordFailure() {
    this.failedAttempts += 1;
    if (this.failedAttempts >= 5) {
      // 30s after the 5th miss, doubling for each miss after that (max 15 min).
      const delay = Math.min(30_000 * 2 ** (this.failedAttempts - 5), 15 * 60_000);
      this.lockedUntil = this.now() + delay;
    }
  }

  async unlock(password) {
    this.#checkThrottle();
    let dk;
    try {
      dk = await this.vault.unlockWithPassword(password);
    } catch (err) {
      if (err.code === 'BAD_PASSWORD') this.#recordFailure();
      throw err;
    }
    this.failedAttempts = 0;
    this.#open(dk);
  }

  /** Recovery unlock must be followed by a new master password (spec 4.1). */
  async recover(recoveryKey, newPassword) {
    Session.validatePassword(newPassword);
    this.#checkThrottle();
    let dk;
    try {
      dk = await this.vault.unlockWithRecoveryKey(recoveryKey);
    } catch (err) {
      if (err.code === 'BAD_RECOVERY') this.#recordFailure();
      throw err;
    }
    this.failedAttempts = 0;
    await this.vault.setPassword(dk, newPassword);
    this.#open(dk);
  }

  async changePassword(currentPassword, newPassword) {
    this.#requireUnlocked();
    Session.validatePassword(newPassword);
    await this.vault.unlockWithPassword(currentPassword);
    await this.vault.setPassword(this.dk, newPassword);
  }

  async regenerateRecoveryKey(currentPassword) {
    this.#requireUnlocked();
    await this.vault.unlockWithPassword(currentPassword);
    this.pendingRecoveryKey = await this.vault.regenerateRecoveryKey(this.dk);
    return this.pendingRecoveryKey;
  }

  clearPendingRecoveryKey() {
    this.pendingRecoveryKey = null;
  }

  #open(dk) {
    this.db = openDatabase(this.dbPath, dk);
    this.dk = dk;
    this.touch();
    this.emit('unlocked');
  }

  #requireUnlocked() {
    if (!this.db) throw new VaultError('LOCKED', 'POM Keeper is locked.');
  }

  lock() {
    clearTimeout(this.idleTimer);
    this.idleTimer = null;
    if (this.db) this.db.close();
    this.db = null;
    if (this.dk) this.dk.fill(0);
    this.dk = null;
    this.pendingRecoveryKey = null;
    this.emit('locked');
  }

  settings() {
    this.#requireUnlocked();
    return getSettings(this.db);
  }

  lockMinutes() {
    const n = parseInt(this.db ? getSettings(this.db).lock_minutes : '30', 10);
    return Number.isFinite(n) ? Math.min(Math.max(n, LOCK_MIN), LOCK_MAX) : 30;
  }

  saveSettings(values) {
    this.#requireUnlocked();
    const clean = {};
    if ('lock_minutes' in values) {
      const n = parseInt(values.lock_minutes, 10);
      if (!Number.isFinite(n) || n < LOCK_MIN || n > LOCK_MAX) {
        throw new VaultError('INVALID', `Auto-lock must be between ${LOCK_MIN} and ${LOCK_MAX} minutes.`);
      }
      clean.lock_minutes = n;
    }
    if ('backups_keep' in values) {
      const n = parseInt(values.backups_keep, 10);
      if (!Number.isFinite(n) || n < 1 || n > 100) {
        throw new VaultError('INVALID', 'Keep between 1 and 100 backups.');
      }
      clean.backups_keep = n;
    }
    if ('auto_backup' in values) clean.auto_backup = values.auto_backup ? 1 : 0;
    if ('backup_folder' in values) clean.backup_folder = values.backup_folder || '';
    setSettings(this.db, clean);
    this.touch();
  }

  /** One-way flags the setup flow records (not user-editable settings). */
  setFlag(key) {
    this.#requireUnlocked();
    if (!['recovery_confirmed', 'setup_complete'].includes(key)) throw new Error(`Unknown flag ${key}`);
    setSettings(this.db, { [key]: 1 });
  }

  /** Any user activity resets the idle timer. */
  touch() {
    if (!this.db) return;
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => this.lock(), this.lockMinutes() * 60_000);
    if (this.idleTimer.unref) this.idleTimer.unref();
  }
}

module.exports = { Session, MIN_PASSWORD_LENGTH, LOCK_MIN, LOCK_MAX };
