'use strict';
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('[data-print]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      await window.pom.printRecoveryKey(btn.dataset.print);
      btn.disabled = false;
    })
  );
  PK.onSubmit(
    document.getElementById('recovery-form'),
    (form) => {
      if (!form.elements.saved.checked) return { ok: false, message: 'Please confirm you saved your recovery key.' };
      return window.pom.confirmRecoverySaved();
    },
    (res) => PK.go(res.next)
  );
});
