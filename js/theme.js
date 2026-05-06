// Single dark theme — no toggle.
// Clears any previously stored light-theme preference.
(function () {
  localStorage.removeItem('pnw-theme');
  document.documentElement.classList.remove('light-theme');
})();
