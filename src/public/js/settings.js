'use strict';
document.addEventListener('DOMContentLoaded', () => {
  const showSaved = (form) => PK.formState(form, { ok: true });

  PK.onSubmit(
    document.getElementById('lock-form'),
    (f) => window.pom.saveSettings({ lock_minutes: f.elements.lock_minutes.value }),
    () => showSaved(document.getElementById('lock-form'))
  );

  PK.onSubmit(
    document.getElementById('backup-form'),
    (f) => window.pom.saveSettings({
      auto_backup: f.elements.auto_backup.checked,
      backups_keep: f.elements.backups_keep.value,
    }),
    () => showSaved(document.getElementById('backup-form'))
  );

  const label = document.querySelector('[data-folder-label]');
  document.querySelector('[data-choose-folder]').addEventListener('click', async () => {
    const res = await window.pom.chooseBackupFolder();
    if (res.ok && res.folder) label.textContent = res.folder;
  });

  PK.onSubmit(
    document.getElementById('password-form'),
    (f) => {
      const problem = PK.checkNewPassword(f);
      if (problem) return { ok: false, message: problem };
      return window.pom.changePassword(f.elements.current.value, f.elements.password.value);
    },
    () => PK.go('/settings?saved=password')
  );

  PK.onSubmit(
    document.getElementById('regen-form'),
    (f) => window.pom.regenerateRecoveryKey(f.elements.current.value),
    () => PK.go('/recovery-key')
  );

  document.querySelector('[data-open-data]').addEventListener('click', () => window.pom.openDataFolder());
});
