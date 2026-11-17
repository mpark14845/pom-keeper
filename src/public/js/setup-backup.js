'use strict';
document.addEventListener('DOMContentLoaded', () => {
  const label = document.querySelector('[data-folder-label]');
  document.querySelector('[data-choose-folder]').addEventListener('click', async () => {
    const res = await window.pom.chooseBackupFolder();
    if (res.ok && res.folder) label.textContent = res.folder;
  });
  document.querySelector('[data-finish]').addEventListener('click', async () => {
    const res = await window.pom.finishSetup();
    if (res.ok) PK.go('/dashboard');
  });
});
