'use strict';

/**
 * The narrow bridge between pages and the main process (spec 3.1). Every
 * handler checks the caller is one of our own pages and returns
 * { ok: true, ... } or { ok: false, code, message }.
 */

const { ipcMain, dialog, shell, BrowserWindow } = require('electron');
const { isAppUrl } = require('./security');
const { printRoute } = require('./print');
const repo = require('./repos/entities');
const acc = require('./repos/accounts');

function handle(channel, fn) {
  ipcMain.handle(`pom:${channel}`, async (event, ...args) => {
    if (!isAppUrl(event.senderFrame?.url)) return { ok: false, code: 'FORBIDDEN', message: 'Not allowed.' };
    try {
      return { ok: true, ...((await fn(event, ...args)) || {}) };
    } catch (err) {
      if (!err.code) console.error(err);
      return { ok: false, code: err.code || 'ERROR', message: err.code ? err.message : 'Something went wrong.', field: err.field };
    }
  });
}

function registerIpc({ session, dataDir }) {
  const win = (event) => BrowserWindow.fromWebContents(event.sender);

  handle('setup', async (_e, password) => {
    await session.setup(password);
  });
  handle('confirmRecoverySaved', async () => {
    const firstRun = session.settings().setup_complete !== '1';
    session.clearPendingRecoveryKey();
    session.setFlag('recovery_confirmed');
    return { next: firstRun ? '/setup/backup' : '/settings?saved=recovery' };
  });
  handle('finishSetup', async () => {
    session.setFlag('setup_complete');
  });
  handle('unlock', async (_e, password) => {
    await session.unlock(password);
  });
  handle('recover', async (_e, key, newPassword) => {
    await session.recover(key, newPassword);
  });
  handle('lock', async () => {
    session.lock();
  });
  handle('activity', async () => {
    session.touch();
  });
  handle('saveSettings', async (_e, values) => {
    session.saveSettings(values || {});
  });
  handle('chooseBackupFolder', async (event) => {
    const { canceled, filePaths } = await dialog.showOpenDialog(win(event), {
      title: 'Choose a backup folder',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (canceled || !filePaths[0]) return { folder: null };
    session.saveSettings({ backup_folder: filePaths[0] });
    return { folder: filePaths[0] };
  });
  handle('changePassword', async (_e, current, next) => {
    await session.changePassword(current, next);
  });
  handle('regenerateRecoveryKey', async (_e, current) => {
    await session.regenerateRecoveryKey(current);
  });
  handle('printRecoveryKey', async (event, mode) => {
    return printRoute(win(event), '/print/recovery-key', {
      mode: mode === 'pdf' ? 'pdf' : 'print',
      defaultName: 'POM Keeper Recovery Key.pdf',
    });
  });
  handle('save', async (_e, entity, data) => {
    session.touch();
    return { id: repo.save(session.openDb, entity, data) };
  });
  handle('deleteImpact', async (_e, entity, id) => repo.deleteImpact(session.openDb, entity, id));
  handle('remove', async (_e, entity, id) => {
    repo.remove(session.openDb, entity, id);
  });
  handle('saveAccount', async (_e, data) => {
    session.touch();
    return { id: acc.saveAccount(session.openDb, data) };
  });
  handle('accountImpact', async (_e, id) => acc.accountImpact(session.openDb, id));
  handle('removeAccount', async (_e, id) => {
    acc.removeAccount(session.openDb, id);
  });
  handle('openDataFolder', async () => {
    await shell.openPath(dataDir);
  });
}

module.exports = { registerIpc };
