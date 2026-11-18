'use strict';
/* Password list: reveal and copy one secret at a time. */
document.addEventListener('DOMContentLoaded', () => {
  const toast = document.querySelector('[data-toast]');
  let toastTimer;
  const say = (msg) => {
    if (!toast) return;
    toast.textContent = msg;
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.hidden = true; }, 4000);
  };

  document.addEventListener('click', async (e) => {
    const reveal = e.target.closest('[data-reveal]');
    const copy = e.target.closest('[data-copy-secret]');
    if (!reveal && !copy) return;
    e.preventDefault();
    e.stopPropagation();
    const row = e.target.closest('tr[data-id]');
    const id = row.dataset.id;

    if (reveal) {
      const out = row.querySelector('[data-secret]');
      if (reveal.dataset.shown === '1') {
        out.textContent = '••••••••';
        reveal.textContent = 'Show';
        reveal.dataset.shown = '';
        return;
      }
      const res = await window.pom.revealSecret(id, 'password');
      if (!res.ok) return say(res.message);
      out.textContent = res.value || '';
      reveal.textContent = 'Hide';
      reveal.dataset.shown = '1';
      return;
    }
    const res = await window.pom.copySecret(id, copy.dataset.copySecret);
    say(res.ok ? `Copied. Clipboard clears in ${res.seconds} seconds.` : res.message);
  });
});
