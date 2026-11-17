'use strict';

/**
 * End-to-end: Month-End values and dashboard (milestone 3c).
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

const ym = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const now = new Date();
const LAST = ym(new Date(now.getFullYear(), now.getMonth() - 1, 1));
const BEFORE = ym(new Date(now.getFullYear(), now.getMonth() - 2, 1));
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const label = (m) => `${MONTHS[Number(m.slice(5)) - 1]} ${m.slice(0, 4)}`;

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

async function addAccount(win, nickname, type) {
  await win.goto('pom://app/accounts/new');
  await win.fill('[name=nickname]', nickname);
  await win.selectOption('select[name=type_code]', type);
  await win.fill('[name=opened_on]', '2020-01-01');
  await win.click('button[type=submit]');
  await win.waitForURL('pom://app/accounts');
}

const row = (win, name) => win.locator(`tr[data-account]:has(a:text-is("${name}"))`);

test('month-end grid, carry-forward and dashboard', { skip: !playwright && 'playwright not installed' }, async () => {
  const { app, win } = await launchAndSetUp();
  const shots = process.env.SCREENSHOTS;
  const snap = async (name) => shots && win.screenshot({ path: path.join(shots, `${name}.png`) });

  try {
    await win.click('a.nav-item[href$="/month-end"]');
    await win.waitForSelector('text=No accounts were open');

    await addAccount(win, 'Joint checking', 'checking');
    await addAccount(win, "Mike's 401(k)", '401k');
    await addAccount(win, 'House', 'home');
    await addAccount(win, 'Mortgage', 'mortgage');
    await addAccount(win, 'Visa', 'credit_card');

    // Enter the month before last.
    await win.goto(`pom://app/month-end?month=${BEFORE}`);
    await win.waitForSelector(`h1:has-text("Month-End")`);
    await row(win, 'Joint checking').locator('[data-value]').fill('12,000');
    await row(win, "Mike's 401(k)").locator('[data-value]').fill('250000');
    await row(win, 'House').locator('[data-value]').fill('450000');
    await row(win, 'Mortgage').locator('[data-value]').fill('210000');
    await row(win, 'Visa').locator('[data-value]').fill('abc');
    // Live total updates before saving (Visa invalid, so ignored).
    assert.equal(await win.textContent('[data-total=net]'), '$502,000');
    await win.click('button[type=submit]');
    await win.waitForSelector('[data-error-for="value-5"]:not([hidden]), .field-error:not([hidden])');
    await row(win, 'Visa').locator('[data-value]').fill('1500');
    await row(win, 'Visa').locator('[data-note]').fill('paid in full each month');
    await win.click('button[type=submit]');
    await win.waitForURL(/saved=1/);
    assert.equal(await win.textContent('[data-total=net]'), '$500,500');

    // Last month: placeholders show carried values; "Same as last" and "Fill empty".
    await win.goto(`pom://app/month-end?month=${LAST}`);
    assert.equal(await row(win, 'Joint checking').locator('[data-value]').getAttribute('placeholder'), '12000');
    assert.equal(await win.textContent('[data-total=net]'), '$500,500'); // carried forward
    await row(win, 'Joint checking').locator('[data-value]').fill('13500');
    await row(win, "Mike's 401(k)").locator('[data-value]').fill('256000');
    await row(win, 'Mortgage').locator('[data-value]').fill('209000');
    await row(win, 'Visa').locator('[data-copy]').click();
    assert.equal(await row(win, 'Visa').locator('[data-value]').inputValue(), '1500');
    await snap('3c-month-end');
    await win.click('button[type=submit]');
    await win.waitForURL(/saved=1/);
    // House carried at 450,000: 13,500 + 256,000 + 450,000 - 209,000 - 1,500
    assert.equal(await win.textContent('[data-total=net]'), '$509,000');

    // Dashboard: headline for last month, change, and the missing reminder for the house.
    await win.click('a.nav-item[href$="/dashboard"]');
    await win.waitForSelector(`text=Net worth · ${label(LAST)}`);
    const stat = await win.locator('.stat-value').first().textContent();
    assert.equal(stat.trim(), '$509,000');
    await win.waitForSelector('text=+$8,500');
    await win.waitForSelector(`text=1 account is missing ${label(LAST)} values`);
    await snap('3c-dashboard');

    // Fill empty boxes, save, and the reminder is gone.
    await win.click('text=Enter values');
    await win.click('[data-copy-all]');
    assert.equal(await row(win, 'House').locator('[data-value]').inputValue(), '450000');
    await win.click('button[type=submit]');
    await win.waitForURL(/saved=1/);
    await win.goto('pom://app/dashboard');
    assert.equal(await win.locator('text=missing').count(), 0);

    // Clearing a value removes the entry so it carries forward again.
    await win.goto(`pom://app/month-end?month=${LAST}`);
    await row(win, 'Joint checking').locator('[data-value]').fill('');
    await win.click('button[type=submit]');
    await win.waitForURL(/saved=1/);
    assert.equal(await row(win, 'Joint checking').locator('[data-value]').inputValue(), '');
    assert.equal(await row(win, 'Joint checking').locator('[data-value]').getAttribute('placeholder'), '12000');

    // The account page shows its history; the accounts list shows latest values.
    await win.click("a.row-link:text-is(\"Mike's 401(k)\")");
    await win.waitForSelector(`td:has-text("${label(LAST)}")`);
    await win.waitForSelector('td:has-text("$256,000")');
    await win.goto('pom://app/accounts');
    await win.waitForSelector('text=$256,000');
  } finally {
    await app.close();
  }
});
