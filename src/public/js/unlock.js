'use strict';
document.addEventListener('DOMContentLoaded', () => {
  PK.onSubmit(
    document.getElementById('unlock-form'),
    (f) => window.pom.unlock(f.elements.password.value),
    () => PK.go('/dashboard')
  );
});
