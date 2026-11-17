'use strict';

/**
 * End-to-end: Family, Companies and Contacts screens (milestone 3a).
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

test('family, companies and contacts', { skip: !playwright && 'playwright not installed' }, async () => {
  const { app, win } = await launchAndSetUp();
  const shots = process.env.SCREENSHOTS;
  const snap = async (name) => shots && win.screenshot({ path: path.join(shots, `${name}.png`) });

  try {
    // Contacts need a company first.
    await win.click('a.nav-item[href$="/contacts"]');
    await win.waitForSelector('text=Add a company first');

    // Add a company; a missing name is caught on the field.
    await win.click('a.nav-item[href$="/companies"]');
    await win.click('.page-header >> text=Add company');
    await win.waitForURL('pom://app/companies/new');
    await win.click('button[type=submit]');
    await win.waitForSelector('[data-error-for=name]:not([hidden])');
    await win.fill('input[name=name]', 'Fidelity Investments');
    await win.selectOption('select[name=kind]', 'brokerage');
    await win.fill('input[name=phone]', '800-343-3548');
    await win.fill('input[name=website]', 'fidelity.com');
    await win.click('button[type=submit]');
    await win.waitForURL('pom://app/companies');

    await win.click('.page-header >> text=Add company');
    await win.fill('input[name=name]', 'Chase Bank');
    await win.selectOption('select[name=kind]', 'bank');
    await win.click('button[type=submit]');
    await win.waitForURL('pom://app/companies');
    assert.deepEqual(await win.locator('table .row-link').allTextContents(), ['Chase Bank', 'Fidelity Investments']);

    // Search filter.
    await win.fill('[data-filter]', 'fidel');
    assert.equal(await win.locator('table tbody tr:not([hidden])').count(), 1);
    await win.fill('[data-filter]', 'zzz');
    await win.waitForSelector('.no-match:not([hidden])');
    await win.fill('[data-filter]', '');

    // Add a contact from the company page; it comes back to the company.
    await win.click('text=Fidelity Investments');
    await win.waitForURL(/companies\/\d+$/);
    const companyUrl = win.url();
    await win.click('text=Add contact');
    await win.waitForURL(/contacts\/new\?company=\d+/);
    assert.notEqual(await win.inputValue('select[name=company_id]'), '');
    await win.fill('input[name=name]', 'Dana Advisor');
    await win.fill('input[name=title]', 'Financial Advisor');
    await win.fill('input[name=email]', 'not-an-email');
    await win.click('button[type=submit]');
    await win.waitForSelector('[data-error-for=email]:not([hidden])');
    await win.fill('input[name=email]', 'dana@example.com');
    await win.fill('input[name=phone]', '555-0100');
    await win.click('button[type=submit]');
    await win.waitForURL(companyUrl);
    await win.waitForSelector('text=Dana Advisor');
    await snap('3a-company');

    // Contacts list shows the company.
    await win.click('a.nav-item[href$="/contacts"]');
    await win.waitForSelector('td:has-text("Fidelity Investments")');
    await snap('3a-contacts');

    // Family: a person and a trust.
    await win.click('a.nav-item[href$="/family"]');
    await win.click('.page-header >> text=Add family member');
    await win.fill('input[name=name]', 'Sarah Park');
    await win.fill('input[name=relationship]', 'Spouse');
    await win.click('button[type=submit]');
    await win.waitForURL('pom://app/family');
    await win.click('.page-header >> text=Add family member');
    await win.fill('input[name=name]', 'Park Family Trust');
    await win.selectOption('select[name=kind]', 'trust');
    await win.fill('input[name=relationship]', 'Holds the house for the kids');
    await win.click('button[type=submit]');
    await win.waitForURL('pom://app/family');
    assert.deepEqual(await win.locator('table .row-link').allTextContents(), ['Sarah Park', 'Park Family Trust']);
    await snap('3a-family');

    // Edit a family member.
    await win.click('text=Sarah Park');
    await win.fill('input[name=name]', 'Sarah J. Park');
    await win.click('button[type=submit]');
    await win.waitForURL('pom://app/family');
    await win.waitForSelector('text=Sarah J. Park');

    // Deleting a company warns that its contacts go too.
    await win.goto(companyUrl);
    await snap('3a-company-form');
    await win.click('[data-delete]');
    await win.waitForSelector('[data-confirm]:not([hidden])');
    assert.match(await win.textContent('[data-confirm-text]'), /Its 1 contact will be deleted too\./);
    await snap('3a-delete-confirm');
    await win.click('[data-confirm-yes]');
    await win.waitForURL('pom://app/companies');
    assert.deepEqual(await win.locator('table .row-link').allTextContents(), ['Chase Bank']);
    await win.goto('pom://app/contacts');
    await win.waitForSelector('text=No contacts yet');

    // Data survives a lock.
    await win.click('[data-action=lock]');
    await win.waitForURL('pom://app/unlock');
    await win.fill('input[name=password]', PW);
    await win.click('button[type=submit]');
    await win.waitForURL('pom://app/dashboard');
    await win.goto('pom://app/family');
    assert.equal(await win.locator('table .row-link').count(), 2);
  } finally {
    await app.close();
  }
});
