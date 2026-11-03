// Runs before the page paints, so a returning visitor never sees the wrong theme flash. Light is the default.
(function () {
  try {
    var t = localStorage.getItem('crm.theme');
    if (t === 'dark') {
      document.documentElement.classList.add('dark');
      document.documentElement.style.colorScheme = 'dark';
    }
  } catch (e) {
    /* storage can be blocked: stay light */
  }
})();
