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

function seeded(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pom-acc-'));
  const db = openDatabase(path.join(dir, 'pomkeeper.db'), crypto.randomBytes(32));
  t.after(() => db.close());
  const ids = {
    fidelity: people.save(db, 'companies', { name: 'Fidelity', kind: 'brokerage' }),
    chase: people.save(db, 'companies', { name: 'Chase', kind: 'bank' }),
    mike: people.save(db, 'family', { name: 'Mike' }),
    sarah: people.save(db, 'family', { name: 'Sarah' }),
    trust: people.save(db, 'family', { name: 'Park Family Trust', kind: 'trust' }),
  };
  ids.dana = people.save(db, 'contacts', { name: 'Dana Advisor', company_id: ids.fidelity });
  ids.svc = people.save(db, 'contacts', { name: 'Chase Service', company_id: ids.chase });
  return { db, ids };
}

const value = (db, id, month, dollars) =>
  db.prepare('INSERT INTO monthly_values (account_id, month, value_cents) VALUES (?, ?, ?)').run(id, month, dollars * 100);

test('saves an account with contacts, owners and beneficiaries', (t) => {
  const { db, ids } = seeded(t);
  const id = acc.saveAccount(db, {
    nickname: ' Mike 401(k) ',
    type_code: '401k',
    company_id: String(ids.fidelity),
    account_number: '12345678',
    contacts: [{ contact_id: ids.dana, role: 'advisor' }, { contact_id: '' }],
    owners: [{ family_member_id: ids.mike, role: 'owner' }],
    beneficiaries: [
      { family_member_id: ids.sarah, level: 'primary', share_pct: '100' },
      { family_member_id: ids.trust, level: 'contingent', share_pct: '100%' },
    ],
  });
  const a = acc.getAccount(db, id);
  assert.equal(a.nickname, 'Mike 401(k)');
  assert.equal(a.company_name, 'Fidelity');
  assert.equal(a.category_label, 'Retirement');
  assert.deepEqual(a.contacts.map((c) => [c.name, c.role]), [['Dana Advisor', 'advisor']]);
  assert.deepEqual(a.owners.map((o) => o.name), ['Mike']);
  assert.deepEqual(a.beneficiaries.map((b) => [b.name, b.level, b.share_pct]), [
    ['Sarah', 'primary', 100],
    ['Park Family Trust', 'contingent', 100],
  ]);

  // Editing replaces the links.
  acc.saveAccount(db, { id, nickname: 'Mike 401(k)', type_code: '401k', company_id: ids.fidelity, owners: [] });
  const b = acc.getAccount(db, id);
  assert.equal(b.contacts.length, 0);
  assert.equal(b.beneficiaries.length, 0);
});

test('validation: name, type, company, closed date, amounts', (t) => {
  const { db } = seeded(t);
  assert.throws(() => acc.saveAccount(db, { type_code: 'checking' }), { field: 'nickname' });
  assert.throws(() => acc.saveAccount(db, { nickname: 'X', type_code: 'piggy' }), { field: 'type_code' });
  assert.throws(() => acc.saveAccount(db, { nickname: 'X', type_code: 'checking', company_id: 999 }), { field: 'company_id' });
  assert.throws(() => acc.saveAccount(db, { nickname: 'X', type_code: 'checking', status: 'closed' }), { field: 'closed_on' });
  assert.throws(
    () => acc.saveAccount(db, { nickname: 'X', type_code: 'checking', opened_on: '2020-05-01', status: 'closed', closed_on: '2019-01-01' }),
    { field: 'closed_on' }
  );
  assert.throws(() => acc.saveAccount(db, { nickname: 'X', type_code: 'term_life', face_amount: 'lots' }), { field: 'face_amount' });
  const id = acc.saveAccount(db, { nickname: 'Term policy', type_code: 'term_life', face_amount: '$1,000,000' });
  assert.equal(acc.getAccount(db, id).face_amount_cents, 100000000);
  // Reopening clears the closed date.
  const c = acc.saveAccount(db, { nickname: 'Old', type_code: 'savings', status: 'closed', closed_on: '2024-03-31' });
  acc.saveAccount(db, { id: c, nickname: 'Old', type_code: 'savings', status: 'open', closed_on: '2024-03-31' });
  assert.equal(acc.getAccount(db, c).closed_on, null);
});

