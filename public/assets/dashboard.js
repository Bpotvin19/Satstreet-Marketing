/* Personal dashboard for the Overview page.

   Three things, all remembered in this browser only (there are no accounts
   on this site, so nothing about a visitor ever leaves their device):

     1. A name, asked once, so the greeting reads "Good morning, Ben."
     2. A watchlist: which markets sit on the "Markets at a glance" board.
        The desk's default eight stay the default until someone changes it.
     3. A short guided tour, offered after the welcome and replayable.

   The page's own script reads window.SSProfile for the watchlist and name,
   and exposes window.SSDash.reload() so changes here redraw the board. */
(function () {
  'use strict';

  var KEY = 'satstreet.profile.v1';
  var MAX = 16;
  var DEFAULT = [
    { symbol: 'BTC-USD', label: 'Bitcoin' },
    { symbol: 'ETH-USD', label: 'Ethereum' },
    { symbol: 'GC=F', label: 'Gold' },
    { symbol: 'CL=F', label: 'WTI Oil' },
    { symbol: 'CAD=X', label: 'USD/CAD' },
    { symbol: '^TNX', label: 'US 10Y' },
    { symbol: '^IXIC', label: 'Nasdaq' },
    { symbol: '^GSPC', label: 'S&P 500' }
  ];
  /* One tap to add the markets clients ask for most. */
  var POPULAR = [
    { symbol: 'XRP-USD', label: 'XRP', type: 'Crypto' },
    { symbol: 'SOL-USD', label: 'Solana', type: 'Crypto' },
    { symbol: 'IBIT', label: 'iShares Bitcoin Trust', type: 'ETF' },
    { symbol: 'MSTR', label: 'Strategy', type: 'Stock' },
    { symbol: 'COIN', label: 'Coinbase', type: 'Stock' },
    { symbol: 'SI=F', label: 'Silver', type: 'Futures' },
    { symbol: 'EURUSD=X', label: 'EUR/USD', type: 'FX' },
    { symbol: '^DJI', label: 'Dow Jones', type: 'Index' }
  ];

  var memory = {};
  function read() {
    try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { return memory; }
  }
  function write(p) {
    memory = p;
    try { localStorage.setItem(KEY, JSON.stringify(p)); } catch (e) {}
  }
  var profile = read();

  function sameAsDefault(list) {
    return list.length === DEFAULT.length && list.every(function (x, i) { return x.symbol === DEFAULT[i].symbol; });
  }

  var api = window.SSProfile = {
    DEFAULT: DEFAULT,
    name: function () { return (profile.name || '').trim(); },
    watchlist: function () { return (profile.watchlist && profile.watchlist.length ? profile.watchlist : DEFAULT).slice(); },
    /* null means "the default board", so the page can ask for the shared,
       cached default rather than an identical custom list. */
    customSymbols: function () {
      var list = api.watchlist();
      return sameAsDefault(list) ? null : list.map(function (x) { return x.symbol; });
    },
    labelFor: function (symbol) {
      var hit = api.watchlist().filter(function (x) { return x.symbol === symbol; })[0];
      return hit ? hit.label : null;
    }
  };

  function save(patch) {
    for (var k in patch) profile[k] = patch[k];
    write(profile);
  }
  function setList(list) {
    save({ watchlist: sameAsDefault(list) ? null : list });
    if (window.SSDash) window.SSDash.reload();
    renderList();
  }

  /* ── helpers ─────────────────────────────────────────────────── */
  var $ = function (id) { return document.getElementById(id); };
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function greet() {
    var g = $('greeting');
    if (!g) return;
    var h = new Date().getHours();
    var name = api.name();
    g.textContent = 'Good ' + (h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening') + (name ? ', ' + name : '') + '.';
  }
  api.greet = greet;

  function open(el) {
    el.hidden = false;
    document.body.classList.add('dash-modal-open');
  }
  function close(el) {
    el.hidden = true;
    if (!document.querySelector('.dash-layer:not([hidden])')) document.body.classList.remove('dash-modal-open');
  }

  /* ── 1. welcome ──────────────────────────────────────────────── */
  function welcome(thenTour) {
    var w = $('dash-welcome');
    $('welcome-name').value = api.name();
    open(w);
    setTimeout(function () { $('welcome-name').focus(); }, 30);
    var done = function (keep) {
      if (keep) save({ name: $('welcome-name').value.trim().slice(0, 40) });
      save({ welcomed: true });
      greet();
      close(w);
      if (thenTour && !profile.toured) setTimeout(tour, 250);
    };
    $('welcome-form').onsubmit = function (e) { e.preventDefault(); done(true); };
    $('welcome-skip').onclick = function () { done(false); };
  }

  /* ── 2. customize ────────────────────────────────────────────── */
  /* Same icon as the board: assets/symbol-icons.js. */
  function icon(item) {
    return window.SSIcons ? window.SSIcons.html(item.symbol, { cls: 'dash-ic', label: item.label }) : '';
  }
  /* A plain-language line under each name instead of a Yahoo code. */
  function describe(sym) {
    var fx = /^([A-Z]{3})?([A-Z]{3})=X$/.exec(sym);
    if (/-USD$/.test(sym)) return sym.replace('-USD', ' / USD');
    if (fx) return (fx[1] || 'USD') + ' / ' + fx[2];
    if (sym === '^TNX' || sym === '^TYX' || sym === '^FVX' || sym === '^IRX') return 'Treasury yield';
    if (sym.charAt(0) === '^') return 'Index · ' + sym.slice(1);
    if (/=F$/.test(sym)) return 'Futures · ' + sym.replace('=F', '');
    return sym;
  }
  function renderList() {
    var box = $('dash-list');
    if (!box) return;
    var list = api.watchlist();
    $('dash-count').textContent = list.length + ' of ' + MAX;
    box.innerHTML = list.map(function (x, i) {
      return '<li class="dash-row">' + icon(x) +
        '<span class="dash-name"><b>' + esc(x.label) + '</b><small>' + esc(describe(x.symbol)) + '</small></span>' +
        '<span class="dash-row-actions">' +
          '<button type="button" data-move="' + i + '" data-dir="-1" aria-label="Move ' + esc(x.label) + ' up"' + (i === 0 ? ' disabled' : '') + '>↑</button>' +
          '<button type="button" data-move="' + i + '" data-dir="1" aria-label="Move ' + esc(x.label) + ' down"' + (i === list.length - 1 ? ' disabled' : '') + '>↓</button>' +
          '<button type="button" data-remove="' + i + '" aria-label="Remove ' + esc(x.label) + '"' + (list.length === 1 ? ' disabled' : '') + '>×</button>' +
        '</span></li>';
    }).join('');
    renderPopular();
  }
  function has(symbol) { return api.watchlist().some(function (x) { return x.symbol === symbol; }); }
  function add(item) {
    var list = api.watchlist();
    if (has(item.symbol)) return;
    if (list.length >= MAX) { $('dash-msg').textContent = 'The board holds up to ' + MAX + ' markets. Remove one to add another.'; return; }
    list.push({ symbol: item.symbol, label: item.label });
    $('dash-msg').textContent = item.label + ' added to your board.';
    setList(list);
    renderResults(lastResults);
  }
  function resultRow(r) {
    var added = has(r.symbol);
    return '<li><button type="button" class="dash-result" data-add="' + esc(r.symbol) + '" data-label="' + esc(r.label) + '"' + (added ? ' disabled' : '') + '>' +
      icon(r) + '<span class="dash-name"><b>' + esc(r.label) + '</b><small>' + esc(r.detail || r.symbol) + '</small></span>' +
      '<span class="dash-type">' + esc(r.type || '') + '</span><span class="dash-plus">' + (added ? 'Added' : '+ Add') + '</span></button></li>';
  }
  function renderPopular() {
    var box = $('dash-popular');
    if (!box) return;
    box.innerHTML = POPULAR.map(function (p) {
      var added = has(p.symbol);
      return '<button type="button" class="dash-chip" data-add="' + esc(p.symbol) + '" data-label="' + esc(p.label) + '"' + (added ? ' disabled' : '') + '>' +
        (added ? '✓ ' : '+ ') + esc(p.label) + '</button>';
    }).join('');
  }
  var lastResults = [], searchTimer = null, searchSeq = 0;
  function renderResults(list) {
    lastResults = list || [];
    var box = $('dash-results');
    var q = $('dash-search').value.trim();
    if (!q) { box.innerHTML = ''; return; }
    box.innerHTML = lastResults.length ? lastResults.map(resultRow).join('')
      : '<li class="dash-empty">No markets match “' + esc(q) + '”.</li>';
  }
  function search(q) {
    var seq = ++searchSeq;
    if (!q) { renderResults([]); return; }
    $('dash-results').innerHTML = '<li class="dash-empty">Searching…</li>';
    fetch('/api/symbols?q=' + encodeURIComponent(q))
      .then(function (r) { return r.ok ? r.json() : { results: [] }; })
      .then(function (d) { if (seq === searchSeq) renderResults(d.results || []); })
      .catch(function () { if (seq === searchSeq) $('dash-results').innerHTML = '<li class="dash-empty">Search is unavailable right now.</li>'; });
  }

  function customize() {
    var c = $('dash-customize');
    $('dash-name-input').value = api.name();
    $('dash-search').value = '';
    $('dash-msg').textContent = '';
    renderResults([]);
    renderList();
    open(c);
    setTimeout(function () { $('dash-search').focus(); }, 30);
  }
  api.customize = customize;

  function wireCustomize() {
    var c = $('dash-customize');
    c.addEventListener('click', function (e) {
      if (e.target === c) { close(c); return; }
      var a = e.target.closest('[data-add]');
      if (a && !a.disabled) { add({ symbol: a.getAttribute('data-add'), label: a.getAttribute('data-label') }); return; }
      var m = e.target.closest('[data-move]');
      if (m && !m.disabled) {
        var list = api.watchlist(), i = +m.getAttribute('data-move'), j = i + (+m.getAttribute('data-dir'));
        var t = list[i]; list[i] = list[j]; list[j] = t;
        setList(list);
        return;
      }
      var r = e.target.closest('[data-remove]');
      if (r && !r.disabled) {
        var l2 = api.watchlist(), gone = l2.splice(+r.getAttribute('data-remove'), 1)[0];
        $('dash-msg').textContent = gone.label + ' removed.';
        setList(l2);
        renderResults(lastResults);
      }
    });
    $('dash-search').addEventListener('input', function () {
      clearTimeout(searchTimer);
      var q = this.value.trim();
      searchTimer = setTimeout(function () { search(q); }, 250);
    });
    $('dash-name-input').addEventListener('input', function () {
      save({ name: this.value.trim().slice(0, 40) });
      greet();
    });
    $('dash-reset').addEventListener('click', function () {
      setList(DEFAULT.slice());
      $('dash-msg').textContent = 'Back to the default board.';
      renderResults(lastResults);
    });
    $('dash-tour').addEventListener('click', function () { close(c); setTimeout(tour, 200); });
    $('dash-done').addEventListener('click', function () { close(c); });
    $('dash-close').addEventListener('click', function () { close(c); });
  }

  /* ── 3. tour ─────────────────────────────────────────────────── */
  function visible(el) {
    if (!el) return false;
    var r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
  }
  var STEPS = [
    { el: function () { return document.querySelector('.intro'); },
      title: 'Your daily snapshot',
      body: 'Today’s date, your greeting and a one-line read on where markets are this morning.' },
    { el: function () { return $('asset-grid'); },
      title: 'Markets at a glance',
      body: 'Each tile is a reference price with today’s move. Select any tile to bring it into the chart below.' },
    { el: function () { return $('customize-btn'); },
      title: 'Make it yours',
      body: 'Add the markets you follow (XRP, Solana, MSTR, IBIT, currencies, indices), remove the ones you don’t, and reorder them. Saved on this device.' },
    { el: function () { return document.querySelector('.focus-panel'); },
      title: 'Focus chart',
      body: 'Switch the range from one day to one year. Session open, high and low sit alongside.' },
    { el: function () { var n = $('mainnav'); return visible(n) ? n : $('navtoggle'); },
      title: 'More from the desk',
      body: 'News from Decrypt, the full Markets board with network and ETF flows, detailed charts, and a block explorer for Bitcoin, Ethereum and Solana.' }
  ];
  var step = 0, active = false;

  function place() {
    if (!active) return;
    var s = STEPS[step], el = s.el(), spot = $('tour-spot'), card = $('tour-card');
    if (!el || !visible(el)) { spot.style.opacity = '0'; } else {
      var r = el.getBoundingClientRect(), pad = 8;
      spot.style.opacity = '1';
      spot.style.left = (r.left - pad) + 'px';
      spot.style.top = (r.top - pad) + 'px';
      spot.style.width = (r.width + pad * 2) + 'px';
      spot.style.height = (r.height + pad * 2) + 'px';
      var cw = card.offsetWidth, ch = card.offsetHeight, vw = window.innerWidth, vh = window.innerHeight;
      var top = r.bottom + 16 + ch < vh ? r.bottom + 16 : (r.top - 16 - ch > 0 ? r.top - 16 - ch : Math.max(12, vh - ch - 12));
      var left = Math.min(Math.max(12, r.left), vw - cw - 12);
      card.style.top = top + 'px';
      card.style.left = left + 'px';
    }
  }
  function show(i) {
    step = i;
    var s = STEPS[i];
    $('tour-step').textContent = 'Step ' + (i + 1) + ' of ' + STEPS.length;
    $('tour-title').textContent = s.title;
    $('tour-body').textContent = s.body;
    $('tour-back').hidden = i === 0;
    $('tour-next').textContent = i === STEPS.length - 1 ? 'Finish' : 'Next';
    var el = s.el();
    if (el && visible(el)) {
      var r = el.getBoundingClientRect();
      if (r.top < 70 || r.bottom > window.innerHeight - 40) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
    setTimeout(place, 380);
    place();
    $('tour-next').focus();
  }
  function endTour() {
    active = false;
    close($('dash-tour-layer'));
    save({ toured: true });
  }
  function tour() {
    active = true;
    open($('dash-tour-layer'));
    show(0);
  }
  api.tour = tour;

  function wireTour() {
    $('tour-next').addEventListener('click', function () { if (step < STEPS.length - 1) show(step + 1); else endTour(); });
    $('tour-back').addEventListener('click', function () { if (step > 0) show(step - 1); });
    $('tour-skip').addEventListener('click', endTour);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, { passive: true });
  }

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if (active) { endTour(); return; }
    var c = $('dash-customize'); if (c && !c.hidden) close(c);
  });

  function init() {
    greet();
    wireCustomize();
    wireTour();
    $('customize-btn').addEventListener('click', customize);
    $('tour-btn').addEventListener('click', tour);
    if (!profile.welcomed) setTimeout(function () { welcome(true); }, 400);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
