'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { Vault } = require('../src/main/vault/vault');
const { normalizeRecoveryKey, generateRecoveryKey } = require('../src/main/vault/recoveryKey');

const FAST_KDF = { name: 'scrypt', N: 2 ** 10, r: 8, p: 1 };

function tmpVault() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pom-vault-'));
  return new Vault(path.join(dir, 'pomkeeper.keys.json'), { kdf: FAST_KDF });
}

test('recovery key format and normalization', () => {
  const key = generateRecoveryKey();
  assert.match(key, /^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){5}$/);
  assert.equal(normalizeRecoveryKey(key.toLowerCase().replace(/-/g, ' ')), key);
  assert.equal(normalizeRecoveryKey('OOOO-IIII-LLLL-0000-1111-2222'), '0000-1111-1111-0000-1111-2222');
  assert.equal(normalizeRecoveryKey('too-short'), null);
  assert.equal(normalizeRecoveryKey('UUUU-UUUU-UUUU-UUUU-UUUU-UUUU'), null); // U is not in the alphabet
});

test('create, then unlock with password and with recovery key', async () => {
  const v = tmpVault();
  const { dk, recoveryKey } = await v.create('correct horse battery');
  assert.equal(dk.length, 32);
  assert.deepEqual(await v.unlockWithPassword('correct horse battery'), dk);
  assert.deepEqual(await v.unlockWithRecoveryKey(recoveryKey.toLowerCase()), dk);
});

test('header file never contains the data key or secrets in plain form', async () => {
  const v = tmpVault();
  const { dk, recoveryKey } = await v.create('correct horse battery');
  const raw = fs.readFileSync(v.headerPath, 'utf8');
  assert.ok(!raw.includes(dk.toString('hex')));
  assert.ok(!raw.includes(dk.toString('base64')));
  assert.ok(!raw.includes('correct horse battery'));
  assert.ok(!raw.includes(recoveryKey));
});

test('wrong password and wrong recovery key are rejected', async () => {
  const v = tmpVault();
  await v.create('correct horse battery');
  await assert.rejects(v.unlockWithPassword('wrong password!'), { code: 'BAD_PASSWORD' });
  await assert.rejects(v.unlockWithRecoveryKey(generateRecoveryKey()), { code: 'BAD_RECOVERY' });
  await assert.rejects(v.unlockWithRecoveryKey('nope'), { code: 'BAD_RECOVERY_FORMAT' });
});

test('changing password keeps the same data key; old password stops working', async () => {
  const v = tmpVault();
  const { dk, recoveryKey } = await v.create('correct horse battery');
  await v.setPassword(dk, 'a brand new password');
  assert.deepEqual(await v.unlockWithPassword('a brand new password'), dk);
  await assert.rejects(v.unlockWithPassword('correct horse battery'), { code: 'BAD_PASSWORD' });
  assert.deepEqual(await v.unlockWithRecoveryKey(recoveryKey), dk);
});

test('regenerating the recovery key invalidates the old one', async () => {
  const v = tmpVault();
  const { dk, recoveryKey } = await v.create('correct horse battery');
  const fresh = await v.regenerateRecoveryKey(dk);
  assert.notEqual(fresh, recoveryKey);
  assert.deepEqual(await v.unlockWithRecoveryKey(fresh), dk);
  await assert.rejects(v.unlockWithRecoveryKey(recoveryKey), { code: 'BAD_RECOVERY' });
});

test('refuses to overwrite an existing vault', async () => {
  const v = tmpVault();
  await v.create('correct horse battery');
  await assert.rejects(v.create('another password'), { code: 'EXISTS' });
});
