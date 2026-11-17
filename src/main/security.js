'use strict';

/**
 * Offline lockdown (spec 4.3): POM Keeper never talks to the network.
 */

const { app, session } = require('electron');

const APP_ORIGIN = 'pom://app';
const ALLOWED = /^(pom|devtools):/i;

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "font-src 'self'",
  "img-src 'self' data:",
  "connect-src 'none'",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

function isAppUrl(url) {
  return typeof url === 'string' && url.startsWith(`${APP_ORIGIN}/`);
}

function lockDownSession(ses = session.defaultSession) {
  ses.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
    const blocked = !ALLOWED.test(details.url);
    if (blocked) console.warn(`[pom:net] blocked ${details.method} ${details.url}`);
    callback({ cancel: blocked });
  });
  ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  ses.setPermissionCheckHandler(() => false);
  ses.setSpellCheckerEnabled(false); // the spellchecker downloads dictionaries
}

function lockDownWebContents() {
  app.on('web-contents-created', (_event, contents) => {
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    contents.on('will-navigate', (event, url) => {
      if (!isAppUrl(url)) event.preventDefault();
    });
    contents.on('will-redirect', (event, url) => {
      if (!isAppUrl(url)) event.preventDefault();
    });
    contents.on('will-attach-webview', (event) => event.preventDefault());
  });
}

module.exports = { APP_ORIGIN, CSP, isAppUrl, lockDownSession, lockDownWebContents };
