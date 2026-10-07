/* Webflow embed shim. Loaded first by every Satstreet page snippet.

   1. /api/… and /data/… requests go to the Netlify host, where the data
      functions live (Webflow cannot run them).
   2. Links and history entries written as ./overview.html, ./chart.html?…
      are mapped onto the Webflow page addresses in SATSTREET_EMBED.pages.
   3. SATSTREET_EMBED.header === false hides the terminal's own navy bar,
      for pages where the Webflow site navigation is enough. */
(function () {
  'use strict';
  var C = window.SATSTREET_EMBED || {};
  var HOST = String(C.host || '').replace(/\/$/, '');
  var PAGES = C.pages || {};

  var nativeFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    if (typeof input === 'string' && /^\/(api|data)\//.test(input)) input = HOST + input;
    return nativeFetch(input, init);
  };

  var RE = /^(?:\.\/|\/)?(overview|news|ticker|chart|explorer)\.html(.*)$/;
  function map(url) {
    if (typeof url !== 'string') return url;
    var m = RE.exec(url);
    return m && PAGES[m[1]] ? PAGES[m[1]] + m[2] : url;
  }
  window.SS_URL = map;

  ['pushState', 'replaceState'].forEach(function (k) {
    var orig = history[k];
    history[k] = function (state, title, url) { return orig.call(history, state, title, url == null ? url : map(String(url))); };
  });

  function fix(a) {
    var h = a.getAttribute('href');
    if (h && RE.test(h)) a.setAttribute('href', map(h));
  }
  function sweep(node) {
    if (node.nodeType !== 1) return;
    if (node.tagName === 'A') fix(node);
    if (node.querySelectorAll) Array.prototype.forEach.call(node.querySelectorAll('a[href]'), fix);
  }
  new MutationObserver(function (list) {
    list.forEach(function (m) {
      if (m.type === 'attributes') fix(m.target);
      else Array.prototype.forEach.call(m.addedNodes, sweep);
    });
  }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['href'] });

  if (C.header === false) {
    var s = document.createElement('style');
    s.textContent = '.ss-app .topbar,.ss-app #shell-header{display:none!important}';
    document.head.appendChild(s);
  }
})();
