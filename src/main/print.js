'use strict';

const fs = require('node:fs');
const { BrowserWindow, dialog } = require('electron');
const { APP_ORIGIN } = require('./security');

const open = new Set();

/**
 * Loads a print route in a hidden window, then prints it or saves it as PDF.
 * Returns { ok, cancelled?, file? }.
 */
async function printRoute(parent, route, { mode, defaultName }) {
  const win = new BrowserWindow({
    show: false,
    parent,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false },
  });
  open.add(win);
  try {
    await win.loadURL(`${APP_ORIGIN}${route}`);
    if (mode === 'pdf') {
      const { canceled, filePath } = await dialog.showSaveDialog(parent, {
        title: 'Save as PDF',
        defaultPath: defaultName,
        filters: [{ name: 'PDF', extensions: ['pdf'] }],
      });
      if (canceled || !filePath) return { ok: true, cancelled: true };
      const pdf = await win.webContents.printToPDF({ pageSize: 'Letter', printBackground: true });
      fs.writeFileSync(filePath, pdf);
      return { ok: true, file: filePath };
    }
    const printed = await new Promise((resolve, reject) => {
      win.webContents.print({ printBackground: true }, (success, reason) => {
        if (success || reason === 'cancelled') resolve(success);
        else reject(new Error(reason));
      });
    });
    return { ok: true, cancelled: !printed };
  } finally {
    open.delete(win);
    if (!win.isDestroyed()) win.destroy();
  }
}

function closeAllPrintWindows() {
  for (const win of open) if (!win.isDestroyed()) win.destroy();
  open.clear();
}

module.exports = { printRoute, closeAllPrintWindows };
