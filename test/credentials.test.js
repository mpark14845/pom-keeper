'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const { openDatabase } = require('../src/main/db/database');
const people = require('../src/main/repos/entities');
const acc = require('../src/main/repos/accounts');
const cred = require('../src/main/repos/credentials');

function freshDb(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pom-cred-'));
  const db = openDatabase(path.join(dir, 'pomkeeper.db'), crypto.randomBytes(32));
  t.after(() => db.close());
  return db;
}

test('passwords: save, link to any record, list without secrets', (t) => {
  const db = freshDb(t);
  const chase = people.save(db, 'companies', { name: 'Chase' });
  const chk = acc.saveAccount(db, { nickname: 'Joint checking', type_code: 'checking', company_id: chase });
  const sarah = people.save(db, 'family', { name: 'Sarah' });

  const a = cred.save(db, {
    title: 'Chase online banking',
    website_url: 'chase.com',
    username: 'mpark',
    password: '  s3cret with spaces ',
    pin: '1234',
    link: `account:${chk}`,
  });
  cred.save(db, { title: 'Sarah email', password: 'x', link: `family_member:${sarah}`, include_in_print: '0' });
  cred.save(db, { title: 'Wi-Fi', password: 'hunter2' });

  const rows = cred.list(db);
  assert.deepEqual(rows.map((r) => r.title), ['Chase online banking', 'Sarah email', 'Wi-Fi']);
  assert.equal(rows[0].link.name, 'Joint checking');
  assert.equal(rows[0].link.href, `/accounts/${chk}`);
  assert.equal(rows[0].has_password, 1);
  assert.equal(rows[0].has_pin, 1);
  assert.ok(!('password' in rows[0]), 'list never carries the password');
  assert.ok(!('pin' in rows[0]));
  assert.equal(rows[1].include_in_print, 0);
  assert.equal(rows[2].link, null);

  assert.equal(cred.secret(db, a, 'password'), '  s3cret with spaces ');
  assert.equal(cred.secret(db, a, 'pin'), '1234');
  assert.throws(() => cred.secret(db, a, 'notes'), { code: 'INVALID' });

  assert.deepEqual(cred.list(db, { linkedType: 'account', linkedId: chk }).map((r) => r.title), ['Chase online banking']);
  const opts = cred.linkOptions(db);
  assert.deepEqual(opts.map((o) => [o.type, o.items.length]), [['account', 1], ['company', 1], ['contact', 0], ['family_member', 1]]);
});

test('passwords: validation and unlinking', (t) => {
  const db = freshDb(t);
  assert.throws(() => cred.save(db, { password: 'x' }), { field: 'title' });
  assert.throws(() => cred.save(db, { title: 'X', link: 'account:999' }), { field: 'link' });
  assert.throws(() => cred.save(db, { title: 'X', link: 'settings:1' }), { field: 'link' });
  assert.throws(() => cred.save(db, { title: 'X', pin: '1'.repeat(51) }), { field: 'pin' });

  const co = people.save(db, 'companies', { name: 'Fidelity' });
  const id = cred.save(db, { title: 'NetBenefits', link: `company:${co}` });
  cred.save(db, { id, title: 'NetBenefits', link: '' });
  assert.equal(cred.get(db, id).linked_type, null);
  cred.remove(db, id);
  assert.equal(cred.get(db, id), null);
});

test('notes: categories, print flag, ordering', (t) => {
  const db = freshDb(t);
  people.save(db, 'notes', { title: 'Cash', category: 'location', body: 'Top drawer of the desk' });
  people.save(db, 'notes', { title: 'Will', category: 'legal', body: 'Fire safe in the closet', include_in_print: '0' });
  people.save(db, 'notes', { title: 'First steps', category: 'instructions' });
  const notes = people.listNotes(db);
  assert.deepEqual(notes.map((n) => n.title), ['First steps', 'Will', 'Cash']);
  assert.equal(notes.find((n) => n.title === 'Will').include_in_print, 0);
  assert.equal(notes.find((n) => n.title === 'Cash').include_in_print, 1);
  assert.throws(() => people.save(db, 'notes', { title: '' }), { field: 'title' });
  assert.throws(() => people.save(db, 'notes', { title: 'X', category: 'misc' }), { field: 'category' });
  assert.deepEqual(people.deleteImpact(db, 'notes', notes[0].id), {});
  people.remove(db, 'notes', notes[0].id);
  assert.equal(people.listNotes(db).length, 2);
});
