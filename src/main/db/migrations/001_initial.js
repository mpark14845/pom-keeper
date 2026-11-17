'use strict';

// Initial schema (spec section 5). Money is integer cents; liabilities are
// stored as positive amounts owed.

const ts = `created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))`;

const schema = `
CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE categories (
  code  TEXT PRIMARY KEY,
  grp   TEXT NOT NULL CHECK (grp IN ('asset','liability','info')),
  label TEXT NOT NULL,
  sort  INTEGER NOT NULL
);

CREATE TABLE account_types (
  code                TEXT PRIMARY KEY,
  category_code       TEXT NOT NULL REFERENCES categories(code),
  label               TEXT NOT NULL,
  counts_in_net_worth INTEGER NOT NULL DEFAULT 1,
  sort                INTEGER NOT NULL
);

CREATE TABLE family_members (
  id            INTEGER PRIMARY KEY,
  name          TEXT NOT NULL,
  kind          TEXT NOT NULL DEFAULT 'person' CHECK (kind IN ('person','trust','estate','other')),
  relationship  TEXT,
  date_of_birth TEXT,
  phone         TEXT,
  email         TEXT,
  notes         TEXT,
  ${ts}
);

CREATE TABLE companies (
  id      INTEGER PRIMARY KEY,
  name    TEXT NOT NULL,
  kind    TEXT NOT NULL DEFAULT 'other'
          CHECK (kind IN ('bank','brokerage','insurer','employer','lender','government','other')),
  website TEXT,
  phone   TEXT,
  address TEXT,
  notes   TEXT,
  ${ts}
);

CREATE TABLE contacts (
  id         INTEGER PRIMARY KEY,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  name       TEXT NOT NULL,
  title      TEXT,
  email      TEXT,
  phone      TEXT,
  phone_alt  TEXT,
  notes      TEXT,
  ${ts}
);
CREATE INDEX idx_contacts_company ON contacts(company_id);

CREATE TABLE accounts (
  id                    INTEGER PRIMARY KEY,
  company_id            INTEGER REFERENCES companies(id) ON DELETE RESTRICT,
  type_code             TEXT NOT NULL REFERENCES account_types(code),
  nickname              TEXT NOT NULL,
  account_number        TEXT,
  routing_number        TEXT,
  status                TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  opened_on             TEXT,
  closed_on             TEXT,
  face_amount_cents     INTEGER,
  interest_rate         REAL,
  secured_by_account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
  notes                 TEXT,
  ${ts},
  CHECK (status = 'open' OR closed_on IS NOT NULL)
);
CREATE INDEX idx_accounts_company ON accounts(company_id);
CREATE INDEX idx_accounts_type ON accounts(type_code);

CREATE TABLE account_contacts (
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  role       TEXT NOT NULL DEFAULT 'other' CHECK (role IN ('advisor','servicer','agent','other')),
  PRIMARY KEY (account_id, contact_id)
);

CREATE TABLE account_owners (
  account_id       INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  family_member_id INTEGER NOT NULL REFERENCES family_members(id) ON DELETE CASCADE,
  role             TEXT NOT NULL DEFAULT 'owner'
                   CHECK (role IN ('owner','joint owner','trustee','beneficial owner')),
  share_pct        REAL,
  PRIMARY KEY (account_id, family_member_id)
);

CREATE TABLE account_beneficiaries (
  account_id       INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  family_member_id INTEGER NOT NULL REFERENCES family_members(id) ON DELETE CASCADE,
  level            TEXT NOT NULL DEFAULT 'primary' CHECK (level IN ('primary','contingent')),
  share_pct        REAL,
  PRIMARY KEY (account_id, family_member_id, level)
);

CREATE TABLE monthly_values (
  id          INTEGER PRIMARY KEY,
  account_id  INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  month       TEXT NOT NULL CHECK (month GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]'),
  value_cents INTEGER NOT NULL,
  note        TEXT,
  ${ts},
  UNIQUE (account_id, month)
);

CREATE TABLE notes (
  id               INTEGER PRIMARY KEY,
  title            TEXT NOT NULL,
  category         TEXT NOT NULL DEFAULT 'other' CHECK (category IN ('legal','location','instructions','other')),
  body             TEXT,
  include_in_print INTEGER NOT NULL DEFAULT 1,
  sort             INTEGER NOT NULL DEFAULT 0,
  ${ts}
);

CREATE TABLE credentials (
  id               INTEGER PRIMARY KEY,
  title            TEXT NOT NULL,
  website_url      TEXT,
  username         TEXT,
  password         TEXT,
  pin              TEXT,
  security_qa      TEXT,
  notes            TEXT,
  linked_type      TEXT CHECK (linked_type IN ('account','company','contact','family_member')),
  linked_id        INTEGER,
  include_in_print INTEGER NOT NULL DEFAULT 1,
  ${ts},
  CHECK ((linked_type IS NULL) = (linked_id IS NULL))
);
`;

