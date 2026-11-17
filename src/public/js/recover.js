'use strict';
document.addEventListener('DOMContentLoaded', () => {
  PK.onSubmit(
    document.getElementById('recover-form'),
    (form) => {
      const problem = PK.checkNewPassword(form);
      if (problem) return { ok: false, message: problem };
      return window.pom.recover(form.elements.key.value, form.elements.password.value);
    },
    () => PK.go('/dashboard')
  );
});
