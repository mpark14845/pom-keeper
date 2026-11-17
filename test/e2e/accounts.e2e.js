'use strict';

/**
 * End-to-end: Accounts (milestone 3b).
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

test('accounts: add, link people, secure a loan, views, close', { skip: !playwright && 'playwright not installed' }, async () => {
  const { app, win } = await launchAndSetUp();
  const shots = process.env.SCREENSHOTS;
  const snap = async (name, full) => shots && win.screenshot({ path: path.join(shots, `${name}.png`), fullPage: !!full });

  try {
    await addRecord(win, 'companies', { name: 'Fidelity' }, { kind: 'Brokerage' });
    await addRecord(win, 'companies', { name: 'Honda Financial' }, { kind: 'Lender' });
    await addRecord(win, 'family', { name: 'Mike Park', relationship: 'Self' });
    await addRecord(win, 'family', { name: 'Sarah Park', relationship: 'Spouse' });
    await addRecord(win, 'family', { name: 'Park Family Trust' }, { kind: 'Trust' });
    await win.goto('pom://app/contacts/new');
    await win.selectOption('select[name=company_id]', { label: 'Fidelity' });
    await win.fill('[name=name]', 'Dana Advisor');
    await win.click('button[type=submit]');
    await win.waitForURL('pom://app/contacts');

    // Empty state.
    await win.click('a.nav-item[href$="/accounts"]');
    await win.waitForSelector('text=No open accounts yet');

    // A 401(k) with contact, owner and beneficiaries.
    await win.click('.page-header >> text=Add account');
    await win.waitForURL('pom://app/accounts/new');
    await win.click('button[type=submit]');
    await win.waitForSelector('[data-error-for=nickname]:not([hidden])');
    await win.fill('[name=nickname]', "Mike's 401(k)");
    await win.selectOption('select[name=type_code]', '401k');
    assert.equal(await win.isVisible('select[name=secured_by_account_id]'), false);
    await win.selectOption('select[name=company_id]', { label: 'Fidelity' });
    await win.fill('[name=account_number]', 'Z12345678');
    await win.click('[data-add-link=contacts]');
    await win.selectOption('[data-links=contacts] .link-row select[data-k=contact_id]', { label: 'Dana Advisor (Fidelity)' });
    await win.selectOption('[data-links=contacts] .link-row select[data-k=role]', 'advisor');
    await win.click('[data-add-link=owners]');
    await win.selectOption('[data-links=owners] .link-row select[data-k=family_member_id]', { label: 'Mike Park' });
    await win.click('[data-add-link=beneficiaries]');
    await win.selectOption('[data-links=beneficiaries] .link-row:nth-child(1) select[data-k=family_member_id]', { label: 'Sarah Park' });
    await win.fill('[data-links=beneficiaries] .link-row:nth-child(1) [data-k=share_pct]', '100');
    await win.click('[data-add-link=beneficiaries]');
    await win.selectOption('[data-links=beneficiaries] .link-row:nth-child(2) select[data-k=family_member_id]', { label: 'Park Family Trust (trust)' });
    await win.selectOption('[data-links=beneficiaries] .link-row:nth-child(2) select[data-k=level]', 'contingent');
    await snap('3b-account-form', true);
    await win.click('button[type=submit]');
    await win.waitForURL('pom://app/accounts');

    // A car and a loan secured by it.
    await win.click('.page-header >> text=Add account');
    await win.fill('[name=nickname]', 'Honda CR-V');
    await win.selectOption('select[name=type_code]', 'vehicle');
    await win.click('button[type=submit]');
    await win.waitForURL('pom://app/accounts');

    await win.click('.page-header >> text=Add account');
    await win.fill('[name=nickname]', 'Car loan');
    await win.selectOption('select[name=type_code]', 'auto_loan');
    assert.equal(await win.isVisible('select[name=secured_by_account_id]'), true);
    assert.equal(await win.isVisible('[data-links=beneficiaries]'), false);
    await win.selectOption('select[name=company_id]', { label: 'Honda Financial' });
    await win.selectOption('select[name=secured_by_account_id]', { label: 'Honda CR-V (Vehicle)' });
    await win.click('button[type=submit]');
    await win.waitForURL('pom://app/accounts');

    // Term life: death benefit shown, not counted.
    await win.click('.page-header >> text=Add account');
    await win.fill('[name=nickname]', 'Term life policy');
    await win.selectOption('select[name=type_code]', 'term_life');
    await win.fill('[name=face_amount]', '1,000,000');
    await win.click('button[type=submit]');
    await win.waitForURL('pom://app/accounts');

    // Default view: by type, in spec order. Account numbers are masked.
    const groups = await win.locator('[data-group] h2').allTextContents();
    assert.deepEqual(groups, ['Assets / Retirement', 'Assets / Property & Vehicles', 'Liabilities / Long Term', 'Info only / Insurance']);
    await win.waitForSelector('td.mono:has-text("••••5678")');
    await win.waitForSelector('text=$1,000,000 benefit');
    await snap('3b-accounts-by-type');

    // Other views.
    await win.click('.seg:has-text("Company")');
    await win.waitForURL(/view=company/);
    assert.deepEqual(await win.locator('[data-group] h2').allTextContents(), ['Fidelity', 'Honda Financial', 'No company']);
    await win.click('.seg:has-text("Contact")');
    assert.deepEqual(await win.locator('[data-group] h2').allTextContents(), ['Dana Advisor', 'No contact']);
    await snap('3b-accounts-by-contact');
    await win.click('.seg:has-text("Account")');
    assert.equal(await win.locator('table .row-link').count(), 4);

    // Search across groups.
    await win.click('.seg:has-text("Account type")');
    await win.fill('[data-filter]', 'honda');
    assert.equal(await win.locator('[data-group]:not([hidden])').count(), 2); // the car, and the loan from Honda Financial
    await win.fill('[data-filter]', '');

    // The car shows what it secures; the 401(k) kept its people.
    await win.click('text=Honda CR-V');
    await win.waitForSelector('text=Secures');
    await win.goBack();
    await win.click("text=Mike's 401(k)");
    assert.equal(await win.locator('[data-links=beneficiaries] .link-row').count(), 2);
    assert.equal(await win.inputValue('[name=account_number]'), 'Z12345678');

    // Close it: needs a date, then it drops out of the default list.
    await win.selectOption('select[name=status]', 'closed');
    await win.click('button[type=submit]');
    await win.waitForSelector('[data-error-for=closed_on]:not([hidden])');
    await win.fill('[name=closed_on]', '2026-06-30');
    await win.click('button[type=submit]');
    await win.waitForURL('pom://app/accounts');
    assert.equal(await win.locator("text=Mike's 401(k)").count(), 0);
    await win.click('text=Show closed accounts');
    await win.waitForSelector("text=Mike's 401(k)");
    await win.waitForSelector('.badge-closed');

    // Family and company pages list their accounts.
    await win.goto('pom://app/family');
    await win.click('text=Park Family Trust');
    await win.waitForSelector('h2:has-text("Beneficiary of")');
    assert.equal(await win.locator("table .row-link:has-text(\"Mike's 401(k)\")").count(), 1);
    await win.goto('pom://app/companies');
    await win.click('text=Fidelity');
    await win.waitForSelector("table .row-link:has-text(\"Mike's 401(k)\")");

    // A company with accounts can't be deleted.
    await win.click('[data-delete]');
    await win.waitForSelector('.form-error:not([hidden])');
    assert.match(await win.textContent('.form-error'), /still has 1 account/);

    // Deleting the car leaves the loan unsecured.
    await win.goto('pom://app/accounts');
    await win.click('text=Honda CR-V');
    await win.click('[data-delete]');
    assert.match(await win.textContent('[data-confirm-text]'), /1 loan secured by it will become unsecured/);
    await win.click('[data-confirm-yes]');
    await win.waitForURL('pom://app/accounts');
    await win.click('text=Car loan');
    assert.equal(await win.inputValue('select[name=secured_by_account_id]'), '');
  } finally {
    await app.close();
  }
});
