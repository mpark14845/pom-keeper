'use strict';

const Database = require('better-sqlite3-multiple-ciphers');

const migrations = [require('./migrations/001_initial')];

class DatabaseKeyError extends Error {
  constructor() {
    super('The data file could not be opened with this key.');
    this.code = 'BAD_KEY';
  }
}

/**
 * Opens (or creates) the SQLCipher-encrypted database with the raw 32-byte
 * data key, then applies any pending migrations.
 */
function openDatabase(file, dk) {
  if (!Buffer.isBuffer(dk) || dk.length !== 32) throw new Error('Data key must be 32 bytes.');
  const db = new Database(file);
  try {
    db.pragma(`cipher='sqlcipher'`);
    db.pragma('legacy=4');
    db.pragma(`key="x'${dk.toString('hex')}'"`);
    try {
      db.prepare('SELECT count(*) FROM sqlite_master').get();
    } catch {
      throw new DatabaseKeyError();
    }
    db.pragma('foreign_keys = ON');
    db.pragma('journal_mode = DELETE'); // single file, no -wal sidecar to forget in backups
    migrate(db);
    return db;
  } catch (err) {
    db.close();
    throw err;
  }
}

function migrate(db) {
  const current = db.pragma('user_version', { simple: true });
  for (const m of migrations) {
    if (m.version <= current) continue;
    db.transaction(() => {
      m.up(db);
      db.pragma(`user_version = ${m.version}`);
    })();
  }
}

function getSettings(db) {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

function setSettings(db, values) {
  const stmt = db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  );
  db.transaction(() => {
    for (const [k, v] of Object.entries(values)) stmt.run(k, v == null ? null : String(v));
  })();
}

module.exports = { openDatabase, getSettings, setSettings, DatabaseKeyError, migrations };
