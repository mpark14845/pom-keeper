'use strict';

/**
 * End-to-end smoke test: launches the real Electron app against a temporary
 * data folder, walks first-run setup, settings, lock and unlock, and checks
 * that no network request was attempted.
 *
 *   npm run test:e2e            (Linux CI: xvfb-run -a npm run test:e2e)
 *   SCREENSHOTS=some/folder npm run test:e2e   to save screenshots
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

let playwright;
try {
  playwright = require('playwright');
} catch {
  playwright = null;
}

const ROOT = path.join(__dirname, '..', '..');
const PW = 'my long test password';

test('first run, settings, lock and unlock (offline)', { skip: !playwright && 'playwright not installed' }, async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pom-e2e-'));
  const shots = process.env.SCREENSHOTS;
  const logs = [];

  const app = await playwright._electron.launch({
    executablePath: require('electron'),
    args: [ROOT, '--no-sandbox'],
    env: { ...process.env, POM_DATA_DIR: dataDir },
  });
  app.process().stdout.on('data', (d) => logs.push(String(d)));
  app.process().stderr.on('data', (d) => logs.push(String(d)));

  try {
    const win = await app.firstWindow();
    const snap = async (name) => shots && win.screenshot({ path: path.join(shots, `${name}.png`) });
    await win.setViewportSize({ width: 1280, height: 820 });

    // Setup: mismatched passwords are caught.
    await win.waitForURL('pom://app/setup');
    await win.fill('input[name=password]', PW);
    await win.fill('input[name=confirm]', 'something else entirely');
    await win.click('button[type=submit]');
    await win.waitForSelector('.form-error:not([hidden])');
    await snap('01-setup');

    await win.fill('input[name=confirm]', PW);
    await win.click('button[type=submit]');

    // Recovery key shown once.
    await win.waitForURL('pom://app/recovery-key');
    const key = (await win.textContent('[data-recovery-key]')).trim();
    assert.match(key, /^[0-9A-Z]{4}(-[0-9A-Z]{4}){5}$/);
    await snap('02-recovery-key');

    // The printable recovery sheet renders the same key.
    await win.goto('pom://app/print/recovery-key');
    assert.equal((await win.textContent('.key')).trim(), key);
    await snap('02b-recovery-sheet');
    await win.goto('pom://app/recovery-key');
    await win.check('input[name=saved]');
    await win.click('#recovery-form button[type=submit]');

    await win.waitForURL('pom://app/setup/backup');
    await snap('03-backup');
    await win.click('[data-finish]');

    await win.waitForURL('pom://app/dashboard');
    assert.equal(await win.locator('.banner-warn').count(), 0);
    await snap('04-dashboard');

    // Settings: invalid then valid lock time.
    await win.click('a.nav-item[href$="/settings"]');
    await win.waitForURL('pom://app/settings');
    await win.fill('#lock-form input[name=lock_minutes]', '2');
    await win.click('#lock-form button[type=submit]');
    await win.waitForSelector('#lock-form .form-error:not([hidden])');
    await win.fill('#lock-form input[name=lock_minutes]', '45');
    await win.click('#lock-form button[type=submit]');
    await win.waitForSelector('#lock-form .form-ok:not([hidden])');
    await snap('05-settings');

    // Lock, wrong password, then unlock.
    await win.click('[data-action=lock]');
    await win.waitForURL('pom://app/unlock');
    await win.fill('input[name=password]', 'not my password');
    await win.click('button[type=submit]');
    await win.waitForSelector('.form-error:not([hidden])');
    await snap('06-unlock');
    await win.fill('input[name=password]', PW);
    await win.click('button[type=submit]');
    await win.waitForURL('pom://app/dashboard');

    // Setting survived the lock.
    await win.goto('pom://app/settings');
    assert.equal(await win.inputValue('#lock-form input[name=lock_minutes]'), '45');

    // The page itself can't reach the internet (CSP)...
    const fromPage = await win.evaluate(() =>
      new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve('loaded');
        img.onerror = () => resolve('blocked');
        img.src = 'https://example.com/pixel.png';
      })
    );
    assert.equal(fromPage, 'blocked');
    // ...and neither can anything going through the app's network session.
    const fromSession = await app.evaluate(async ({ net }) => {
      try {
        await net.fetch('https://example.com/');
        return 'loaded';
      } catch {
        return 'blocked';
      }
    });
    assert.equal(fromSession, 'blocked');
  } finally {
    await app.close();
  }

  // On disk: key header + encrypted DB, nothing readable.
  assert.ok(fs.existsSync(path.join(dataDir, 'pomkeeper.keys.json')));
  const db = fs.readFileSync(path.join(dataDir, 'pomkeeper.db'));
  assert.ok(!db.subarray(0, 16).toString('latin1').startsWith('SQLite format 3'));

  // The only network attempt should be the one we made on purpose.
  const blocked = logs.join('').split('\n').filter((l) => l.includes('[pom:net] blocked'));
  assert.deepEqual(blocked.map((l) => l.replace(/^.*blocked /, '').trim()), ['GET https://example.com/']);
});
