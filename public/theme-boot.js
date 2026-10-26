'use strict';
// Applies the last interface theme before first paint. Classic needs nothing extra;
// other themes write their stylesheet synchronously so the shell never flashes.
(function bootTheme(doc) {
  var root = doc.documentElement;
  var known = { classic: 1, focus: 1, workbench: 1, paper: 1, night: 1 };
  var aliases = { drafting: 'workbench', inkviolet: 'focus' };
  var theme = 'classic';
  var labels = 'compact';
  try {
    var saved = localStorage.getItem('wb:theme:boot');
    if (saved && aliases[saved]) saved = aliases[saved];
    if (saved && Object.prototype.hasOwnProperty.call(known, saved)) theme = saved;
    if (localStorage.getItem('wb:dock-labels') === 'expanded') labels = 'expanded';
  } catch (error) { /* storage may be blocked */ }
  root.setAttribute('data-theme', theme);
  root.setAttribute('data-dock-labels', labels);
  if (theme === 'classic') return;
  root.setAttribute('data-ui', 'studio');
  var build = root.getAttribute('data-static-build');
  var href = build && /^[a-f0-9]+$/.test(build) ? 'static/' + build + '/themes.css' : 'themes.css';
  if (doc.readyState === 'loading') doc.write('<link rel="stylesheet" id="museThemeSheet" href="' + href + '">');
})(document);
