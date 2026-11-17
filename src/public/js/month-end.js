'use strict';
/* Month-End grid: fast entry, live totals, save all at once. */
document.addEventListener('DOMContentLoaded', () => {
  const select = document.querySelector('[data-month-select]');
  if (select) select.addEventListener('change', () => PK.go(`/month-end?month=${select.value}`));

  const form = document.getElementById('month-form');
  if (!form) return;
  const month = form.dataset.month;
  const rows = Array.from(form.querySelectorAll('tr[data-account]'));
  const dirty = form.querySelector('[data-dirty]');
  const fmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  const money = (c) => (c < 0 ? '−' : '') + fmt.format(Math.abs(c) / 100);

  const parse = (s) => {
    const t = String(s || '').replace(/[$,\s]/g, '');
    if (t === '') return null;
    const n = Number(t);
    return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : NaN;
  };

  function recalc() {
    let assets = 0;
    let liabilities = 0;
    for (const r of rows) {
      if (r.dataset.counts !== '1') continue;
      let cents = parse(r.querySelector('[data-value]').value);
      if (cents == null) cents = r.dataset.carried === '' ? 0 : Number(r.dataset.carried);
      if (Number.isNaN(cents)) continue;
      if (r.dataset.grp === 'liability') liabilities += cents;
      else assets += cents;
    }
    document.querySelector('[data-total=assets]').textContent = money(assets);
    const liab = document.querySelector('[data-total=liabilities]');
    liab.textContent = money(-liabilities);
    liab.classList.toggle('neg', liabilities > 0);
    document.querySelector('[data-total=net]').textContent = money(assets - liabilities);
  }

  const markDirty = () => { dirty.hidden = false; recalc(); };
  form.addEventListener('input', markDirty);

  form.addEventListener('click', (e) => {
    const copy = e.target.closest('[data-copy]');
    if (copy) {
      const input = copy.closest('tr').querySelector('[data-value]');
      input.value = copy.dataset.copy;
      markDirty();
      input.focus();
    }
  });
  form.querySelector('[data-copy-all]').addEventListener('click', () => {
    for (const r of rows) {
      const input = r.querySelector('[data-value]');
      const btn = r.querySelector('[data-copy]');
      if (!input.value && btn) input.value = btn.dataset.copy;
    }
    markDirty();
  });

  // Enter moves to the next amount instead of submitting.
  form.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || !e.target.matches('[data-value]')) return;
    e.preventDefault();
    const inputs = Array.from(form.querySelectorAll('[data-value]'));
    const next = inputs[inputs.indexOf(e.target) + 1];
    if (next) next.focus();
    else form.querySelector('button[type=submit]').focus();
  });

  PK.onSubmit(
    form,
    async () => {
      form.querySelectorAll('[data-error-for]').forEach((el) => { el.hidden = true; });
      const items = rows.map((r) => ({
        account_id: r.dataset.account,
        value: r.querySelector('[data-value]').value,
        note: r.querySelector('[data-note]').value,
      }));
      const res = await window.pom.saveMonth(month, items);
      if (!res.ok && res.field) {
        const slot = form.querySelector(`[data-error-for="${res.field}"]`);
        if (slot) { slot.textContent = 'Not a valid amount.'; slot.hidden = false; }
        const input = form.querySelector(`[name="${res.field}"]`);
        if (input) input.focus();
      }
      return res;
    },
    () => PK.go(`/month-end?month=${month}&saved=1`)
  );
});
