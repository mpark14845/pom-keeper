'use strict';

/**
 * Month-end values and the net worth rules (spec §6):
 *  1. An entry for the month is used as-is.
 *  2. Otherwise the latest earlier entry is carried forward.
 *  3. Before an account's first entry its value is 0.
 *  4. A closed account is 0 for every month after the month it closed.
 *  5. Types that don't count in net worth (term life) are excluded.
 * Liabilities are stored as positive amounts owed and subtracted.
 */

const { ValidationError } = require('./entities');

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;

function isMonth(ym) {
  return typeof ym === 'string' && MONTH.test(ym);
}

function addMonths(ym, n) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function monthOf(date) {
  return date ? String(date).slice(0, 7) : null;
}

function currentMonth(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/** The month whose "end of month" entry is due: last month. */
function lastCompletedMonth(now = new Date()) {
  return addMonths(currentMonth(now), -1);
}

function monthsBetween(from, to) {
  const out = [];
  for (let m = from; m <= to; m = addMonths(m, 1)) out.push(m);
  return out;
}

const ACCOUNTS = `
  SELECT a.id, a.nickname, a.status, a.opened_on, a.closed_on, a.account_number,
         t.label AS type_label, t.counts_in_net_worth, t.sort AS type_sort,
         c.code AS category_code, c.label AS category_label, c.grp, c.sort AS category_sort,
         co.name AS company_name
  FROM accounts a
  JOIN account_types t ON t.code = a.type_code
  JOIN categories c ON c.code = t.category_code
  LEFT JOIN companies co ON co.id = a.company_id`;

function loadEntries(db, toMonth) {
  const byAccount = new Map();
  for (const e of db
    .prepare('SELECT account_id, month, value_cents, note FROM monthly_values WHERE month <= ? ORDER BY month')
    .all(toMonth)) {
    if (!byAccount.has(e.account_id)) byAccount.set(e.account_id, []);
    byAccount.get(e.account_id).push(e);
  }
  return byAccount;
}

/**
 * Value of one account for month M, from its entries sorted by month.
 * Returns { cents, carried, entry } where entry is the row for exactly M.
 */
function valueAt(account, entries, month) {
  const closedMonth = account.status === 'closed' ? monthOf(account.closed_on) : null;
  if (closedMonth && month > closedMonth) return { cents: 0, carried: false, entry: null, afterClose: true };
  let last = null;
  for (const e of entries || []) {
    if (e.month > month) break;
    last = e;
  }
  if (!last) return { cents: 0, carried: false, entry: null, noData: true };
  if (last.month === month) return { cents: last.value_cents, carried: false, entry: last };
  return { cents: last.value_cents, carried: true, entry: null, fromMonth: last.month };
}

function signed(account, cents) {
  if (!account.counts_in_net_worth) return 0;
  return account.grp === 'liability' ? -cents : cents;
}

/** Net worth for each month in [from, to], with assets, liabilities and per-category totals. */
function series(db, from, to) {
  const accounts = db.prepare(ACCOUNTS).all();
  const entries = loadEntries(db, to);
  return monthsBetween(from, to).map((month) => {
    let assets = 0;
    let liabilities = 0;
    const byCategory = {};
    for (const a of accounts) {
      if (!a.counts_in_net_worth) continue;
      const { cents } = valueAt(a, entries.get(a.id), month);
      if (!cents) continue;
      if (a.grp === 'liability') liabilities += cents;
      else assets += cents;
      byCategory[a.category_code] = (byCategory[a.category_code] || 0) + signed(a, cents);
    }
    return { month, assets, liabilities, net: assets - liabilities, byCategory };
  });
}

/** Did the account exist during month M? (opened by then, and not closed before it) */
function activeIn(account, month) {
  const opened = monthOf(account.opened_on);
  const closed = account.status === 'closed' ? monthOf(account.closed_on) : null;
  return (!opened || opened <= month) && (!closed || closed >= month);
}

/**
 * Rows for the Month-End grid: accounts active in M (including term life,
 * which shows but doesn't count), grouped by category.
 */
function monthGrid(db, month) {
  if (!isMonth(month)) throw new ValidationError('Choose a month.');
  const accounts = db
    .prepare(`${ACCOUNTS} ORDER BY c.sort, t.sort, a.nickname COLLATE NOCASE`)
    .all()
    .filter((a) => activeIn(a, month));
  const entries = loadEntries(db, month);
  const prev = addMonths(month, -1);
  const groups = [];
  let entered = 0;
  for (const a of accounts) {
    const list = entries.get(a.id);
    const now = valueAt(a, list, month);
    const before = valueAt(a, list, prev);
    const row = {
      ...a,
      entry: now.entry, // the saved value for this month, if any
      carriedCents: now.entry ? null : now.noData ? null : now.cents,
      carriedFrom: now.fromMonth || null,
      prevCents: before.noData ? null : before.cents,
      prevCarried: !!before.carried,
      closesThisMonth: a.status === 'closed' && monthOf(a.closed_on) === month,
    };
    if (now.entry) entered++;
    let g = groups[groups.length - 1];
    if (!g || g.code !== a.category_code) {
      g = { code: a.category_code, title: a.category_label, grp: a.grp, rows: [] };
      groups.push(g);
    }
    g.rows.push(row);
  }
  const [totals] = series(db, month, month);
  return { month, prev, groups, count: accounts.length, entered, totals };
}

function parseCents(v) {
  if (v == null) return null;
  const s = String(v).trim().replace(/[$,\s]/g, '');
  if (s === '') return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0 || n > 1e12) return NaN;
  return Math.round(n * 100);
}

