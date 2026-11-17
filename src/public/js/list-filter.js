'use strict';
/* Live text filter for list pages. */
document.addEventListener('DOMContentLoaded', () => {
  const input = document.querySelector('[data-filter]');
  const table = document.querySelector('[data-filterable]');
  if (!input || !table) return;
  const rows = Array.from(table.tBodies[0].rows);
  const none = document.querySelector('.no-match');
  input.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase();
    let shown = 0;
    for (const r of rows) {
      const hit = !q || r.textContent.toLowerCase().includes(q);
      r.hidden = !hit;
      if (hit) shown++;
    }
    if (none) none.hidden = shown > 0;
  });
});