const categories = [
  ['current_cash', 'asset', 'Current Cash', 10],
  ['retirement', 'asset', 'Retirement', 20],
  ['investments', 'asset', 'Investments', 30],
  ['health_savings', 'asset', 'Health Savings', 40],
  ['insurance_cash', 'asset', 'Insurance Cash Value', 50],
  ['property', 'asset', 'Property & Vehicles', 60],
  ['long_term', 'liability', 'Long Term', 70],
  ['revolving', 'liability', 'Revolving', 80],
  ['insurance_info', 'info', 'Insurance', 90],
];

// [code, category, label, counts_in_net_worth]
const accountTypes = [
  ['checking', 'current_cash', 'Checking', 1],
  ['savings', 'current_cash', 'Savings', 1],
  ['money_market', 'current_cash', 'Money Market', 1],
  ['cd', 'current_cash', 'CD', 1],
  ['cash', 'current_cash', 'Cash on hand', 1],
  ['401k', 'retirement', '401(k)', 1],
  ['403b', 'retirement', '403(b)', 1],
  ['ira', 'retirement', 'Traditional IRA', 1],
  ['roth_ira', 'retirement', 'Roth IRA', 1],
  ['pension', 'retirement', 'Pension (lump-sum value)', 1],
  ['brokerage', 'investments', 'Brokerage', 1],
  ['hsa', 'health_savings', 'HSA', 1],
  ['whole_life', 'insurance_cash', 'Whole Life (cash value)', 1],
  ['home', 'property', 'Home', 1],
  ['vehicle', 'property', 'Vehicle', 1],
  ['other_property', 'property', 'Other property', 1],
  ['mortgage', 'long_term', 'Mortgage', 1],
  ['auto_loan', 'long_term', 'Auto Loan', 1],
  ['student_loan', 'long_term', 'Student Loan', 1],
  ['personal_loan', 'long_term', 'Personal Loan', 1],
  ['heloc', 'long_term', 'HELOC', 1],
  ['credit_card', 'revolving', 'Credit Card', 1],
  ['term_life', 'insurance_info', 'Term Life', 0],
];

const defaultSettings = {
  lock_minutes: '30',
  backup_folder: '',
  auto_backup: '1',
  backups_keep: '10',
};

function up(db) {
  db.exec(schema);
  const insCat = db.prepare('INSERT INTO categories (code, grp, label, sort) VALUES (?, ?, ?, ?)');
  for (const c of categories) insCat.run(...c);
  const insType = db.prepare(
    'INSERT INTO account_types (code, category_code, label, counts_in_net_worth, sort) VALUES (?, ?, ?, ?, ?)'
  );
  accountTypes.forEach((t, i) => insType.run(t[0], t[1], t[2], t[3], (i + 1) * 10));
  const insSetting = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)');
  for (const [k, v] of Object.entries(defaultSettings)) insSetting.run(k, v);
}

module.exports = { version: 1, name: 'initial', up };
