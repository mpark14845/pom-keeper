'use strict';

/**
 * Password keeper (milestone 3d, spec §5.2). Each entry can link to any
 * record: an account, company, contact or family member. List pages never
 * receive secrets; they're fetched one at a time when revealed or copied.
 */

const { ValidationError } = require('./entities');

const LINK_TABLES = {
  account: { table: 'accounts', name: 'nickname', label: 'Account', href: (id) => `/accounts/${id}` },
  company: { table: 'companies', name: 'name', label: 'Company', href: (id) => `/companies/${id}` },
  contact: { table: 'contacts', name: 'name', label: 'Contact', href: (id) => `/contacts/${id}` },
  family_member: { table: 'family_members', name: 'name', label: 'Family', href: (id) => `/family/${id}` },
};

const LIMITS = { title: 120, website_url: 300, username: 200, password: 500, pin: 50, security_qa: 2000, notes: 5000 };

function clean(v) {
  if (typeof v === 'string') v = v.trim();
  return v === '' || v === undefined ? null : v;
}

function validate(db, input) {
  const out = {};
  for (const [k, max] of Object.entries(LIMITS)) {
    // Passwords keep leading/trailing spaces exactly as typed.
    let v = k === 'password' ? (input[k] === '' || input[k] == null ? null : String(input[k])) : clean(input[k]);
    if (v != null && String(v).length > max) throw new ValidationError(`Too long (max ${max} characters).`, k);
    out[k] = v == null ? null : String(v);
  }
  if (!out.title) throw new ValidationError('Give it a name, like "Chase online banking".', 'title');

  // "link" arrives as "account:12" from the picker.
  const link = clean(input.link);
  out.linked_type = null;
  out.linked_id = null;
  if (link) {
    const [type, rawId] = String(link).split(':');
    const t = LINK_TABLES[type];
    const id = Number(rawId);
    if (!t || !Number.isInteger(id) || !db.prepare(`SELECT 1 FROM ${t.table} WHERE id = ?`).get(id)) {
      throw new ValidationError('Choose something from the list to link to.', 'link');
    }
    out.linked_type = type;
    out.linked_id = id;
  }
  const p = input.include_in_print;
  out.include_in_print = p === undefined ? 1 : p === true || p === 1 || p === '1' || p === 'on' ? 1 : 0;
  return out;
}

function save(db, input) {
  const values = validate(db, input || {});
  const id = input && input.id ? Number(input.id) : null;
  const cols = Object.keys(values);
  if (id) {
    if (!db.prepare('SELECT 1 FROM credentials WHERE id = ?').get(id)) {
      throw new ValidationError('That password entry no longer exists.');
    }
    db.prepare(
      `UPDATE credentials SET ${cols.map((c) => `${c} = @${c}`).join(', ')}, updated_at = datetime('now') WHERE id = @id`
    ).run({ ...values, id });
    return id;
  }
  return Number(
    db.prepare(`INSERT INTO credentials (${cols.join(', ')}) VALUES (${cols.map((c) => `@${c}`).join(', ')})`).run(values)
      .lastInsertRowid
  );
}

function remove(db, id) {
  db.prepare('DELETE FROM credentials WHERE id = ?').run(Number(id));
}

function get(db, id) {
  return db.prepare('SELECT * FROM credentials WHERE id = ?').get(Number(id)) || null;
}

/** One secret field, for reveal or copy. */
function secret(db, id, field) {
  if (!['password', 'pin', 'username'].includes(field)) throw new ValidationError('Unknown field.');
  const row = db.prepare(`SELECT ${field} AS v FROM credentials WHERE id = ?`).get(Number(id));
  if (!row) throw new ValidationError('That password entry no longer exists.');
  return row.v;
}

function linkName(db, type, id) {
  const t = LINK_TABLES[type];
  if (!t || id == null) return null;
  const row = db.prepare(`SELECT ${t.name} AS name FROM ${t.table} WHERE id = ?`).get(id);
  return row ? { type, id, name: row.name, label: t.label, href: t.href(id) } : null;
}

/** List without secrets; flags say which secrets exist. */
function list(db, { linkedType, linkedId } = {}) {
  const rows = db
    .prepare(
      `SELECT id, title, website_url, username, notes, linked_type, linked_id, include_in_print,
              password IS NOT NULL AS has_password, pin IS NOT NULL AS has_pin,
              security_qa IS NOT NULL AS has_qa
       FROM credentials
       WHERE (@t IS NULL OR (linked_type = @t AND linked_id = @i))
       ORDER BY title COLLATE NOCASE`
    )
    .all({ t: linkedType || null, i: linkedId == null ? null : Number(linkedId) });
  return rows.map((r) => ({ ...r, link: linkName(db, r.linked_type, r.linked_id) }));
}

/** Everything a password can link to, grouped for a <select>. */
function linkOptions(db) {
  return Object.entries(LINK_TABLES).map(([type, t]) => ({
    type,
    label: t.label === 'Family' ? 'Family' : `${t.label === 'Company' ? 'Companies' : t.label + 's'}`,
    items: db.prepare(`SELECT id, ${t.name} AS name FROM ${t.table} ORDER BY ${t.name} COLLATE NOCASE`).all(),
  }));
}

module.exports = { save, remove, get, secret, list, linkOptions, linkName, LINK_TABLES };
