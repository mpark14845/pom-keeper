# POM Keeper — Product & Technical Spec

**POM = Peace Of Mind.** A local, offline Windows desktop app where a household records its financial picture (accounts, the companies that hold them, the people to call, who owns what, month-end values) plus passwords and important notes. It then produces a plain printed handoff a non-technical spouse or family member can act on.

Status: Draft v0.1 for review · Owner: Mike

---

## 1. Goals and non-goals

### Goals
1. Record every net worth item: cash, retirement, investments, HSAs, property and vehicles, life insurance, and all debts.
2. Link **companies ↔ contacts ↔ accounts** and **family members** (as owners and beneficiaries), so anyone can answer "who do I call about this?"
3. Keep one **month-end value** per account and show net worth trends on a dashboard.
4. Produce a **printed / PDF handoff** (full or masked numbers), plus a **separate password sheet**.
5. Keep everything **local, encrypted, and offline**. The app never needs or uses the internet.

### Non-goals (v1)
- No bank syncing, Plaid, or any online lookups.
- No cloud sync, accounts, or multi-device sharing.
- No transaction tracking or budgeting.
- No multi-currency (USD only).
- One household per data file.

---

## 2. Guiding principles

| Principle | What it means in practice |
|---|---|
| Offline by design | All network requests are blocked at the Electron session level. Fonts, chart library and icons ship inside the app. |
| Encrypted at rest | The data file is never readable without the master password or the recovery key. Backups are encrypted too. |
| Plain language | Labels, printouts and empty states are written for a non-technical reader. |
| Month-end, not every change | One value per account per month keeps entry quick and trends clean. |

---

## 3. Technology and architecture

| Concern | Choice |
|---|---|
| Shell | Electron (current stable), Windows first |
| Templates | **EJS**, rendered in the main process |
| Front end | Plain JavaScript (no framework) and plain CSS with design tokens |
| Database | SQLite via **`better-sqlite3-multiple-ciphers`** (SQLCipher-compatible, whole-file encryption) |
| Crypto | Node `crypto`: scrypt for password key derivation, AES-256-GCM for key wrapping |
| Charts | Chart.js, bundled locally from `node_modules` (no CDN) |
| Font | Inter, bundled as local `.woff2` files |
| Packaging | electron-builder, NSIS installer (milestone 4) |

### 3.1 Rendering model
- The main process registers a custom protocol (`pom://app/...`). Each route loads data from the database and renders an EJS view (layout + partials) into HTML.
- Pages are plain HTML/CSS with small, page-specific vanilla JS modules.
- Writes (save, delete, monthly entry) go through a narrow **preload bridge** (`window.pom.*`) → `ipcMain.handle` → controller → database. The page then re-renders or swaps a partial.
- Security settings: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, a strict CSP (`default-src 'self' pom:`), navigation and new windows denied, DevTools disabled in packaged builds.

### 3.2 Proposed folder layout
```
pom-keeper/
  docs/SPEC.md
  src/
    main/
      main.js            app lifecycle, window, protocol, network lockdown
      router.js          route → controller → EJS view
      ipc.js             preload-exposed handlers
      vault/             key derivation, key wrapping, recovery key, lock timer
      db/                connection, migrations/, seed (categories, types)
      controllers/       accounts, companies, contacts, family, values, notes, credentials, print, backup, settings
      print/             print/PDF window helpers
    preload/preload.js
    views/
      layout.ejs, partials/, pages/, print/
    public/
      css/ tokens.css, app.css, print.css
      js/  page modules
      fonts/ Inter
      vendor/ chart.umd.js (copied from node_modules at build)
  package.json
```

---

## 4. Security design

### 4.1 Keys
- On first run the app generates a random 256-bit **Data Key (DK)**. The database is encrypted with DK.
- DK is never stored in plain form. It is stored twice, wrapped (AES-256-GCM):
  - by the **Password Key**, derived from the master password with scrypt (random 16-byte salt, N=2^17, r=8, p=1).
  - by the **Recovery Key Key**, derived the same way from the recovery key.
- The wrapped keys, salts and KDF parameters live in a small header file `pomkeeper.keys.json` next to the database. It holds no secrets in plain form.
- **Changing the master password** re-wraps DK only. Data is not re-encrypted.
- **Recovery key**: 24 random characters in Crockford base32, shown as `XXXX-XXXX-XXXX-XXXX-XXXX-XXXX`. It is shown **once** at setup with a "Print recovery sheet" button, and the user must confirm they saved it. It can be regenerated later from Settings (requires the master password), which invalidates the old one.
- Unlocking with the recovery key forces the user to set a new master password.

