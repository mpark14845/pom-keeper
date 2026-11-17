'use strict';
/* Add / edit / delete an account, with repeatable contact, owner and beneficiary rows. */
document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('account-form');
  if (!form) return;
  const { id, return: returnTo } = form.dataset;
  const typeGrp = JSON.parse(form.dataset.typeGrp);

  // Show only the fields that fit the chosen type and status.
  function update() {
    const type = form.elements.type_code.value;
    const grp = typeGrp[type] || null;
    const closed = form.elements.status.value === 'closed';
    form.querySelectorAll('[data-show-for]').forEach((el) => {
      const want = el.dataset.showFor;
      el.hidden = !(
        (want === 'liability' && grp === 'liability') ||
        (want === 'not-liability' && grp !== 'liability') ||
        (want === 'life' && (type === 'term_life' || type === 'whole_life')) ||
        (want === 'closed' && closed)
      );
    });
  }
  form.elements.type_code.addEventListener('change', update);
  form.elements.status.addEventListener('change', update);
  update();

  // Repeatable link rows.
  form.querySelectorAll('[data-links]').forEach((box) => {
    const rows = box.querySelector('[data-link-rows]');
    const tpl = box.querySelector('template');
    box.querySelector('[data-add-link]').addEventListener('click', () => {
      rows.appendChild(tpl.content.firstElementChild.cloneNode(true));
      rows.lastElementChild.querySelector('select').focus();
    });
  });
  form.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-remove-link]');
    if (btn) btn.closest('.link-row').remove();
  });

  function collect() {
    const fields = ['nickname', 'type_code', 'company_id', 'account_number', 'routing_number', 'interest_rate',
      'face_amount', 'secured_by_account_id', 'status', 'opened_on', 'closed_on', 'notes'];
    const data = {};
    for (const f of fields) {
      const el = form.elements[f];
      // Hidden, type-specific fields are sent empty so stale values don't stick.
      data[f] = el.closest('[hidden]') ? '' : el.value;
    }
    for (const box of form.querySelectorAll('[data-links]')) {
      data[box.dataset.links] = box.hidden ? [] : Array.from(box.querySelectorAll('[data-link-rows] .link-row')).map((row) =>
        Object.fromEntries(Array.from(row.querySelectorAll('[data-k]')).map((el) => [el.dataset.k, el.value]))
      );
    }
    if (id) data.id = id;
    return data;
  }

  const clearFieldErrors = () =>
    form.querySelectorAll('[data-error-for]').forEach((el) => { el.hidden = true; el.textContent = ''; });

  PK.onSubmit(
    form,
    async () => {
      clearFieldErrors();
      const res = await window.pom.saveAccount(collect());
      if (!res.ok && res.field) {
        const slot = form.querySelector(`[data-error-for="${res.field}"]`);
        if (slot) { slot.textContent = res.message; slot.hidden = false; }
        const input = form.elements[res.field];
        if (input && input.focus) input.focus();
      }
      return res;
    },
    () => PK.go(returnTo)
  );

  const del = form.querySelector('[data-delete]');
  if (!del) return;
  const panel = form.querySelector('[data-confirm]');
  const text = form.querySelector('[data-confirm-text]');
  const err = form.querySelector('.form-error');
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

  del.addEventListener('click', async () => {
    const res = await window.pom.accountImpact(id);
    if (!res.ok) { err.textContent = res.message; err.hidden = false; return; }
    const parts = [];
    if (res.values) parts.push(`Its ${plural(res.values, 'month-end value')} will be deleted.`);
    if (res.securing) parts.push(`${plural(res.securing, 'loan')} secured by it will become unsecured.`);
    if (res.linkedPasswords) parts.push(`${plural(res.linkedPasswords, 'saved password')} will be kept but unlinked.`);
    text.textContent = ['Delete this account?', ...parts, "This can't be undone. If you just stopped using it, mark it Closed instead to keep its history."].join(' ');
    panel.hidden = false;
  });
  form.querySelector('[data-confirm-no]').addEventListener('click', () => { panel.hidden = true; });
  form.querySelector('[data-confirm-yes]').addEventListener('click', async () => {
    const res = await window.pom.removeAccount(id);
    if (!res.ok) { panel.hidden = true; err.textContent = res.message; err.hidden = false; return; }
    PK.go(returnTo.startsWith('/accounts/') ? '/accounts' : returnTo);
  });
});
