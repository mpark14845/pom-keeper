# POM Keeper

**Peace Of Mind Keeper.** A local, offline, encrypted desktop app for recording a household's financial picture and handing it off to family. See [docs/SPEC.md](docs/SPEC.md).

## Run it

Requires Node.js 20+ on Windows (macOS and Linux work for development).

```
npm install
npm start
```

On first launch you choose a master password and get a recovery key to print. Data lives in `%APPDATA%\POM Keeper\` (`pomkeeper.db` is encrypted, and `pomkeeper.keys.json` holds only wrapped keys).

To try it without touching your real data, point it at a scratch folder:

```
set POM_DATA_DIR=C:\temp\pom-test && npm start        (cmd)
$env:POM_DATA_DIR="C:\temp\pom-test"; npm start       (PowerShell)
```

## Tests

```
npm test            # unit tests: vault, recovery key, encrypted database, auto-lock
npm run test:e2e    # launches the app, walks setup → settings → lock → unlock, checks nothing goes online
```

The end-to-end test needs Playwright (`npm i -g playwright` or `npx playwright`). On Linux CI, run it under `xvfb-run -a`.

## Project layout

```
src/main/        Electron main process: window, pom:// protocol, EJS rendering, IPC, vault, database
src/preload/     the small window.pom bridge pages use
src/views/       EJS layouts, pages, partials and print templates
src/public/      CSS (tokens, app, print), page scripts, images
test/            unit tests (node:test) and the e2e smoke test
```