/**
 * Save the grid for one month. Each item: { account_id, value, note }.
 * A blank value removes that month's entry (so the last value carries forward).
 */
function saveMonth(db, month, items) {
  if (!isMonth(month)) throw new ValidationError('Choose a month.');
  if (month > currentMonth()) throw new ValidationError("You can't enter values for a future month.");
  const accounts = new Map(db.prepare(ACCOUNTS).all().map((a) => [a.id, a]));
  const upsert = db.prepare(
    `INSERT INTO monthly_values (account_id, month, value_cents, note) VALUES (@account_id, @month, @value_cents, @note)
     ON CONFLICT(account_id, month) DO UPDATE SET value_cents = excluded.value_cents, note = excluded.note,
       updated_at = datetime('now')`
  );
  const del = db.prepare('DELETE FROM monthly_values WHERE account_id = ? AND month = ?');
  let saved = 0;
  db.transaction(() => {
    for (const item of Array.isArray(items) ? items : []) {
      const id = Number(item.account_id);
      const a = accounts.get(id);
      if (!a) throw new ValidationError('One of these accounts no longer exists. Reload the page.');
      const cents = parseCents(item.value);
      if (Number.isNaN(cents)) {
        const err = new ValidationError(`"${item.value}" isn't an amount for ${a.nickname}. Use numbers like 12500.`);
        err.field = `value-${id}`;
        throw err;
      }
      if (cents != null && !activeIn(a, month)) {
        const err = new ValidationError(`${a.nickname} wasn't open in that month.`);
        err.field = `value-${id}`;
        throw err;
      }
      const note = item.note == null ? null : String(item.note).trim().slice(0, 500) || null;
      if (cents == null) del.run(id, month);
      else upsert.run({ account_id: id, month, value_cents: cents, note });
      saved++;
    }
  })();
  return saved;
}

/** Open, counted accounts with no entry for the month (for the dashboard reminder). */
function missingFor(db, month) {
  const have = new Set(db.prepare('SELECT account_id FROM monthly_values WHERE month = ?').all(month).map((r) => r.account_id));
  return db
    .prepare(`${ACCOUNTS} ORDER BY c.sort, a.nickname COLLATE NOCASE`)
    .all()
    .filter((a) => a.counts_in_net_worth && activeIn(a, month) && !have.has(a.id));
}

module.exports = {
  isMonth,
  addMonths,
  monthOf,
  currentMonth,
  lastCompletedMonth,
  monthsBetween,
  valueAt,
  series,
  monthGrid,
  saveMonth,
  missingFor,
  activeIn,
};
