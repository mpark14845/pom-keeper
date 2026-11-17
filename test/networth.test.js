'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const { openDatabase } = require('../src/main/db/database');
const acc = require('../src/main/repos/accounts');
const nw = require('../src/main/repos/networth');

function freshDb(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pom-nw-'));
  const db = openDatabase(path.join(dir, 'pomkeeper.db'), crypto.randomBytes(32));
  t.after(() => db.close());
  return db;
}

const $ = (dollars) => dollars * 100;

test('month helpers', () => {
  assert.equal(nw.addMonths('2026-01', -1), '2025-12');
  assert.equal(nw.addMonths('2026-11', 2), '2027-01');
  assert.deepEqual(nw.monthsBetween('2026-11', '2027-02'), ['2026-11', '2026-12', '2027-01', '2027-02']);
  assert.equal(nw.lastCompletedMonth(new Date(2026, 10, 17)), '2026-10');
  assert.equal(nw.lastCompletedMonth(new Date(2026, 0, 5)), '2025-12');
  assert.ok(nw.isMonth('2026-10'));
  assert.ok(!nw.isMonth('2026-13'));
});

test('carry-forward, before-first-entry, closed accounts and exclusions', (t) => {
  const db = freshDb(t);
  const k401 = acc.saveAccount(db, { nickname: '401k', type_code: '401k' });
  const visa = acc.saveAccount(db, { nickname: 'Visa', type_code: 'credit_card' });
  const term = acc.saveAccount(db, { nickname: 'Term', type_code: 'term_life' });
  const old = acc.saveAccount(db, { nickname: 'Old savings', type_code: 'savings' });

  nw.saveMonth(db, '2026-01', [
    { account_id: k401, value: '100,000' },
    { account_id: visa, value: '$1,500' },
    { account_id: term, value: '500000' },
    { account_id: old, value: '9000' },
  ]);
  nw.saveMonth(db, '2026-03', [{ account_id: k401, value: '110000' }]);
  // Close the old savings in February.
  acc.saveAccount(db, { id: old, nickname: 'Old savings', type_code: 'savings', status: 'closed', closed_on: '2026-02-14' });

  const s = nw.series(db, '2025-12', '2026-04');
  assert.deepEqual(
    s.map((m) => [m.month, m.assets / 100, m.liabilities / 100, m.net / 100]),
    [
      ['2025-12', 0, 0, 0], //            before any entry
      ['2026-01', 109000, 1500, 107500], // 401k + savings - visa (term excluded)
      ['2026-02', 109000, 1500, 107500], // carried; savings still counts in its closing month
      ['2026-03', 110000, 1500, 108500], // new 401k value, savings now 0
      ['2026-04', 110000, 1500, 108500], // carried
    ]
  );
  assert.equal(s[1].byCategory.retirement, $(100000));
  assert.equal(s[1].byCategory.revolving, -$(1500));
  assert.equal(s[1].byCategory.insurance_info, undefined);
});

test('month grid shows entries, carried values and only accounts active that month', (t) => {
  const db = freshDb(t);
  const chk = acc.saveAccount(db, { nickname: 'Checking', type_code: 'checking', opened_on: '2025-06-01' });
  const late = acc.saveAccount(db, { nickname: 'New HSA', type_code: 'hsa', opened_on: '2026-09-10' });
  const closed = acc.saveAccount(db, { nickname: 'Gone', type_code: 'savings', status: 'closed', closed_on: '2026-08-31' });
  nw.saveMonth(db, '2026-07', [{ account_id: chk, value: 4000 }, { account_id: closed, value: 50 }]);
  nw.saveMonth(db, '2026-09', [{ account_id: late, value: 1000, note: 'first deposit' }]);

  const aug = nw.monthGrid(db, '2026-08');
  const names = aug.groups.flatMap((g) => g.rows.map((r) => r.nickname));
  assert.deepEqual(names, ['Checking', 'Gone']); // HSA not open yet
  const chkRow = aug.groups[0].rows.find((r) => r.nickname === 'Checking');
  assert.equal(chkRow.entry, null);
  assert.equal(chkRow.carriedCents, $(4000));
  assert.equal(chkRow.carriedFrom, '2026-07');
  assert.equal(chkRow.prevCents, $(4000));
  assert.ok(aug.groups[0].rows.find((r) => r.nickname === 'Gone').closesThisMonth);
  assert.equal(aug.entered, 0);

  const sep = nw.monthGrid(db, '2026-09');
  assert.deepEqual(sep.groups.flatMap((g) => g.rows.map((r) => r.nickname)), ['Checking', 'New HSA']);
  const hsa = sep.groups.find((g) => g.code === 'health_savings').rows[0];
  assert.equal(hsa.entry.value_cents, $(1000));
  assert.equal(hsa.entry.note, 'first deposit');
  assert.equal(sep.entered, 1);
  assert.equal(sep.totals.net, $(5000));

  assert.deepEqual(nw.missingFor(db, '2026-09').map((a) => a.nickname), ['Checking']);
});

test('saving: blanks remove an entry, bad amounts and inactive months are refused', (t) => {
  const db = freshDb(t);
  const chk = acc.saveAccount(db, { nickname: 'Checking', type_code: 'checking', opened_on: '2026-05-01' });
  nw.saveMonth(db, '2026-06', [{ account_id: chk, value: '2500.55' }]);
  assert.equal(db.prepare('SELECT value_cents FROM monthly_values').get().value_cents, 250055);
  nw.saveMonth(db, '2026-06', [{ account_id: chk, value: '2600' }]); // update, not duplicate
  assert.equal(db.prepare('SELECT count(*) n, max(value_cents) v FROM monthly_values').get().v, 260000);
  nw.saveMonth(db, '2026-06', [{ account_id: chk, value: '' }]);
  assert.equal(db.prepare('SELECT count(*) n FROM monthly_values').get().n, 0);

  assert.throws(() => nw.saveMonth(db, '2026-06', [{ account_id: chk, value: 'abc' }]), { field: `value-${chk}` });
  assert.throws(() => nw.saveMonth(db, '2026-06', [{ account_id: chk, value: '-5' }]), { code: 'INVALID' });
  assert.throws(() => nw.saveMonth(db, '2026-03', [{ account_id: chk, value: '5' }]), /wasn't open/);
  assert.throws(() => nw.saveMonth(db, '2999-01', [{ account_id: chk, value: '5' }]), /future/);
  assert.throws(() => nw.saveMonth(db, 'June', []), { code: 'INVALID' });
  assert.throws(() => nw.saveMonth(db, '2026-06', [{ account_id: 999, value: '5' }]), /no longer exists/);
});