### 4.2 Locking
- The app opens to the Unlock screen. DK lives only in main-process memory while unlocked.
- **Auto-lock after 30 minutes idle** (default). The value can be changed in Settings (5–240 minutes). Idle means no keyboard or mouse input in any app window.
- Lock = close the database connection, zero DK in memory, close print windows, return to Unlock. Manual "Lock now" sits in the sidebar header.
- Copied passwords are cleared from the clipboard after 30 seconds.
- 5 wrong attempts → 30-second delay, increasing after that.

### 4.3 Network lockdown
- `session.defaultSession.webRequest.onBeforeRequest` cancels any request that isn't `pom:`, `file:` or `devtools:`.
- No auto-update, telemetry or crash upload. A test asserts that no outbound request is made during a full session.

### 4.4 Data location
- Default: `%APPDATA%\POM Keeper\pomkeeper.db` + `pomkeeper.keys.json`. The location is shown in Settings.

---

## 5. Data model

All tables have `id INTEGER PRIMARY KEY`, `created_at` and `updated_at`. Money is stored as **integer cents**. Liabilities are stored as **positive amounts owed** and subtracted in net worth.

### 5.1 Reference data (seeded)

**categories**: `code, group (asset|liability|info), label, sort`

| Group | Category | Account types |
|---|---|---|
| Assets | Current Cash | Checking, Savings, Money Market, CD, Cash on hand |
| Assets | Retirement | 401(k), 403(b), Traditional IRA, Roth IRA, Pension (lump-sum value) |
| Assets | Investments | Brokerage |
| Assets | Health Savings | HSA |
| Assets | Insurance Cash Value | Whole Life (cash value) |
| Assets | Property & Vehicles | Home, Vehicle, Other property |
| Liabilities | Long Term | Mortgage, Auto Loan, Student Loan, Personal Loan, HELOC |
| Liabilities | Revolving | Credit Card |
| Info only | Insurance | Term Life (death benefit shown, not counted) |

**account_types**: `code, category_code, label, counts_in_net_worth (bool)`

### 5.2 Core tables

**family_members**: `name, kind (person|trust|estate|other), relationship, date_of_birth?, phone?, email?, notes`
(Trusts are first-class entries so "house is held in trust for the kids" can be modeled.)

**companies**: `name, kind (bank|brokerage|insurer|employer|lender|government|other), website, phone, address, notes`

**contacts**: `company_id (required, FK)`, `name, title, email, phone, phone_alt, notes`
A contact belongs to exactly one company.

**accounts**:
`company_id (FK), type_code (FK), nickname, account_number, routing_number?, status (open|closed), opened_on?, closed_on?, face_amount_cents? (life insurance death benefit), interest_rate?, secured_by_account_id? (e.g. auto loan → vehicle, mortgage → home), notes`
A company has many accounts.

**account_contacts**: `account_id, contact_id, role (advisor|servicer|agent|other)`. Many-to-many: an account has many contacts, and a contact covers many accounts.

**account_owners**: `account_id, family_member_id, role (owner|joint owner|trustee|beneficial owner), share_pct?`

**account_beneficiaries**: `account_id, family_member_id, level (primary|contingent), share_pct?`

**monthly_values**: `account_id, month (YYYY-MM), value_cents, note?`, with `UNIQUE(account_id, month)`.

**notes**: `title, category (legal|location|instructions|other), body, include_in_print (bool), sort`
Examples: where the will is, power of attorney, safe deposit box, cash in the drawer.

**credentials** (Password Keeper): `title, website_url?, username?, password?, pin?, security_qa?, notes?, linked_type? (account|company|contact|family_member|none), linked_id?, include_in_print (bool)`

**settings**: `key, value`. Covers lock minutes, backup folder, auto-backup on/off, backups to keep, the "start here" letter text and print defaults.

---

## 6. Net worth rules

For each account and month M:
1. If a `monthly_values` row exists for M, use it.
2. Otherwise **carry forward** the latest earlier value. The UI marks it as "carried".
3. Before the account's first entry, the value is 0.
4. If the account is **closed**, the value is **0 for every month after the month of `closed_on`**. History before that is kept and charted.
5. Types where `counts_in_net_worth = false` (Term Life) are excluded. Whole Life's cash value is included as an asset.

**Net worth(M) = Σ assets(M) − Σ liabilities(M)**, i.e. "if I sold everything and paid off every debt."

The dashboard flags open accounts that have no entry for the most recent completed month.

---

## 7. Screens

The layout mirrors finmanager: a **left sidebar** with the logo, tab buttons and a context pane for the active tab, and a **main panel** with a header and content cards.

