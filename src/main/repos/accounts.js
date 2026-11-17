'use strict';

/**
 * Accounts and their links (milestone 3b, spec §5.2): company, contacts,
 * owners, beneficiaries and the "secured by" asset. Money is integer cents.
 */

const { ValidationError } = require('./entities');

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const CONTACT_ROLES = ['advisor', 'servicer', 'agent', 'other'];
const OWNER_ROLES = ['owner', 'joint owner', 'trustee', 'beneficial owner'];
const BENEFICIARY_LEVELS = ['primary', 'contingent'];

const clean = (v) => {
  if (typeof v === 'string') v = v.trim();
  return v === '' || v === undefined ? null : v;
};

function text(v, label, max, field) {
  v = clean(v);
  if (v == null) return null;
  v = String(v);
  if (v.length > max) throw new ValidationError(`${label} is too long (max ${max} characters).`, field);
  return v;
}

function date(v, label, field) {
  v = clean(v);
  if (v == null) return null;
  if (!DATE.test(v) || Number.isNaN(Date.parse(v))) throw new ValidationError(`${label} must be a date.`, field);
  return v;
}

/** "$1,234.56" / "1234.5" / 1234 → cents. */
function toCents(v, label, field) {
  v = clean(v);
  if (v == null) return null;
  const n = Number(String(v).replace(/[$,\s]/g, ''));
  if (!Number.isFinite(n) || n < 0 || n > 1e12) throw new ValidationError(`${label} must be an amount like 250000.`, field);
  return Math.round(n * 100);
}

function pct(v, label, field) {
  v = clean(v);
  if (v == null) return null;
  const n = Number(String(v).replace(/[%\s]/g, ''));
  if (!Number.isFinite(n) || n < 0 || n > 100) throw new ValidationError(`${label} must be between 0 and 100.`, field);
  return n;
}

function typeInfo(db, code) {
  return db
    .prepare(
      `SELECT t.code, t.label, t.counts_in_net_worth, c.code AS category_code, c.label AS category_label, c.grp
       FROM account_types t JOIN categories c ON c.code = t.category_code WHERE t.code = ?`
    )
    .get(code);
}

function validateAccount(db, input, id) {
  const nickname = text(input.nickname, 'Name', 120, 'nickname');
  if (!nickname) throw new ValidationError('Give the account a name, like "Joint checking".', 'nickname');

  const type = typeInfo(db, clean(input.type_code));
  if (!type) throw new ValidationError('Choose an account type.', 'type_code');

  let companyId = clean(input.company_id);
  if (companyId != null) {
    companyId = Number(companyId);
    if (!db.prepare('SELECT 1 FROM companies WHERE id = ?').get(companyId)) {
      throw new ValidationError('Choose a company from the list.', 'company_id');
    }
  }

  const status = clean(input.status) || 'open';
  if (!['open', 'closed'].includes(status)) throw new ValidationError('Choose open or closed.', 'status');
  const openedOn = date(input.opened_on, 'Opened date', 'opened_on');
  let closedOn = date(input.closed_on, 'Closed date', 'closed_on');
  if (status === 'closed' && !closedOn) throw new ValidationError('Enter the date the account was closed.', 'closed_on');
  if (status === 'open') closedOn = null;
  if (openedOn && closedOn && closedOn < openedOn) {
    throw new ValidationError('The closed date is before the opened date.', 'closed_on');
  }

  let securedBy = clean(input.secured_by_account_id);
  if (securedBy != null) {
    securedBy = Number(securedBy);
    if (type.grp !== 'liability') securedBy = null; // only debts are secured by something
    else {
      const target = db
        .prepare(
          `SELECT c.grp FROM accounts a JOIN account_types t ON t.code = a.type_code
           JOIN categories c ON c.code = t.category_code WHERE a.id = ?`
        )
        .get(securedBy);
      if (!target || securedBy === id || target.grp !== 'asset') {
        throw new ValidationError('A loan can only be secured by an asset, like a house or a car.', 'secured_by_account_id');
      }
    }
  }

  return {
    account: {
      nickname,
      type_code: type.code,
      company_id: companyId,
      account_number: text(input.account_number, 'Account number', 60, 'account_number'),
      routing_number: text(input.routing_number, 'Routing number', 20, 'routing_number'),
      status,
      opened_on: openedOn,
      closed_on: closedOn,
      face_amount_cents: toCents(input.face_amount, 'Death benefit', 'face_amount'),
      interest_rate: pct(input.interest_rate, 'Interest rate', 'interest_rate'),
      secured_by_account_id: securedBy,
      notes: text(input.notes, 'Notes', 5000, 'notes'),
    },
    contacts: links(db, input.contacts, 'contacts', 'contact_id', 'role', CONTACT_ROLES, 'other'),
    owners: links(db, input.owners, 'family_members', 'family_member_id', 'role', OWNER_ROLES, 'owner'),
    beneficiaries: links(db, input.beneficiaries, 'family_members', 'family_member_id', 'level', BENEFICIARY_LEVELS, 'primary'),
  };
}

