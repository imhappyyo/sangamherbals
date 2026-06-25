/* Legal pages — fills the dynamic year/date. External (CSP-safe, no inline script). */
(function () {
  'use strict';
  var now = new Date();
  document.querySelectorAll('[data-legal-year]').forEach(function (e) { e.textContent = now.getFullYear(); });
  document.querySelectorAll('[data-legal-date]').forEach(function (e) {
    e.textContent = now.toLocaleDateString('en-GB', { year: 'numeric', month: 'long' });
  });
})();
