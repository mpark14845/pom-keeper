'use strict';
document.addEventListener('DOMContentLoaded', () => {
  PK.onSubmit(
    document.getElementById('setup-form'),
    (form) => {
      const problem = PK.checkNewPassword(form);
      if (problem) return { ok: false, message: problem };
      return window.pom.setup(form.elements.password.value);
    },
    () => PK.go('/recovery-key')
  );
});
