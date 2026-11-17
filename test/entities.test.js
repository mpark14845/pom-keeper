'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const { openDatabase } = require('../src/main/db/database');
const repo = require('../src/main/repos/entities');

function freshDb(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pom-repo-'));
  const db = openDatabase(path.join(dir, 'pomkeeper.db'), crypto.randomBytes(32));
  t.after(() => db.close());
  return db;
}

test('family: save, trim, defaults and validation', (t) => {
  const db = freshDb(t);
  const id = repo.save(db, 'family', { name: '  Sarah Park ', relationship: 'Spouse', email: '' });
  const row = repo.get(db, 'family', id);
  assert.equal(row.name, 'Sarah Park');
  assert.equal(row.kind, 'person');
  assert.equal(row.email, null);

  const trust = repo.save(db, 'family', { name: 'Park Family Trust', kind: 'trust' });
  assert.equal(repo.get(db, 'family', trust).kind, 'trust');

  assert.throws(() => repo.save(db, 'family', { name: '' }), { code: 'INVALID', field: 'name' });
  assert.throws(() => repo.save(db, 'family', { name: 'X', kind: 'dog' }), { field: 'kind' });
  assert.throws(() => repo.save(db, 'family', { name: 'X', email: 'not-an-email' }), { field: 'email' });
  assert.throws(() => repo.save(db, 'family', { name: 'X', date_of_birth: '12/01/1970' }), { field: 'date_of_birth' });

  repo.save(db, 'family', { id, name: 'Sarah J. Park', relationship: 'Spouse' });
  assert.equal(repo.get(db, 'family', id).name, 'Sarah J. Park');
  assert.deepEqual(repo.listFamily(db).map((f) => f.name), ['Sarah J. Park', 'Park Family Trust']);
});

test('contacts must belong to an existing company', (t) => {
  const db = freshDb(t);
  assert.throws(() => repo.save(db, 'contacts', { name: 'Jane', company_id: 999 }), { field: 'company_id' });
  assert.throws(() => repo.save(db, 'contacts', { name: 'Jane' }), { field: 'company_id' });

  const fid = repo.save(db, 'companies', { name: 'Fidelity', kind: 'brokerage', phone: '800-343-3548' });
  const jane = repo.save(db, 'contacts', { name: 'Jane Advisor', company_id: String(fid), email: 'jane@example.com' });
  const contacts = repo.listContacts(db);
  assert.equal(contacts.length, 1);
  assert.equal(contacts[0].company_name, 'Fidelity');
  assert.equal(repo.listCompanies(db)[0].contact_count, 1);
  assert.equal(repo.listContacts(db, { companyId: fid })[0].id, jane);
});

test('deleting a company removes its contacts but keeps linked passwords (unlinked)', (t) => {
  const db = freshDb(t);
  const fid = repo.save(db, 'companies', { name: 'Fidelity' });
  const cid = repo.save(db, 'contacts', { name: 'Jane', company_id: fid });
  db.prepare("INSERT INTO credentials (title, linked_type, linked_id) VALUES ('Fidelity login', 'company', ?)").run(fid);
  db.prepare("INSERT INTO credentials (title, linked_type, linked_id) VALUES ('Jane portal', 'contact', ?)").run(cid);

  assert.deepEqual(repo.deleteImpact(db, 'companies', fid), { accounts: 0, contacts: 1, linkedPasswords: 1 });
  repo.remove(db, 'companies', fid);

  assert.equal(repo.get(db, 'companies', fid), null);
  assert.equal(repo.get(db, 'contacts', cid), null);
  const creds = db.prepare('SELECT title, linked_type, linked_id FROM credentials ORDER BY id').all();
  assert.deepEqual(creds.map((c) => [c.title, c.linked_type, c.linked_id]), [
    ['Fidelity login', null, null],
    ['Jane portal', null, null],
  ]);
});

test('a company with accounts cannot be deleted', (t) => {
  const db = freshDb(t);
  const fid = repo.save(db, 'companies', { name: 'Chase', kind: 'bank' });
  db.prepare("INSERT INTO accounts (company_id, type_code, nickname) VALUES (?, 'checking', 'Joint checking')").run(fid);
  assert.throws(() => repo.remove(db, 'companies', fid), /still has 1 account/);
  assert.ok(repo.get(db, 'companies', fid));
});

test('deleting a family member removes their owner and beneficiary links', (t) => {
  const db = freshDb(t);
  const sarah = repo.save(db, 'family', { name: 'Sarah' });
  const acct = db.prepare("INSERT INTO accounts (type_code, nickname) VALUES ('401k', 'Mike 401k')").run().lastInsertRowid;
  db.prepare("INSERT INTO account_beneficiaries (account_id, family_member_id, level) VALUES (?, ?, 'primary')").run(acct, sarah);
  assert.equal(repo.deleteImpact(db, 'family', sarah).accounts, 1);
  repo.remove(db, 'family', sarah);
  assert.equal(db.prepare('SELECT count(*) n FROM account_beneficiaries').get().n, 0);
});

test('unknown record types are refused', (t) => {
  const db = freshDb(t);
  assert.throws(() => repo.save(db, 'settings', { key: 'x' }), { code: 'INVALID' });
});
