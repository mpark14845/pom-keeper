'use strict';
/* Add / edit / delete one password entry. */
document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('password-form');
  if (!form) return;
  const { id, return: returnTo } = form.dataset;
  const pw = form.elements.password;

  const toggle = form.querySelector('[data-toggle-pw]');
  const setShown = (shown) => {
    pw.type = shown ? 'text' : 'password';
    toggle.textContent = shown ? 'Hide' : 'Show';
  };
  toggle.addEventListener('click', () => setShown(pw.type === 'password'));

  // 20 characters from an alphabet without look-alikes (no O/0, l/1/I).
  const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!#$%&*?@';
  form.querySelector('[data-generate]').addEventListener('click', () => {
    const out = [];
    const buf = new Uint32Array(1);
    while (out.length < 20) {
      crypto.getRandomValues(buf);
      // Rejection sampling keeps every character equally likely.
      if (buf[0] < Math.floor(2 ** 32 / ALPHABET.length) * ALPHABET.length) out.push(ALPHABET[buf[0] % ALPHABET.length]);
    }
    pw.value = out.join('');
    setShown(true);
  });

  const clearFieldErrors = () =>
    form.querySelectorAll('[data-error-for]').forEach((el) => { el.hidden = true; el.textContent = ''; });

  PK.onSubmit(
    form,
    async (f) => {
      clearFieldErrors();
      const data = {};
      for (const name of ['title', 'link', 'website_url', 'username', 'password', 'pin', 'security_qa', 'notes']) {
        data[name] = f.elements[name].value;
      }
      data.include_in_print = f.elements.include_in_print.checked ? '1' : '0';
      if (id) data.id = id;
      const res = await window.pom.saveCredential(data);
      if (!res.ok && res.field) {
        const slot = f.querySelector(`[data-error-for="${res.field}"]`);
        if (slot) { slot.textContent = res.message; slot.hidden = false; }
        if (f.elements[res.field]) f.elements[res.field].focus();
      }
      return res;
    },
    () => PK.go(returnTo)
  );

  const del = form.querySelector('[data-delete]');
  if (!del) return;
  const panel = form.querySelector('[data-confirm]');
  const err = form.querySelector('.form-error');
  del.addEventListener('click', () => { panel.hidden = false; });
  form.querySelector('[data-confirm-no]').addEventListener('click', () => { panel.hidden = true; });
  form.querySelector('[data-confirm-yes]').addEventListener('click', async () => {
    const res = await window.pom.removeCredential(id);
    if (!res.ok) { panel.hidden = true; err.textContent = res.message; err.hidden = false; return; }
    PK.go(returnTo.startsWith('/passwords/') ? '/passwords' : returnTo);
  });
});
