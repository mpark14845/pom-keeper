'use strict';

/**
 * Serves pom://app/... : static assets and EJS pages rendered in the main
 * process (spec 3.1).
 */

const fs = require('node:fs');
const path = require('node:path');
const ejs = require('ejs');
const { APP_ORIGIN, CSP } = require('./security');

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
  { id: 'accounts', label: 'Accounts', icon: 'layers', soon: true },
  { id: 'month-end', label: 'Month-End', icon: 'calendar', soon: true },
  { id: 'companies', label: 'Companies', icon: 'building', soon: true },
  { id: 'contacts', label: 'Contacts', icon: 'user', soon: true },
  { id: 'family', label: 'Family', icon: 'users', soon: true },
  { id: 'notes', label: 'Notes', icon: 'file', soon: true },
  { id: 'passwords', label: 'Passwords', icon: 'key', soon: true },
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
  const locals = { nav: NAV, active: null, title: 'POM Keeper', layout: 'app', scripts: [], ...data };
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
      case '/dashboard':
        return render('dashboard', { active: 'dashboard', title: 'Dashboard', settings });
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
        return notFound();
    }
  };
}

module.exports = { createRouter, NAV };
