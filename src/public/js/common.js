'use strict';

/* Shared helpers for every page. Plain JS, no framework. */
(function () {
  const go = (path) => { window.location.href = `pom://app${path}`; };

  function formState(form, { error, ok, busy } = {}) {
    const err = form.querySelector('.form-error');
    const okEl = form.querySelector('.form-ok');
    if (err) { err.textContent = error || ''; err.hidden = !error; }
    if (okEl) okEl.hidden = !ok;
    form.querySelectorAll('button').forEach((el) => { el.disabled = !!busy; });
  }

  /** Score 0-4: length plus variety. Encourages long passphrases. */
  function passwordLevel(pw) {
    if (!pw) return 0;
    if (pw.length < 10) return 1;
    let score = 2;
    const kinds = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((r) => r.test(pw)).length;
    if (pw.length >= 14 || kinds >= 3) score = 3;
    if (pw.length >= 18 && kinds >= 2) score = 4;
    return score;
  }
  const LEVEL_TEXT = ['', 'Too short: use at least 10 characters.', 'OK. Longer is stronger.', 'Good.', 'Strong.'];

  function wireMeter(form) {
    const input = form.querySelector('input[name="password"]');
    const bar = form.querySelector('[data-meter]');
    const label = form.querySelector('[data-meter-label]');
    if (!input || !bar) return;
    const initial = label ? label.textContent : '';
    input.addEventListener('input', () => {
      const level = passwordLevel(input.value);
      bar.dataset.level = String(level);
      if (label) label.textContent = level ? LEVEL_TEXT[level] : initial;
    });
  }

  /** Checks new-password + confirm fields; returns an error message or null. */
  function checkNewPassword(form) {
    const pw = form.elements.password.value;
    if (pw.length < 10) return 'Use at least 10 characters.';
    if (pw !== form.elements.confirm.value) return "The two passwords don't match.";
    return null;
  }

  /** Wire a form: run(form) returns a pom.* result; onDone(result) on success. */
  function onSubmit(form, run, onDone) {
    if (!form) return;
    wireMeter(form);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      formState(form, { busy: true });
      let res;
      try {
        res = await run(form);
      } catch (err) {
        res = { ok: false, message: 'Something went wrong.' };
      }
      if (!res || !res.ok) {
        formState(form, { error: (res && res.message) || 'Something went wrong.' });
        return;
      }
      formState(form, {});
      if (onDone) onDone(res);
    });
  }

  // Lock button and activity pings for the auto-lock timer (throttled).
  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('[data-action="lock"]').forEach((b) =>
      b.addEventListener('click', () => window.pom.lock())
    );
    // Whole table rows are clickable.
    document.addEventListener('click', (e) => {
      const row = e.target.closest('tr[data-href]');
      if (row && !e.target.closest('a, button, input')) window.location.href = row.dataset.href;
    });
  });
  let lastPing = 0;
  const ping = () => {
    const now = Date.now();
    if (now - lastPing > 15000) { lastPing = now; window.pom.activity(); }
  };
  ['mousemove', 'mousedown', 'wheel', 'touchstart'].forEach((ev) =>
    window.addEventListener(ev, ping, { passive: true })
  );

  window.PK = { go, formState, onSubmit, checkNewPassword, passwordLevel };
})();
