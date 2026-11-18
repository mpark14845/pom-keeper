'use strict';

/**
 * Serves pom://app/... : static assets and EJS pages rendered in the main
 * process (spec 3.1).
 */

const fs = require('node:fs');
const path = require('node:path');
const ejs = require('ejs');
const { APP_ORIGIN, CSP } = require('./security');
const repo = require('./repos/entities');
const acc = require('./repos/accounts');
const nw = require('./repos/networth');
const cred = require('./repos/credentials');
const fmt = require('./format');

const ROOT = path.join(__dirname, '..');
const VIEWS = path.join(ROOT, 'views');
const PUBLIC = path.join(ROOT, 'public');
const FONTS = path.join(path.dirname(require.resolve('@fontsource/inter/package.json')), 'files');

const MIME = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
};

const NAV = [
  { id: 'dashboard', label: 'Dashboard', icon: 'grid', href: '/dashboard' },
  { id: 'accounts', label: 'Accounts', icon: 'layers', href: '/accounts' },
  { id: 'month-end', label: 'Month-End', icon: 'calendar', href: '/month-end' },
  { id: 'companies', label: 'Companies', icon: 'building', href: '/companies' },
  { id: 'contacts', label: 'Contacts', icon: 'user', href: '/contacts' },
  { id: 'family', label: 'Family', icon: 'users', href: '/family' },
  { id: 'notes', label: 'Notes', icon: 'file', href: '/notes' },
  { id: 'passwords', label: 'Passwords', icon: 'key', href: '/passwords' },
  { id: 'print', label: 'Print Center', icon: 'printer', soon: true },
  { id: 'settings', label: 'Settings', icon: 'settings', href: '/settings' },
];

function headers(type) {
  return { 'content-type': type, 'content-security-policy': CSP, 'cache-control': 'no-store' };
}

function redirect(to) {
  return new Response(null, { status: 302, headers: { location: `${APP_ORIGIN}${to}` } });
}

function notFound() {
  return new Response('Not found', { status: 404, headers: headers('text/plain') });
}

/** Resolve a path inside base, refusing anything that escapes it. */
function safeJoin(base, rel) {
  const full = path.normalize(path.join(base, rel));
  return full.startsWith(base + path.sep) ? full : null;
}

function serveStatic(pathname) {
  let file = null;
  if (pathname.startsWith('/static/fonts/')) {
    const name = path.basename(pathname);
    if (/^inter-latin-(400|500|600|700)-normal\.woff2$/.test(name)) file = path.join(FONTS, name);
  } else {
    file = safeJoin(PUBLIC, pathname.slice('/static/'.length));
  }
  const type = file && MIME[path.extname(file)];
  if (!type || !fs.existsSync(file)) return notFound();
  return new Response(fs.readFileSync(file), { headers: headers(type) });
}

async function render(page, data) {
  const locals = { nav: NAV, active: null, title: 'POM Keeper', layout: 'app', scripts: [], fmt, ...data };
  const body = await ejs.renderFile(path.join(VIEWS, 'pages', `${page}.ejs`), locals);
  const html = await ejs.renderFile(path.join(VIEWS, `layout-${locals.layout}.ejs`), { ...locals, body });
  return new Response(html, { headers: headers('text/html; charset=utf-8') });
}

async function renderPrint(page, data) {
  const html = await ejs.renderFile(path.join(VIEWS, 'print', `${page}.ejs`), data);
  return new Response(html, { headers: headers('text/html; charset=utf-8') });
}

