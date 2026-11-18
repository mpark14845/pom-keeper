'use strict';

/**
 * End-to-end: Notes and Passwords (milestone 3d).
 *   npm run test:e2e   (Linux CI: xvfb-run -a npm run test:e2e)
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

async function launchAndSetUp() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pom-e2e-'));
  const app = await playwright._electron.launch({
    executablePath: require('electron'),
    args: [ROOT, '--no-sandbox'],
    env: { ...process.env, POM_DATA_DIR: dataDir },
  });
  const win = await app.firstWindow();
  await win.setViewportSize({ width: 1280, height: 820 });
  await win.waitForURL('pom://app/setup');
  await win.fill('input[name=password]', PW);
  await win.fill('input[name=confirm]', PW);
  await win.click('button[type=submit]');
  await win.waitForURL('pom://app/recovery-key');
  await win.check('input[name=saved]');
  await win.click('#recovery-form button[type=submit]');
  await win.waitForURL('pom://app/setup/backup');
  await win.click('[data-finish]');
  await win.waitForURL('pom://app/dashboard');
  return { app, win };
}

async function addRecord(win, entity, fields, selects = {}) {
  await win.goto(`pom://app/${entity}/new`);
  for (const [k, v] of Object.entries(fields)) await win.fill(`[name=${k}]`, v);
  for (const [k, v] of Object.entries(selects)) await win.selectOption(`select[name=${k}]`, { label: v });
  await win.click('button[type=submit]');
  await win.waitForURL(`pom://app/${entity}`);
}

test('notes and passwords', { skip: !playwright && 'playwright not installed' }, async () => {
  const { app, win } = await launchAndSetUp();
  const shots = process.env.SCREENSHOTS;
  const snap = async (name, full) => shots && win.screenshot({ path: path.join(shots, `${name}.png`), fullPage: !!full });

  try {
    // Notes: grouped by category, print flag shown as a badge.
    await win.click('a.nav-item[href$="/notes"]');
    await win.waitForSelector('text=No notes yet');
    await win.goto('pom://app/notes/new');
    await win.click('button[type=submit]');
    await win.waitForSelector('[data-error-for=title]:not([hidden])');
    await win.fill('[name=title]', 'Where the will is');
    await win.selectOption('select[name=category]', 'legal');
    await win.fill('[name=body]', 'Original is in the fire safe in the hall closet.\nCopy with Jane Smith, attorney.');
    await win.click('button[type=submit]');
    await win.waitForURL('pom://app/notes');
    await win.goto('pom://app/notes/new');
    await win.fill('[name=title]', 'Cash in the house');
    await win.selectOption('select[name=category]', 'location');
    await win.fill('[name=body]', 'Envelope taped under the top desk drawer.');
    await win.uncheck('[name=include_in_print]');
    await win.click('button[type=submit]');
    await win.waitForURL('pom://app/notes');
    await win.goto('pom://app/notes/new');
    await win.fill('[name=title]', 'First steps');
    await win.selectOption('select[name=category]', 'instructions');
    await win.fill('[name=body]', 'Call Dana at Fidelity, then the attorney.');
    await win.click('button[type=submit]');
    await win.waitForURL('pom://app/notes');
    const heads = await win.$$eval('[data-group] .card-head h2', (els) => els.map((e) => e.textContent.trim()));
    assert.deepEqual(heads, ['Instructions', 'Legal documents', 'Where things are']);
    const cashRow = win.locator('tr', { hasText: 'Cash in the house' });
    assert.equal(await cashRow.locator('.badge').textContent(), 'Not printed');
    await snap('3d-notes', true);

    // Unchecking survives an edit-and-save round trip; re-checking turns it back on.
    await cashRow.locator('a.row-link').click();
    assert.equal(await win.isChecked('[name=include_in_print]'), false);
    await win.check('[name=include_in_print]');
    await win.click('button[type=submit]');
    await win.waitForURL('pom://app/notes');
    assert.equal(await win.locator('tr', { hasText: 'Cash in the house' }).locator('.badge').count(), 0);

    // An account to link a password to.
    await addRecord(win, 'companies', { name: 'Chase' }, { kind: 'Bank' });
    await win.goto('pom://app/accounts/new');
    await win.fill('[name=nickname]', 'Joint checking');
    await win.selectOption('select[name=type_code]', 'checking');
    await win.selectOption('select[name=company_id]', { label: 'Chase' });
    await win.click('button[type=submit]');
    await win.waitForURL('pom://app/accounts');

    // Passwords.
    await win.click('a.nav-item[href$="/passwords"]');
    await win.waitForSelector('text=No passwords yet');
    await win.goto('pom://app/passwords/new');
    await win.fill('[name=title]', 'Chase online banking');
    await win.selectOption('select[name=link]', { label: 'Joint checking' });
    await win.fill('[name=website_url]', 'chase.com');
    await win.fill('[name=username]', 'mpark');
    await win.fill('[name=password]', 'Tr0ub4dor & 3');
    await win.click('[data-toggle-pw]');
    assert.equal(await win.getAttribute('[name=password]', 'type'), 'text');
    await win.fill('[name=pin]', '4321');
    await snap('3d-password-form', true);
    await win.click('button[type=submit]');
    await win.waitForURL('pom://app/passwords');

    // A generated password is 20 characters.
    await win.goto('pom://app/passwords/new');
    await win.fill('[name=title]', 'Home Wi-Fi');
    await win.click('[data-generate]');
    const generated = await win.inputValue('[name=password]');
    assert.equal(generated.length, 20);
    await win.click('button[type=submit]');
    await win.waitForURL('pom://app/passwords');

    // The list never contains the secret until it is revealed.
    assert.ok(!(await win.content()).includes('Tr0ub4dor'));
    const row = win.locator('tr', { hasText: 'Chase online banking' });
    assert.ok((await row.textContent()).includes('Account: Joint checking'));
    await row.locator('[data-reveal]').click();
    await win.waitForFunction(() => document.body.textContent.includes('Tr0ub4dor & 3'));
    assert.equal(win.url(), 'pom://app/passwords', 'reveal does not open the row');
    await row.locator('[data-copy-secret]').click();
    await win.waitForSelector('[data-toast]:not([hidden])');
    assert.equal(await app.evaluate(({ clipboard }) => clipboard.readText()), 'Tr0ub4dor & 3');
    await snap('3d-passwords');
    await row.locator('[data-reveal]').click();
    assert.equal(await row.locator('[data-secret]').textContent(), '••••••••');

    // The account page lists the linked password, and adding from there links it.
    await win.goto('pom://app/accounts');
    await win.click('a.row-link:has-text("Joint checking")');
    await win.waitForSelector('.plain-list >> text=Chase online banking');
    const accountId = win.url().match(/accounts\/(\d+)/)[1];
    const accountUrl = `pom://app/accounts/${accountId}`;
    await win.click('text=Add password');
    assert.equal(await win.inputValue('select[name=link]'), `account:${accountId}`);
    await win.fill('[name=title]', 'Chase mobile app PIN');
    await win.fill('[name=pin]', '9999');
    await win.click('button[type=submit]');
    await win.waitForURL(accountUrl);
    assert.equal(await win.locator('.plain-list li').count(), 2);

    // Delete one.
    await win.goto('pom://app/passwords');
    await win.click('a.row-link:has-text("Home Wi-Fi")');
    await win.click('[data-delete]');
    await win.click('[data-confirm-yes]');
    await win.waitForURL('pom://app/passwords');
    assert.equal(await win.locator('a.row-link:has-text("Home Wi-Fi")').count(), 0);
  } finally {
    await app.close();
  }
});
