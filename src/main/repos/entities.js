'use strict';

/**
 * Data access for Family, Companies and Contacts (milestone 3a).
 * Every write goes through validate(), which trims text, turns empty
 * strings into NULL and rejects bad input with a friendly message.
 */

class ValidationError extends Error {
  constructor(message, field) {
    super(message);
    this.code = 'INVALID';
    this.field = field;
  }
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const text = (max = 200) => ({ type: 'text', max });
const longText = () => ({ type: 'text', max: 5000 });

const ENTITIES = {
  notes: {
    table: 'notes',
    titleField: 'title',
    label: 'Note',
    fields: {
      title: { ...text(120), required: true, label: 'Title' },
      category: {
        type: 'enum',
        values: ['legal', 'location', 'instructions', 'other'],
        default: 'other',
        label: 'Category',
      },
      body: { ...longText(), label: 'Details' },
      include_in_print: { type: 'bool', default: 1, label: 'Include on the family printout' },
    },
  },
  family: {
    table: 'family_members',
    linkedType: 'family_member',
    label: 'Family member',
    fields: {
      name: { ...text(120), required: true, label: 'Name' },
      kind: { type: 'enum', values: ['person', 'trust', 'estate', 'other'], default: 'person', label: 'Type' },
      relationship: { ...text(80), label: 'Relationship' },
      date_of_birth: { type: 'date', label: 'Date of birth' },
      phone: { ...text(40), label: 'Phone' },
      email: { type: 'email', label: 'Email' },
      notes: { ...longText(), label: 'Notes' },
    },
  },
  companies: {
    table: 'companies',
    linkedType: 'company',
    label: 'Company',
    fields: {
      name: { ...text(120), required: true, label: 'Name' },
      kind: {
        type: 'enum',
        values: ['bank', 'brokerage', 'insurer', 'employer', 'lender', 'government', 'other'],
        default: 'other',
        label: 'Type',
      },
      website: { ...text(300), label: 'Website' },
      phone: { ...text(40), label: 'Phone' },
      address: { ...text(500), label: 'Address' },
      notes: { ...longText(), label: 'Notes' },
    },
  },
  contacts: {
    table: 'contacts',
    linkedType: 'contact',
    label: 'Contact',
    fields: {
      company_id: { type: 'ref', table: 'companies', required: true, label: 'Company' },
      name: { ...text(120), required: true, label: 'Name' },
      title: { ...text(120), label: 'Title' },
      email: { type: 'email', label: 'Email' },
      phone: { ...text(40), label: 'Phone' },
      phone_alt: { ...text(40), label: 'Other phone' },
      notes: { ...longText(), label: 'Notes' },
    },
  },
};

function def(entity) {
  const d = ENTITIES[entity];
  if (!d) throw new ValidationError(`Unknown record type "${entity}".`);
  return d;
}

function validate(db, entity, input) {
  const { fields } = def(entity);
  const out = {};
  for (const [name, f] of Object.entries(fields)) {
    let v = input[name];
    if (typeof v === 'string') v = v.trim();
    if (v === '' || v === undefined) v = null;

    if (v == null && f.type === 'bool') {
      out[name] = name in input ? 0 : f.default ?? 0;
      continue;
    }
    if (v == null) {
      if (f.required) throw new ValidationError(`${f.label} is required.`, name);
      out[name] = f.default ?? null;
      continue;
    }
    switch (f.type) {
      case 'text':
        v = String(v);
        if (v.length > f.max) throw new ValidationError(`${f.label} is too long (max ${f.max} characters).`, name);
        break;
      case 'enum':
        if (!f.values.includes(v)) throw new ValidationError(`Choose a valid ${f.label.toLowerCase()}.`, name);
        break;
      case 'date':
        if (!DATE.test(v) || Number.isNaN(Date.parse(v))) {
          throw new ValidationError(`${f.label} must be a date (YYYY-MM-DD).`, name);
        }
        break;
      case 'email':
        v = String(v);
        if (!EMAIL.test(v) || v.length > 200) throw new ValidationError(`${f.label} doesn't look like an email address.`, name);
        break;
      case 'bool':
        v = v === true || v === 1 || v === '1' || v === 'on' || v === 'true' ? 1 : 0;
        break;
      case 'ref': {
        v = Number(v);
        const exists = Number.isInteger(v) && db.prepare(`SELECT 1 FROM ${f.table} WHERE id = ?`).get(v);
        if (!exists) throw new ValidationError(`Choose a ${f.label.toLowerCase()}.`, name);
        break;
      }
      default:
        break;
    }
    out[name] = v;
  }
  return out;
}

function get(db, entity, id) {
  return db.prepare(`SELECT * FROM ${def(entity).table} WHERE id = ?`).get(Number(id)) || null;
}

/** Insert when data.id is empty, otherwise update. Returns the id. */
function save(db, entity, data) {
  const d = def(entity);
  const values = validate(db, entity, data || {});
  const cols = Object.keys(values);
  const id = data && data.id ? Number(data.id) : null;
  if (id) {
    if (!get(db, entity, id)) throw new ValidationError(`That ${d.label.toLowerCase()} no longer exists.`);
    const set = cols.map((c) => `${c} = @${c}`).join(', ');
    db.prepare(`UPDATE ${d.table} SET ${set}, updated_at = datetime('now') WHERE id = @id`).run({ ...values, id });
    return id;
  }
  const res = db
    .prepare(`INSERT INTO ${d.table} (${cols.join(', ')}) VALUES (${cols.map((c) => `@${c}`).join(', ')})`)
    .run(values);
  return Number(res.lastInsertRowid);
}

/** What deleting this record would affect, for the confirm message. */
function deleteImpact(db, entity, id) {
  id = Number(id);
  if (!def(entity).linkedType) return {};
  const linkedPasswords = db
    .prepare('SELECT count(*) n FROM credentials WHERE linked_type = ? AND linked_id = ?')
    .get(def(entity).linkedType, id).n;
  if (entity === 'companies') {
    return {
      accounts: db.prepare('SELECT count(*) n FROM accounts WHERE company_id = ?').get(id).n,
      contacts: db.prepare('SELECT count(*) n FROM contacts WHERE company_id = ?').get(id).n,
      linkedPasswords,
    };
  }
  if (entity === 'contacts') {
    return { accounts: db.prepare('SELECT count(*) n FROM account_contacts WHERE contact_id = ?').get(id).n, linkedPasswords };
  }
  return {
    accounts: db
      .prepare(
        `SELECT count(DISTINCT account_id) n FROM (
           SELECT account_id FROM account_owners WHERE family_member_id = ?
           UNION SELECT account_id FROM account_beneficiaries WHERE family_member_id = ?)`
      )
      .get(id, id).n,
    linkedPasswords,
  };
}

function remove(db, entity, id) {
  const d = def(entity);
  id = Number(id);
  if (!get(db, entity, id)) return;
  db.transaction(() => {
    if (entity === 'companies') {
      const { accounts } = deleteImpact(db, entity, id);
      if (accounts > 0) {
        throw new ValidationError(
          `This company still has ${accounts} account${accounts === 1 ? '' : 's'}. Move or delete them first.`
        );
      }
      const contactIds = db.prepare('SELECT id FROM contacts WHERE company_id = ?').all(id).map((r) => r.id);
      for (const cid of contactIds) unlinkPasswords(db, 'contact', cid);
      db.prepare('DELETE FROM contacts WHERE company_id = ?').run(id);
    }
    if (d.linkedType) unlinkPasswords(db, d.linkedType, id);
    db.prepare(`DELETE FROM ${d.table} WHERE id = ?`).run(id);
  })();
}

// Passwords stay, but lose their link to a deleted record.
function unlinkPasswords(db, linkedType, id) {
  db.prepare(
    "UPDATE credentials SET linked_type = NULL, linked_id = NULL, updated_at = datetime('now') WHERE linked_type = ? AND linked_id = ?"
  ).run(linkedType, id);
}

// ---------- Read models for the list and detail pages ----------

function listFamily(db) {
  return db
    .prepare(
      `SELECT f.*,
         (SELECT count(*) FROM account_owners o WHERE o.family_member_id = f.id) AS owns,
         (SELECT count(*) FROM account_beneficiaries b WHERE b.family_member_id = f.id) AS beneficiary_of
       FROM family_members f
       ORDER BY CASE f.kind WHEN 'person' THEN 0 ELSE 1 END, f.name COLLATE NOCASE`
    )
    .all();
}

function listCompanies(db) {
  return db
    .prepare(
      `SELECT c.*,
         (SELECT count(*) FROM contacts k WHERE k.company_id = c.id) AS contact_count,
         (SELECT count(*) FROM accounts a WHERE a.company_id = c.id) AS account_count
       FROM companies c
       ORDER BY c.name COLLATE NOCASE`
    )
    .all();
}

function listContacts(db, { companyId } = {}) {
  return db
    .prepare(
      `SELECT k.*, c.name AS company_name,
         (SELECT count(*) FROM account_contacts ac WHERE ac.contact_id = k.id) AS account_count
       FROM contacts k JOIN companies c ON c.id = k.company_id
       WHERE (@companyId IS NULL OR k.company_id = @companyId)
       ORDER BY c.name COLLATE NOCASE, k.name COLLATE NOCASE`
    )
    .all({ companyId: companyId ? Number(companyId) : null });
}

function listNotes(db) {
  return db
    .prepare(
      `SELECT * FROM notes ORDER BY CASE category WHEN 'instructions' THEN 0 WHEN 'legal' THEN 1
         WHEN 'location' THEN 2 ELSE 3 END, sort, title COLLATE NOCASE`
    )
    .all();
}

function companyOptions(db) {
  return db.prepare('SELECT id, name FROM companies ORDER BY name COLLATE NOCASE').all();
}

module.exports = {
  ENTITIES,
  ValidationError,
  validate,
  get,
  save,
  remove,
  deleteImpact,
  listFamily,
  listCompanies,
  listContacts,
  listNotes,
  companyOptions,
};