function createRouter({ session, dataDir }) {
  return async function handle(request) {
    const url = new URL(request.url);
    if (url.host !== 'app' || request.method !== 'GET') return notFound();
    const p = url.pathname.replace(/\/+$/, '') || '/';
    if (p.startsWith('/static/')) return serveStatic(p);

    const state = session.state;

    // Pages available before unlocking.
    if (state === 'new') return p === '/setup' ? render('setup', { layout: 'auth', title: 'Welcome', scripts: ['setup'] }) : redirect('/setup');
    if (state === 'locked') {
      if (p === '/unlock') return render('unlock', { layout: 'auth', title: 'Unlock', scripts: ['unlock'] });
      if (p === '/recover') return render('recover', { layout: 'auth', title: 'Use recovery key', scripts: ['recover'] });
      return redirect('/unlock');
    }

    // Unlocked.
    const settings = session.settings();
    switch (p) {
      case '/':
      case '/setup':
      case '/unlock':
      case '/recover':
        return redirect(session.pendingRecoveryKey ? '/recovery-key' : '/dashboard');
      case '/recovery-key':
        if (!session.pendingRecoveryKey) return redirect('/settings');
        return render('recovery-key', {
          layout: 'auth',
          title: 'Your recovery key',
          scripts: ['recovery-key'],
          recoveryKey: session.pendingRecoveryKey,
          firstRun: settings.setup_complete !== '1',
        });
      case '/setup/backup':
        return render('setup-backup', { layout: 'auth', title: 'Backups', scripts: ['setup-backup'], settings });
      case '/dashboard': {
        const month = nw.lastCompletedMonth();
        const [prev, cur] = nw.series(session.db, nw.addMonths(month, -1), month);
        const counts = session.db
          .prepare("SELECT (SELECT count(*) FROM accounts) a, (SELECT count(*) FROM monthly_values) v")
          .get();
        return render('dashboard', {
          active: 'dashboard',
          title: 'Dashboard',
          settings,
          month,
          cur,
          prev,
          hasAccounts: counts.a > 0,
          hasValues: counts.v > 0,
          missing: nw.missingFor(session.db, month),
        });
      }
      case '/month-end': {
        const last = nw.lastCompletedMonth();
        const asked = url.searchParams.get('month');
        const month = nw.isMonth(asked) && asked <= nw.currentMonth() ? asked : last;
        const grid = nw.monthGrid(session.db, month);
        const choices = nw.monthsBetween(nw.addMonths(nw.currentMonth(), -35), nw.currentMonth()).reverse();
        return render('month-end', {
          active: 'month-end',
          title: 'Month-End',
          scripts: ['month-end'],
          grid,
          month,
          choices,
          canNext: month < nw.currentMonth(),
          next: nw.addMonths(month, 1),
          prevMonth: nw.addMonths(month, -1),
          saved: url.searchParams.get('saved'),
        });
      }
      case '/settings':
        return render('settings', {
          active: 'settings',
          title: 'Settings',
          scripts: ['settings'],
          settings,
          dataDir,
          saved: url.searchParams.get('saved'),
        });
      case '/print/recovery-key':
        if (!session.pendingRecoveryKey) return notFound();
        return renderPrint('recovery-key', {
          recoveryKey: session.pendingRecoveryKey,
          date: new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
        });
      default:
        return (
          accountRoutes(session.db, p, url) ||
          passwordRoutes(session.db, p, url) ||
          recordRoutes(session.db, p, url) ||
          notFound()
        );
    }
  };
}

const KIND_LABELS = {
  notes: { instructions: 'Instructions', legal: 'Legal documents', location: 'Where things are', other: 'Other' },
  family: { person: 'Person', trust: 'Trust', estate: 'Estate', other: 'Other' },
  companies: {
    bank: 'Bank', brokerage: 'Brokerage', insurer: 'Insurance', employer: 'Employer',
    lender: 'Lender', government: 'Government', other: 'Other',
  },
};

const SECTIONS = {
  family: { title: 'Family', singular: 'family member', overline: 'People & trusts' },
  companies: { title: 'Companies', singular: 'company', overline: 'Institutions' },
  contacts: { title: 'Contacts', singular: 'contact', overline: 'People to call' },
  notes: { title: 'Notes', singular: 'note', overline: 'Important information' },
};

/** /family, /companies, /contacts and their /new and /:id pages. */
function recordRoutes(db, p, url) {
  const m = p.match(/^\/(family|companies|contacts|notes)(?:\/(new|\d+))?$/);
  if (!m) return null;
  const [, entity, which] = m;
  const section = SECTIONS[entity];
  const base = { active: entity, kinds: KIND_LABELS, entity, section };

  if (!which) {
    const rows = {
      family: repo.listFamily,
      companies: repo.listCompanies,
      contacts: repo.listContacts,
      notes: repo.listNotes,
    }[entity](db);
    return render(`${entity}-list`, {
      ...base,
      title: section.title,
      scripts: ['list-filter'],
      rows,
      hasCompanies: entity !== 'contacts' || repo.companyOptions(db).length > 0,
    });
  }

  const record = which === 'new' ? null : repo.get(db, entity, which);
  if (which !== 'new' && !record) return null;
  const preset = {};
  if (entity === 'contacts' && which === 'new' && url.searchParams.get('company')) {
    preset.company_id = Number(url.searchParams.get('company'));
  }
  const back = url.searchParams.get('back');
  const returnTo = back && /^\/[a-z0-9/?=&-]*$/i.test(back) ? back : `/${entity}`;
  return render('record-form', {
    ...base,
    title: record ? record[repo.ENTITIES[entity].titleField || 'name'] : `New ${section.singular}`,
    scripts: ['record-form'],
    def: repo.ENTITIES[entity],
    record: record || preset,
    isNew: !record,
    returnTo,
    companies: entity === 'contacts' ? repo.companyOptions(db) : [],
    contacts: entity === 'companies' && record ? repo.listContacts(db, { companyId: record.id }) : [],
    linked: record && entity !== 'notes' ? linkedAccounts(db, entity, record.id) : null,
    passwords: record && entity !== 'notes' ? linkedPasswords(db, entity, record.id) : null,
  });
}

