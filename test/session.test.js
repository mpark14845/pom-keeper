'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const { Session } = require('../src/main/session');
const { openDatabase } = require('../src/main/db/database');

const FAST_KDF = { name: 'scrypt', N: 2 ** 10, r: 8, p: 1 };
const PW = 'correct horse battery';

function tmpSession(opts = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pom-session-'));
  return new Session(dir, { kdf: FAST_KDF, ...opts });
}

test('first run: setup creates an encrypted, migrated database', async (t) => {
  const s = tmpSession();
  t.after(() => s.lock());
  assert.equal(s.state, 'new');
  const rk = await s.setup(PW);
  assert.equal(s.state, 'unlocked');
  assert.equal(s.pendingRecoveryKey, rk);

  const types = s.db.prepare('SELECT count(*) n FROM account_types').get().n;
  assert.ok(types > 20);
  assert.equal(s.db.prepare("SELECT counts_in_net_worth c FROM account_types WHERE code='term_life'").get().c, 0);
  assert.equal(s.settings().lock_minutes, '30');

  s.db.prepare("INSERT INTO notes (title, body) VALUES ('Will', 'In the fire safe')").run();
  s.lock();
  const bytes = fs.readFileSync(s.dbPath);
  assert.ok(!bytes.includes('fire safe'), 'note text must not be readable on disk');
  assert.ok(!bytes.subarray(0, 16).toString('latin1').startsWith('SQLite format 3'));
});

test('lock and unlock round-trip keeps data', async (t) => {
  const s = tmpSession();
  t.after(() => s.lock());
  await s.setup(PW);
  s.db.prepare("INSERT INTO companies (name, kind) VALUES ('Fidelity', 'brokerage')").run();
  s.lock();
  assert.equal(s.state, 'locked');
  assert.equal(s.db, null);
  await s.unlock(PW);
  assert.equal(s.db.prepare('SELECT name FROM companies').get().name, 'Fidelity');
});

test('database cannot be opened with the wrong key', async () => {
  const s = tmpSession();
  await s.setup(PW);
  s.lock();
  assert.throws(() => openDatabase(s.dbPath, crypto.randomBytes(32)), { code: 'BAD_KEY' });
});

test('recovery key unlock requires and sets a new password', async (t) => {
  const s = tmpSession();
  t.after(() => s.lock());
  const rk = await s.setup(PW);
  s.lock();
  await assert.rejects(s.recover(rk, 'short'), { code: 'WEAK_PASSWORD' });
  await s.recover(rk, 'my new long password');
  assert.equal(s.state, 'unlocked');
  s.lock();
  await assert.rejects(s.unlock(PW), { code: 'BAD_PASSWORD' });
  await s.unlock('my new long password');
});

test('weak passwords are refused at setup', async () => {
  const s = tmpSession();
  await assert.rejects(s.setup('short'), { code: 'WEAK_PASSWORD' });
  assert.equal(s.state, 'new');
});

test('throttles after 5 wrong passwords', async () => {
  let now = 1_000_000;
  const s = tmpSession({ now: () => now });
  await s.setup(PW);
  s.lock();
  for (let i = 0; i < 5; i++) await assert.rejects(s.unlock('wrong password'), { code: 'BAD_PASSWORD' });
  await assert.rejects(s.unlock(PW), { code: 'THROTTLED' });
  now += 30_001;
  await s.unlock(PW);
  s.lock();
});

test('change password and regenerate recovery key from an unlocked session', async (t) => {
  const s = tmpSession();
  t.after(() => s.lock());
  const oldRk = await s.setup(PW);
  await assert.rejects(s.changePassword('wrong password', 'another long password'), { code: 'BAD_PASSWORD' });
  await s.changePassword(PW, 'another long password');
  const newRk = await s.regenerateRecoveryKey('another long password');
  s.lock();
  await assert.rejects(s.recover(oldRk, 'yet another password'), { code: 'BAD_RECOVERY' });
  await s.recover(newRk, 'yet another password');
});

test('settings validation and idle auto-lock', async (t) => {
  const s = tmpSession();
  t.after(() => s.lock());
  await s.setup(PW);
  assert.throws(() => s.saveSettings({ lock_minutes: 2 }), { code: 'INVALID' });
  assert.throws(() => s.saveSettings({ lock_minutes: 500 }), { code: 'INVALID' });
  s.saveSettings({ lock_minutes: 45, auto_backup: false, backups_keep: 5, backup_folder: 'D:\\Backups' });
  assert.deepEqual(
    { ...s.settings() },
    { lock_minutes: '45', auto_backup: '0', backups_keep: '5', backup_folder: 'D:\\Backups' }
  );

  t.mock.timers.enable({ apis: ['setTimeout'] });
  s.touch();
  t.mock.timers.tick(44 * 60_000);
  assert.equal(s.state, 'unlocked');
  s.touch(); // activity resets the clock
  t.mock.timers.tick(44 * 60_000);
  assert.equal(s.state, 'unlocked');
  t.mock.timers.tick(60_001);
  assert.equal(s.state, 'locked');
});
