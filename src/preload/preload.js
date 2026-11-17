'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const call = (channel) => (...args) => ipcRenderer.invoke(`pom:${channel}`, ...args);

contextBridge.exposeInMainWorld('pom', {
  setup: call('setup'),
  confirmRecoverySaved: call('confirmRecoverySaved'),
  finishSetup: call('finishSetup'),
  unlock: call('unlock'),
  recover: call('recover'),
  lock: call('lock'),
  activity: call('activity'),
  saveSettings: call('saveSettings'),
  chooseBackupFolder: call('chooseBackupFolder'),
  changePassword: call('changePassword'),
  regenerateRecoveryKey: call('regenerateRecoveryKey'),
  printRecoveryKey: call('printRecoveryKey'),
  openDataFolder: call('openDataFolder'),
  save: call('save'),
  deleteImpact: call('deleteImpact'),
  remove: call('remove'),
  saveAccount: call('saveAccount'),
  accountImpact: call('accountImpact'),
  removeAccount: call('removeAccount'),
  saveMonth: call('saveMonth'),
});