const LINK_TYPE = { accounts: 'account', companies: 'company', contacts: 'contact', family: 'family_member' };

function linkedPasswords(db, entity, id) {
  return { link: `${LINK_TYPE[entity]}:${id}`, rows: cred.list(db, { linkedType: LINK_TYPE[entity], linkedId: id }), back: `/${entity}/${id}` };
}

function safeBack(back, fallback) {
  return back && /^\/[a-z0-9/?=&:-]*$/i.test(back) ? back : fallback;
}

/** /passwords, /passwords/new, /passwords/:id */
function passwordRoutes(db, p, url) {
  const m = p.match(/^\/passwords(?:\/(new|\d+))?$/);
  if (!m) return null;
  const which = m[1];
  if (!which) {
    return render('passwords-list', {
      active: 'passwords',
      title: 'Passwords',
      scripts: ['list-filter', 'passwords'],
      rows: cred.list(db),
    });
  }
  const record = which === 'new' ? null : cred.get(db, which);
  if (which !== 'new' && !record) return null;
  const preset = { include_in_print: 1 };
  const presetLink = url.searchParams.get('link');
  if (!record && presetLink && /^[a-z_]+:\d+$/.test(presetLink)) {
    const [t, i] = presetLink.split(':');
    preset.linked_type = t;
    preset.linked_id = Number(i);
  }
  return render('password-form', {
    active: 'passwords',
    title: record ? record.title : 'New password',
    scripts: ['password-form'],
    record: record || preset,
    isNew: !record,
    returnTo: safeBack(url.searchParams.get('back'), '/passwords'),
    linkOptions: cred.linkOptions(db),
  });
}

function linkedAccounts(db, entity, id) {
  if (entity === 'companies') return [{ title: 'Accounts', rows: acc.accountsForCompany(db, id), addHref: `/accounts/new?company=${id}` }];
  if (entity === 'contacts') return [{ title: 'Accounts this contact handles', rows: acc.accountsForContact(db, id) }];
  const f = acc.accountsForFamily(db, id);
  return [
    { title: 'Owns', rows: f.owns },
    { title: 'Beneficiary of', rows: f.beneficiaryOf },
  ];
}

const VIEWS_LIST = [
  { id: 'type', label: 'Account type' },
  { id: 'account', label: 'Account' },
  { id: 'company', label: 'Company' },
  { id: 'contact', label: 'Contact' },
];

/** /accounts, /accounts/new, /accounts/:id */
function accountRoutes(db, p, url) {
  const m = p.match(/^\/accounts(?:\/(new|\d+))?$/);
  if (!m) return null;
  const which = m[1];
  if (!which) {
    const view = VIEWS_LIST.some((v) => v.id === url.searchParams.get('view')) ? url.searchParams.get('view') : 'type';
    const includeClosed = url.searchParams.get('closed') === '1';
    const { groups, rows } = acc.groupAccounts(db, view, { includeClosed });
    return render('accounts-list', {
      active: 'accounts',
      title: 'Accounts',
      scripts: ['list-filter'],
      view,
      views: VIEWS_LIST,
      includeClosed,
      groups,
      totals: acc.summary(rows),
      count: rows.length,
      mask: acc.mask,
    });
  }
  const account = which === 'new' ? null : acc.getAccount(db, which);
  if (which !== 'new' && !account) return null;
  const preset = { status: 'open' };
  if (!account) {
    if (url.searchParams.get('company')) preset.company_id = Number(url.searchParams.get('company'));
    if (url.searchParams.get('type')) preset.type_code = url.searchParams.get('type');
  }
  const back = url.searchParams.get('back');
  return render('account-form', {
    active: 'accounts',
    title: account ? account.nickname : 'New account',
    scripts: ['account-form'],
    account: account || preset,
    isNew: !account,
    returnTo: back && /^\/[a-z0-9/?=&-]*$/i.test(back) ? back : '/accounts',
    opts: acc.formOptions(db, account && account.id),
    passwords: account ? linkedPasswords(db, 'accounts', account.id) : null,
  });
}

module.exports = { createRouter, NAV };
