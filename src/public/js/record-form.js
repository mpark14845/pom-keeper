'use strict';
/* Add / edit / delete for Family, Companies and Contacts. */
document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('record-form');
  if (!form) return;
  const { entity, id, return: returnTo } = form.dataset;

  const clearFieldErrors = () =>
    form.querySelectorAll('[data-error-for]').forEach((el) => { el.hidden = true; el.textContent = ''; });

  PK.onSubmit(
    form,
    async (f) => {
      clearFieldErrors();
      const data = Object.fromEntries(new FormData(f).entries());
      if (id) data.id = id;
      const res = await window.pom.save(entity, data);
      if (!res.ok && res.field) {
        const slot = f.querySelector(`[data-error-for="${res.field}"]`);
        if (slot) { slot.textContent = res.message; slot.hidden = false; }
        const input = f.elements[res.field];
        if (input) input.focus();
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

  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  function describe(impact) {
    const parts = [];
    if (entity === 'companies') {
      if (impact.accounts) return { blocked: true, msg: `This company still has ${plural(impact.accounts, 'account')}. Move or delete them first.` };
      if (impact.contacts) parts.push(`its ${plural(impact.contacts, 'contact')} will be deleted too`);
    } else if (impact.accounts) {
      parts.push(entity === 'family'
        ? `they'll be removed as owner or beneficiary on ${plural(impact.accounts, 'account')}`
        : `they'll be unlinked from ${plural(impact.accounts, 'account')}`);
    }
    if (impact.linkedPasswords) parts.push(`${plural(impact.linkedPasswords, 'saved password')} will be kept but unlinked`);
    const noun = entity === 'family' ? 'family member' : entity === 'companies' ? 'company' : 'contact';
    const detail = parts.length ? ' ' + parts.join(', and ').replace(/^./, (c) => c.toUpperCase()) + '.' : '';
    return { msg: `Delete this ${noun}?${detail} This can't be undone.` };
  }

  del.addEventListener('click', async () => {
    err.hidden = true;
    const res = await window.pom.deleteImpact(entity, id);
    if (!res.ok) { err.textContent = res.message; err.hidden = false; return; }
    const d = describe(res);
    if (d.blocked) { err.textContent = d.msg; err.hidden = false; return; }
    text.textContent = d.msg;
    panel.hidden = false;
  });
  form.querySelector('[data-confirm-no]').addEventListener('click', () => { panel.hidden = true; });
  form.querySelector('[data-confirm-yes]').addEventListener('click', async () => {
    const res = await window.pom.remove(entity, id);
    if (!res.ok) { panel.hidden = true; err.textContent = res.message; err.hidden = false; return; }
    PK.go(returnTo.startsWith(`/${entity}/`) ? `/${entity}` : returnTo);
  });
});