| Screen | Purpose |
|---|---|
| First-run setup | Welcome → set master password (strength meter) → show and print recovery key → confirm → choose backup folder (optional) → empty dashboard |
| Unlock | Master password, "Use recovery key" link |
| Dashboard | Net worth headline (latest month, change vs last month and last year), net worth over time line chart, assets vs liabilities chart, category breakdown, "missing month-end entries" list. Range: 12 months / 24 months / all |
| Accounts | **Grouped list with a view switcher: By Account Type (default) · By Account · By Company · By Contact.** Shows current value, status and owner. Toggle to show closed accounts |
| Account detail | Fields, company, linked contacts, owners, beneficiaries, secured-by link, value history table and mini chart, linked credentials |
| Month-end update | A grid of all open accounts for a chosen month, with last month's value beside each, for fast entry. Tab moves between rows; "Copy last month" per row |
| Companies / Contacts | List + detail. A company detail shows its contacts and accounts |
| Family | People and trusts, with the accounts each owns or is beneficiary of |
| Notes | Categorized notes with an include-in-print toggle |
| Passwords | Searchable list; reveal and copy with clipboard auto-clear; link to any entity; add websites |
| Print Center | Choose document, options and preview, then Print or Save as PDF |
| Settings | Auto-lock minutes, backup folder, auto-backup on/off and keep N, Back up now, Restore, change master password, regenerate recovery key, data file location, "start here" letter text |

---

## 8. Printouts (print or Save as PDF)

Rendered from EJS print templates into a hidden window, then `webContents.print()` or `printToPDF()` → save dialog. US Letter, portrait, `print.css`, black and white friendly, large readable type.

### 8.1 Family Handoff document
1. **Start here** letter: editable text, plus date prepared and who prepared it.
2. **Snapshot**: net worth as of the latest month, with totals by category.
3. **Accounts**, grouped by the chosen view (default Account Type). For each account: company, type, nickname, **account number (full or masked to last 4)**, latest value and month, owners, beneficiaries, and contacts with phone and email.
4. **Who to call**: a contact directory grouped by company.
5. **Important notes**: those marked include-in-print.

Options: view grouping, full or masked numbers, include closed accounts (default off), include notes (default on).
Every page carries a footer: "Confidential: contains personal financial information · Page X of Y · Prepared YYYY-MM-DD".

### 8.2 Password sheet (separate)
- Large type, one entry per block: title, website, username, password, PIN, and notes. Grouped by linked company or account.
- Only entries marked include-in-print (default on).
- Warning banner at the top: "Store this page somewhere safe."

### 8.3 Recovery key sheet
- Printed at setup and on regeneration. It holds the key, the date, and instructions for using it.

---

## 9. Backups and restore

- **Format:** one file `POMKeeper-YYYY-MM-DD-HHmm.pombak`, containing the key header plus a consistent snapshot of the encrypted DB (taken with SQLite's backup API). It is still encrypted with DK, so it's safe on a USB stick or in a shared folder. The master password or recovery key is needed to restore it.
- **Manual:** "Back up now" in Settings and in the sidebar.
- **Automatic:** on app close and once per day while open (if a backup folder is set). Keeps the last N (default 10).
- **Restore:** pick a `.pombak`, enter the password or recovery key, then confirm replacing the current data (the current data is backed up automatically first).

---

## 10. Look and feel

Mimic finmanager's style with **new CSS**:
- Warm paper neutrals (app background around `#FAF9F6`, white cards, `#E2DDD4` lines), dark ink text, and a coral-red brand accent (around `#F84C55`). The palette will be tuned for POM Keeper.
- Inter, a 4px spacing scale, small radii (4–6px), subtle shadows, and thin-stroke line icons (inline SVG).
- Tokens live in `tokens.css` (`--pk-*` prefix). Components live in `app.css`. Printouts use `print.css`.
- Positive values use ink; liabilities show as red or negative. Status badges cover Open, Closed and Carried.

---

## 11. Milestones

| # | Milestone | Done when |
|---|---|---|
| 1 | **Spec** (this doc) | Reviewed and merged |
| 2 | **Secure foundation** | App launches offline; first-run setup, unlock, recovery key, auto-lock and change password work; encrypted DB with migrations and seed data; Settings page (lock minutes, backup folder); finmanager-style shell |
| 3 | **Data entry and views** | CRUD for family, companies, contacts, accounts (owners, beneficiaries, contacts, secured-by), month-end grid, notes, passwords; Accounts views by type, account, company and contact |
| 4 | **Dashboard, print, backups** | Charts; Handoff and Password printouts (print and PDF); manual, automatic and restore backups; Windows installer |

Testing: unit tests for the vault (wrap/unwrap, wrong password, recovery), the net worth rules (carry-forward, closed accounts, exclusions) and migrations. Plus a smoke test that launches the app and asserts no network requests.

---

## 12. Open questions
1. App icon and logo: reuse finmanager's style or new artwork?
2. Should the handoff letter support a different text per recipient, or is one letter enough?
3. Should vehicles and the home get an "estimated value source" field (e.g. "KBB, Nov 2026")?
