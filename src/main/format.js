'use strict';

/** Display helpers available to every EJS view as `fmt`. */

const dollars = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const exact = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Whole dollars; negative values get a real minus sign. */
function money(cents) {
  if (cents == null) return '—';
  const s = dollars.format(Math.abs(cents) / 100);
  return cents < 0 ? `−${s}` : s;
}

/** Exact amount for form fields: 1234.5 → "1234.50" */
function amountInput(cents) {
  return cents == null ? '' : (cents / 100).toFixed(2).replace(/\.00$/, '');
}

function moneyExact(cents) {
  return cents == null ? '—' : exact.format(cents / 100);
}

/** "2026-10" → "Oct 2026" */
function month(ym) {
  if (!ym) return '';
  const [y, m] = ym.split('-');
  return `${MONTHS[Number(m) - 1]} ${y}`;
}

const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '');

module.exports = { money, moneyExact, amountInput, month, cap };
