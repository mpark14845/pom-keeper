'use strict';

const path = require('node:path');
const { app, BrowserWindow, Menu, protocol } = require('electron');
const { Session } = require('./session');
const { createRouter } = require('./router');
const { registerIpc } = require('./ipc');
const { closeAllPrintWindows } = require('./print');
const { APP_ORIGIN, lockDownSession, lockDownWebContents } = require('./security');

protocol.registerSchemesAsPrivileged([
  { scheme: 'pom', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

// Optional override, used by tests: POM_DATA_DIR=/some/folder
if (process.env.POM_DATA_DIR) app.setPath('userData', path.resolve(process.env.POM_DATA_DIR));

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  let mainWindow = null;
  const dataDir = app.getPath('userData');
  const session = new Session(dataDir);

  function createWindow() {
    mainWindow = new BrowserWindow({
      width: 1280,
      height: 820,
      minWidth: 960,
      minHeight: 640,
      show: false,
      title: 'POM Keeper',
      backgroundColor: '#FAF8F5',
      autoHideMenuBar: true,
      webPreferences: {
        preload: path.join(__dirname, '..', 'preload', 'preload.js'),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        spellcheck: false,
        devTools: !app.isPackaged,
      },
    });
    mainWindow.once('ready-to-show', () => mainWindow.show());
    // Typing counts as activity for the auto-lock timer.
    mainWindow.webContents.on('before-input-event', () => session.touch());
    mainWindow.on('closed', () => {
      mainWindow = null;
    });
    mainWindow.loadURL(`${APP_ORIGIN}/`);
  }

  session.on('locked', () => {
    closeAllPrintWindows();
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.loadURL(`${APP_ORIGIN}/unlock`);
  });

  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    if (app.isPackaged) Menu.setApplicationMenu(null);
    lockDownSession();
    lockDownWebContents();
    protocol.handle('pom', createRouter({ session, dataDir }));
    registerIpc({ session, dataDir });
    createWindow();
  });

  app.on('before-quit', () => session.lock());
  app.on('window-all-closed', () => app.quit());
}