test('a loan can be secured by an asset, not by another loan or itself', (t) => {
  const { db } = seeded(t);
  const car = acc.saveAccount(db, { nickname: 'Honda CR-V', type_code: 'vehicle' });
  const loan = acc.saveAccount(db, { nickname: 'Car loan', type_code: 'auto_loan', secured_by_account_id: car });
  assert.equal(acc.getAccount(db, loan).securedBy.nickname, 'Honda CR-V');
  assert.deepEqual(acc.getAccount(db, car).securing.map((s) => s.nickname), ['Car loan']);

  const card = acc.saveAccount(db, { nickname: 'Visa', type_code: 'credit_card' });
  assert.throws(
    () => acc.saveAccount(db, { nickname: 'Loan 2', type_code: 'personal_loan', secured_by_account_id: card }),
    { field: 'secured_by_account_id' }
  );
  // An asset can't be "secured by" anything; the field is ignored.
  const house = acc.saveAccount(db, { nickname: 'House', type_code: 'home', secured_by_account_id: car });
  assert.equal(acc.getAccount(db, house).secured_by_account_id, null);

  // Deleting the car leaves the loan, unsecured.
  acc.removeAccount(db, car);
  assert.equal(acc.getAccount(db, loan).secured_by_account_id, null);
});

test('groups by type, company and contact with signed totals', (t) => {
  const { db, ids } = seeded(t);
  const k401 = acc.saveAccount(db, { nickname: '401k', type_code: '401k', company_id: ids.fidelity, contacts: [{ contact_id: ids.dana }] });
  const chk = acc.saveAccount(db, { nickname: 'Checking', type_code: 'checking', company_id: ids.chase, contacts: [{ contact_id: ids.svc }] });
  const visa = acc.saveAccount(db, { nickname: 'Visa', type_code: 'credit_card', company_id: ids.chase, contacts: [{ contact_id: ids.svc }] });
  const term = acc.saveAccount(db, { nickname: 'Term', type_code: 'term_life', face_amount: 500000 });
  const old = acc.saveAccount(db, { nickname: 'Old savings', type_code: 'savings', status: 'closed', closed_on: '2023-01-31' });
  value(db, k401, '2026-09', 100000);
  value(db, k401, '2026-10', 120000);
  value(db, chk, '2026-10', 5000);
  value(db, visa, '2026-10', 2000);
  value(db, term, '2026-10', 0);
  value(db, old, '2022-12', 9999);

  const byType = acc.groupAccounts(db, 'type');
  assert.deepEqual(byType.groups.map((g) => g.title), [
    'Assets / Current Cash',
    'Assets / Retirement',
    'Liabilities / Revolving',
    'Info only / Insurance',
  ]);
  assert.equal(byType.groups[1].total, 120000 * 100); // latest month wins
  assert.equal(byType.groups[2].total, -2000 * 100);
  assert.deepEqual(acc.summary(byType.rows), { assets: 125000 * 100, liabilities: 2000 * 100, net: 123000 * 100, hasValues: true });

  const withClosed = acc.groupAccounts(db, 'type', { includeClosed: true });
  assert.equal(withClosed.rows.length, 5);
  assert.equal(acc.summary(withClosed.rows).net, 123000 * 100); // closed accounts don't count

  const byCompany = acc.groupAccounts(db, 'company');
  assert.deepEqual(byCompany.groups.map((g) => [g.title, g.rows.length]), [['Chase', 2], ['Fidelity', 1], ['No company', 1]]);

  const byContact = acc.groupAccounts(db, 'contact');
  assert.deepEqual(byContact.groups.map((g) => [g.title, g.rows.length]), [['Chase Service', 2], ['Dana Advisor', 1], ['No contact', 1]]);

  const flat = acc.groupAccounts(db, 'account');
  assert.deepEqual(flat.groups[0].rows.map((r) => r.nickname), ['401k', 'Checking', 'Term', 'Visa']);
});

test('family and company views of accounts; masking', (t) => {
  const { db, ids } = seeded(t);
  const a = acc.saveAccount(db, {
    nickname: 'House',
    type_code: 'home',
    owners: [{ family_member_id: ids.trust, role: 'owner' }],
    beneficiaries: [{ family_member_id: ids.sarah }],
  });
  assert.deepEqual(acc.accountsForFamily(db, ids.trust).owns.map((r) => r.id), [a]);
  assert.deepEqual(acc.accountsForFamily(db, ids.sarah).beneficiaryOf.map((r) => r.id), [a]);
  assert.equal(people.listFamily(db).find((f) => f.id === ids.trust).owns, 1);
  assert.equal(acc.mask('1234 5678 9012'), '••••9012');
  assert.equal(acc.mask('12'), '12');
  assert.equal(acc.mask(null), '');
});

test('delete impact and removal unlinks passwords', (t) => {
  const { db } = seeded(t);
  const id = acc.saveAccount(db, { nickname: 'Checking', type_code: 'checking' });
  value(db, id, '2026-10', 10);
  db.prepare("INSERT INTO credentials (title, linked_type, linked_id) VALUES ('Online banking', 'account', ?)").run(id);
  assert.deepEqual(acc.accountImpact(db, id), { values: 1, securing: 0, linkedPasswords: 1 });
  acc.removeAccount(db, id);
  assert.equal(acc.getAccount(db, id), null);
  assert.equal(db.prepare('SELECT count(*) n FROM monthly_values').get().n, 0);
  assert.equal(db.prepare('SELECT linked_id FROM credentials').get().linked_id, null);
});