/** Validate a repeatable list of links, dropping blank rows and duplicates. */
function links(db, rows, table, idKey, kindKey, kinds, fallback) {
  const out = [];
  const seen = new Set();
  for (const r of Array.isArray(rows) ? rows : []) {
    const ref = clean(r && r[idKey]);
    if (ref == null) continue;
    const refId = Number(ref);
    if (!db.prepare(`SELECT 1 FROM ${table} WHERE id = ?`).get(refId)) {
      throw new ValidationError('One of the people you picked no longer exists.', table);
    }
    const kind = clean(r[kindKey]) || fallback;
    if (!kinds.includes(kind)) throw new ValidationError('Choose a valid role.', table);
    const key = `${refId}|${kindKey === 'level' ? kind : ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ [idKey]: refId, [kindKey]: kind, share_pct: pct(r.share_pct, 'Share', table) });
  }
  return out;
}

function saveAccount(db, input) {
  const id = input && input.id ? Number(input.id) : null;
  if (id && !db.prepare('SELECT 1 FROM accounts WHERE id = ?').get(id)) {
    throw new ValidationError('That account no longer exists.');
  }
  const v = validateAccount(db, input || {}, id);
  return db.transaction(() => {
    let accountId = id;
    const cols = Object.keys(v.account);
    if (id) {
      db.prepare(
        `UPDATE accounts SET ${cols.map((c) => `${c} = @${c}`).join(', ')}, updated_at = datetime('now') WHERE id = @id`
      ).run({ ...v.account, id });
    } else {
      accountId = Number(
        db.prepare(`INSERT INTO accounts (${cols.join(', ')}) VALUES (${cols.map((c) => `@${c}`).join(', ')})`).run(v.account)
          .lastInsertRowid
      );
    }
    db.prepare('DELETE FROM account_contacts WHERE account_id = ?').run(accountId);
    db.prepare('DELETE FROM account_owners WHERE account_id = ?').run(accountId);
    db.prepare('DELETE FROM account_beneficiaries WHERE account_id = ?').run(accountId);
    const insC = db.prepare('INSERT INTO account_contacts (account_id, contact_id, role) VALUES (?, ?, ?)');
    for (const c of v.contacts) insC.run(accountId, c.contact_id, c.role);
    const insO = db.prepare('INSERT INTO account_owners (account_id, family_member_id, role, share_pct) VALUES (?, ?, ?, ?)');
    for (const o of v.owners) insO.run(accountId, o.family_member_id, o.role, o.share_pct);
    const insB = db.prepare(
      'INSERT INTO account_beneficiaries (account_id, family_member_id, level, share_pct) VALUES (?, ?, ?, ?)'
    );
    for (const b of v.beneficiaries) insB.run(accountId, b.family_member_id, b.level, b.share_pct);
    return accountId;
  })();
}

function accountImpact(db, id) {
  id = Number(id);
  return {
    values: db.prepare('SELECT count(*) n FROM monthly_values WHERE account_id = ?').get(id).n,
    securing: db.prepare('SELECT count(*) n FROM accounts WHERE secured_by_account_id = ?').get(id).n,
    linkedPasswords: db
      .prepare("SELECT count(*) n FROM credentials WHERE linked_type = 'account' AND linked_id = ?")
      .get(id).n,
  };
}

function removeAccount(db, id) {
  id = Number(id);
  db.transaction(() => {
    db.prepare(
      "UPDATE credentials SET linked_type = NULL, linked_id = NULL, updated_at = datetime('now') WHERE linked_type = 'account' AND linked_id = ?"
    ).run(id);
    db.prepare('DELETE FROM accounts WHERE id = ?').run(id); // links and values cascade; secured_by set NULL
  })();
}

// ---------- Read models ----------

const ACCOUNT_ROWS = `
  SELECT a.*, t.label AS type_label, t.counts_in_net_worth, t.sort AS type_sort,
         c.code AS category_code, c.label AS category_label, c.grp, c.sort AS category_sort,
         co.name AS company_name,
         lv.value_cents AS latest_cents, lv.month AS latest_month,
         (SELECT group_concat(f.name, ', ') FROM account_owners o JOIN family_members f ON f.id = o.family_member_id
            WHERE o.account_id = a.id) AS owner_names
  FROM accounts a
  JOIN account_types t ON t.code = a.type_code
  JOIN categories c ON c.code = t.category_code
  LEFT JOIN companies co ON co.id = a.company_id
  LEFT JOIN monthly_values lv ON lv.id = (
    SELECT id FROM monthly_values m WHERE m.account_id = a.id ORDER BY m.month DESC LIMIT 1)
`;

function listAccounts(db, { includeClosed = false } = {}) {
  return db
    .prepare(`${ACCOUNT_ROWS} WHERE (@all = 1 OR a.status = 'open') ORDER BY a.nickname COLLATE NOCASE`)
    .all({ all: includeClosed ? 1 : 0 });
}

/** Signed value for totals: liabilities count against you, info-only types don't count. */
function signedCents(row) {
  if (row.latest_cents == null || !row.counts_in_net_worth || row.status === 'closed') return 0;
  return row.grp === 'liability' ? -row.latest_cents : row.latest_cents;
}

function total(rows) {
  return rows.reduce((s, r) => s + signedCents(r), 0);
}

const GRP_LABEL = { asset: 'Assets', liability: 'Liabilities', info: 'Info only' };

/**
 * Groups for the Accounts page. view: type (default) | account | company | contact.
 * Returns [{ key, title, subtitle?, rows, total }].
 */
function groupAccounts(db, view, opts) {
  const rows = listAccounts(db, opts);
  const groups = new Map();
  const add = (key, title, row, extra = {}) => {
    if (!groups.has(key)) groups.set(key, { key, title, rows: [], ...extra });
    groups.get(key).rows.push(row);
  };

  if (view === 'account') {
    for (const r of rows) add('all', 'All accounts', r);
  } else if (view === 'company') {
    const sorted = [...rows].sort((a, b) =>
      (a.company_name || '￿').localeCompare(b.company_name || '￿', undefined, { sensitivity: 'base' })
    );
    for (const r of sorted) add(`c${r.company_id || 0}`, r.company_name || 'No company', r, { companyId: r.company_id });
  } else if (view === 'contact') {
    const byAccount = new Map();
    for (const l of db
      .prepare(
        `SELECT ac.account_id, k.id, k.name, k.phone, k.email, co.name AS company_name
         FROM account_contacts ac JOIN contacts k ON k.id = ac.contact_id JOIN companies co ON co.id = k.company_id
         ORDER BY k.name COLLATE NOCASE`
      )
      .all()) {
      if (!byAccount.has(l.account_id)) byAccount.set(l.account_id, []);
      byAccount.get(l.account_id).push(l);
    }
    const entries = [];
    for (const r of rows) {
      const ls = byAccount.get(r.id);
      if (!ls) entries.push([{ id: 0, name: '￿' }, r]);
      else for (const k of ls) entries.push([k, r]);
    }
    entries.sort((a, b) => a[0].name.localeCompare(b[0].name, undefined, { sensitivity: 'base' }));
    for (const [k, r] of entries) {
      add(`k${k.id}`, k.id ? k.name : 'No contact', r, {
        contactId: k.id || null,
        subtitle: k.id ? [k.company_name, k.phone, k.email].filter(Boolean).join(' · ') : '',
      });
    }
  } else {
    const sorted = [...rows].sort(
      (a, b) => a.category_sort - b.category_sort || a.type_sort - b.type_sort || a.nickname.localeCompare(b.nickname)
    );
    for (const r of sorted) add(r.category_code, `${GRP_LABEL[r.grp]} / ${r.category_label}`, r, { grp: r.grp });
  }

  const out = [...groups.values()];
  for (const g of out) {
    g.total = total(g.rows);
    g.hasValues = g.rows.some((r) => r.latest_cents != null && r.counts_in_net_worth);
  }
  return { groups: out, rows };
}

function summary(rows) {
  let assets = 0;
  let liabilities = 0;
  for (const r of rows) {
    const v = signedCents(r);
    if (v > 0) assets += v;
    else liabilities -= v;
  }
  const hasValues = rows.some((r) => r.latest_cents != null && r.counts_in_net_worth && r.status !== 'closed');
  return { assets, liabilities, net: assets - liabilities, hasValues };
}

function getAccount(db, id) {
  const account = db.prepare(`${ACCOUNT_ROWS} WHERE a.id = ?`).get(Number(id));
  if (!account) return null;
  return {
    ...account,
    contacts: db
      .prepare(
        `SELECT ac.contact_id, ac.role, k.name, k.phone, k.email, co.name AS company_name
         FROM account_contacts ac JOIN contacts k ON k.id = ac.contact_id JOIN companies co ON co.id = k.company_id
         WHERE ac.account_id = ? ORDER BY k.name COLLATE NOCASE`
      )
      .all(account.id),
    owners: db
      .prepare(
        `SELECT o.family_member_id, o.role, o.share_pct, f.name FROM account_owners o
         JOIN family_members f ON f.id = o.family_member_id WHERE o.account_id = ? ORDER BY f.name COLLATE NOCASE`
      )
      .all(account.id),
    beneficiaries: db
      .prepare(
        `SELECT b.family_member_id, b.level, b.share_pct, f.name FROM account_beneficiaries b
         JOIN family_members f ON f.id = b.family_member_id WHERE b.account_id = ?
         ORDER BY b.level = 'contingent', f.name COLLATE NOCASE`
      )
      .all(account.id),
    securedBy: account.secured_by_account_id
      ? db.prepare('SELECT id, nickname FROM accounts WHERE id = ?').get(account.secured_by_account_id)
      : null,
    securing: db
      .prepare('SELECT id, nickname FROM accounts WHERE secured_by_account_id = ? ORDER BY nickname COLLATE NOCASE')
      .all(account.id),
    values: db
      .prepare('SELECT month, value_cents, note FROM monthly_values WHERE account_id = ? ORDER BY month DESC LIMIT 24')
      .all(account.id),
  };
}

function formOptions(db, excludeId) {
  const types = db
    .prepare(
      `SELECT t.code, t.label, c.code AS category_code, c.label AS category_label, c.grp
       FROM account_types t JOIN categories c ON c.code = t.category_code ORDER BY c.sort, t.sort`
    )
    .all();
  const typeGroups = [];
  for (const t of types) {
    let g = typeGroups[typeGroups.length - 1];
    if (!g || g.code !== t.category_code) {
      g = { code: t.category_code, label: `${GRP_LABEL[t.grp]} / ${t.category_label}`, grp: t.grp, types: [] };
      typeGroups.push(g);
    }
    g.types.push(t);
  }
  return {
    typeGroups,
    typeGrp: Object.fromEntries(types.map((t) => [t.code, t.grp])),
    companies: db.prepare('SELECT id, name FROM companies ORDER BY name COLLATE NOCASE').all(),
    contacts: db
      .prepare(
        `SELECT k.id, k.name, co.name AS company_name, k.company_id FROM contacts k
         JOIN companies co ON co.id = k.company_id ORDER BY co.name COLLATE NOCASE, k.name COLLATE NOCASE`
      )
      .all(),
    family: db.prepare('SELECT id, name, kind FROM family_members ORDER BY name COLLATE NOCASE').all(),
    securableAssets: db
      .prepare(
        `SELECT a.id, a.nickname, t.label AS type_label FROM accounts a
         JOIN account_types t ON t.code = a.type_code JOIN categories c ON c.code = t.category_code
         WHERE c.grp = 'asset' AND a.id != ? ORDER BY c.code = 'property' DESC, a.nickname COLLATE NOCASE`
      )
      .all(Number(excludeId) || 0),
    contactRoles: CONTACT_ROLES,
    ownerRoles: OWNER_ROLES,
    beneficiaryLevels: BENEFICIARY_LEVELS,
  };
}

function accountsForCompany(db, companyId) {
  return db.prepare(`${ACCOUNT_ROWS} WHERE a.company_id = ? ORDER BY a.nickname COLLATE NOCASE`).all(Number(companyId));
}

function accountsForContact(db, contactId) {
  return db
    .prepare(
      `${ACCOUNT_ROWS} WHERE a.id IN (SELECT account_id FROM account_contacts WHERE contact_id = ?)
       ORDER BY a.nickname COLLATE NOCASE`
    )
    .all(Number(contactId));
}

function accountsForFamily(db, familyId) {
  const id = Number(familyId);
  return {
    owns: db
      .prepare(`${ACCOUNT_ROWS} WHERE a.id IN (SELECT account_id FROM account_owners WHERE family_member_id = ?) ORDER BY a.nickname`)
      .all(id),
    beneficiaryOf: db
      .prepare(
        `${ACCOUNT_ROWS} WHERE a.id IN (SELECT account_id FROM account_beneficiaries WHERE family_member_id = ?) ORDER BY a.nickname`
      )
      .all(id),
  };
}

/** "••••1234" for lists; full numbers only on the account page. */
function mask(number) {
  if (!number) return '';
  const digits = String(number).replace(/\s/g, '');
  return digits.length <= 4 ? digits : `••••${digits.slice(-4)}`;
}

module.exports = {
  saveAccount,
  removeAccount,
  accountImpact,
  listAccounts,
  groupAccounts,
  summary,
  getAccount,
  formOptions,
  accountsForCompany,
  accountsForContact,
  accountsForFamily,
  signedCents,
  mask,
  toCents,
};
