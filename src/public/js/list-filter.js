'use strict';
/* Live text filter for list pages; works across several grouped tables. */
document.addEventListener('DOMContentLoaded', () => {
  const input = document.querySelector('[data-filter]');
  const tables = Array.from(document.querySelectorAll('[data-filterable]'));
  if (!input || !tables.length) return;
  const none = document.querySelector('.no-match');
  input.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase();
    let total = 0;
    for (const table of tables) {
      let shown = 0;
      for (const r of table.tBodies[0].rows) {
        const hit = !q || r.textContent.toLowerCase().includes(q);
        r.hidden = !hit;
        if (hit) shown++;
      }
      const group = table.closest('[data-group]');
      if (group) group.hidden = shown === 0;
      total += shown;
    }
    if (none) none.hidden = total > 0;
  });
});
