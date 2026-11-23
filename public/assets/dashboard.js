/* Personal dashboard for the Overview page.

   Three things, all remembered in this browser only (there are no accounts
   on this site, so nothing about a visitor ever leaves their device):

     1. A watchlist: which markets sit on the "Markets at a glance" board.
        The desk's default eight stay the default until someone changes it.
     2. An optional name for the greeting, set in the Edit watchlist panel's
        Settings. Nothing asks for it on arrival.
     3. A short guided tour, only when the visitor asks for it.

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
    { symbol: 'COIN', label: 'COIN', type: 'Stock' },
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
  api.remove = function (symbol) {
    var list = api.watchlist();
    if (list.length <= 1) return false;
    var next = list.filter(function (item) { return item.symbol !== symbol; });
    if (next.length === list.length) return false;
    setList(next);
    return true;
  };

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

  /* Dialogs: focus moves in on open, Tab stays inside, Escape closes, and
     focus returns to whatever opened it. */
  var returnTo = null;
  function focusables(el) {
    return Array.prototype.filter.call(el.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'), function (x) {
      return !x.disabled && !x.hidden && x.offsetParent !== null;
    });
  }
  function open(el, trigger) {
    returnTo = trigger || (document.activeElement !== document.body ? document.activeElement : null);
    el.hidden = false;
    document.body.classList.add('dash-modal-open');
  }
  function close(el) {
    el.hidden = true;
    if (!document.querySelector('.dash-layer:not([hidden])')) document.body.classList.remove('dash-modal-open');
    var to = returnTo; returnTo = null;
    /* The board redraws while the panel is open, which can replace the trigger: find it again by id. */
    if (to && !document.contains(to) && to.id) to = document.getElementById(to.id);
    if (to && document.contains(to)) to.focus();
    else { var b = $('customize-btn'); if (b) b.focus(); }
  }
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Tab') return;
    var layer = document.querySelector('.dash-layer:not([hidden])');
    if (!layer) return;
    var items = focusables(layer);
    if (!items.length) return;
    var first = items[0], last = items[items.length - 1];
    if (!layer.contains(document.activeElement)) { e.preventDefault(); first.focus(); return; }
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });

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
    if (list.length >= MAX) { $('dash-msg').textContent = 'Your watchlist holds up to ' + MAX + ' markets. Remove one to add another.'; return; }
    list.push({ symbol: item.symbol, label: item.label });
    $('dash-msg').textContent = item.label + ' added to your watchlist.';
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

  function customize(trigger) {
    var c = $('dash-customize');
    $('dash-name-input').value = api.name();
    $('dash-search').value = '';
    $('dash-msg').textContent = '';
    renderResults([]);
    renderList();
    open(c, trigger && trigger.nodeType === 1 ? trigger : null);
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
        /* Keep keyboard focus on the item that moved. */
        var d = m.getAttribute('data-dir'), nb = $('dash-list').querySelector('[data-move="' + j + '"][data-dir="' + d + '"]');
        if (nb && nb.disabled) nb = $('dash-list').querySelector('[data-move="' + j + '"]:not([disabled])');
        if (nb) nb.focus();
        $('dash-msg').textContent = t.label + ' moved to position ' + (j + 1) + '.';
        return;
      }
      var r = e.target.closest('[data-remove]');
      if (r && !r.disabled) {
        var l2 = api.watchlist(), gone = l2.splice(+r.getAttribute('data-remove'), 1)[0];
        $('dash-msg').textContent = gone.label + ' removed.';
        var at = +r.getAttribute('data-remove');
        setList(l2);
        renderResults(lastResults);
        var rows = $('dash-list').querySelectorAll('[data-remove]');
        var nf = rows[Math.min(at, rows.length - 1)];
        (nf && !nf.disabled ? nf : $('dash-search')).focus();
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
      $('dash-msg').textContent = 'Back to the default watchlist.';
      renderResults(lastResults);
    });
    $('dash-tour').addEventListener('click', function () { close(c); setTimeout(function () { tour($('tour-btn')); }, 200); });
    $('dash-done').addEventListener('click', function () { close(c); });
    $('dash-close').addEventListener('click', function () { close(c); });
  }

  /* ── 3. tour ─────────────────────────────────────────────────── */
  function visible(el) {
    if (!el) return false;
    var r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
  }
  /* The tour follows the page top to bottom. A step whose section is not on
     the page (the macro panel stays hidden until FRED data loads) is left
     out when the tour starts, so the count never promises a step it skips. */
  var STEPS = [
    { el: function () { return document.querySelector('.intro'); },
      title: 'Market briefing',
      body: 'A factual summary built only from the prices on your watchlist, with the quote currency, your time zone and when prices were last retrieved.' },
    { el: function () { return $('asset-grid'); },
      title: 'Your watchlist',
      body: 'Each tile is an indicative reference price. Crypto moves are over 24 hours; exchange-traded moves are since the prior close. Select a tile to chart it below.' },
    { el: function () { return $('customize-btn'); },
      title: 'Edit watchlist',
      body: 'Add the markets you follow, remove or reorder them, and optionally set a name for the greeting. Saved on this device only.' },
    { el: function () { return document.querySelector('.focus-panel'); },
      title: 'Selected market',
      body: 'Price, move and status for the market you selected, with its source and the time of the last price. Switch the timeframe from one day to all history.' },
    { el: function () { return document.querySelector('.card.macro'); },
      title: 'Macro backdrop',
      body: 'The US economy in eight numbers from the Federal Reserve’s FRED database: rates, inflation, jobs, the yield curve, money supply and the dollar. Select one to see its full history on FRED.' },
    { el: function () { return document.querySelector('.news-card'); },
      title: 'Latest crypto news',
      body: 'Headlines from Decrypt. Select one to read the full article on decrypt.co in a new tab, free and with no sign-up. All news has the full feed.' },
    { el: function () { return document.querySelector('.side-stack'); },
      title: 'Catalysts and the halving',
      body: 'Upcoming dates that tend to move markets, and a live countdown to the next Bitcoin halving.' },
    { el: function () { return document.querySelector('.amc-table') && document.querySelector('.amc-table').closest('.card'); },
      title: 'Largest assets',
      body: 'Where Bitcoin ranks against gold, silver and the largest listed companies by market value, computed from live prices.' },
    { el: function () { var n = $('mainnav'); return visible(n) ? n : $('navtoggle'); },
      title: 'More from the desk',
      body: 'News from Decrypt, the full Markets board with network and ETF flows, detailed charts, and a block explorer for Bitcoin, Ethereum, Solana and XRP.' }
  ];
  var steps = STEPS;
  var step = 0, active = false;

  function place() {
    if (!active) return;
    var s = steps[step], el = s.el(), spot = $('tour-spot'), card = $('tour-card');
    if (!el || !visible(el)) { spot.style.opacity = '0'; } else {
      var r = el.getBoundingClientRect(), pad = 8;
      spot.style.opacity = '1';
      spot.style.left = (r.left - pad) + 'px';
      spot.style.top = (r.top - pad) + 'px';
      spot.style.width = (r.width + pad * 2) + 'px';
      spot.style.height = (r.height + pad * 2) + 'px';
      var cw = card.offsetWidth, ch = card.offsetHeight, vw = window.innerWidth, vh = window.innerHeight;
      /* A section taller than most of the screen (the largest-assets table)
         keeps its heading in view; the card sits at the foot instead. */
      var tall = r.height > vh * 0.6;
      var top = tall ? Math.max(12, vh - ch - 12) :
        (r.bottom + 16 + ch < vh ? r.bottom + 16 : (r.top - 16 - ch > 0 ? r.top - 16 - ch : Math.max(12, vh - ch - 12)));
      var left = Math.min(Math.max(12, r.left), vw - cw - 12);
      card.style.top = top + 'px';
      card.style.left = left + 'px';
    }
  }
  function show(i) {
    step = i;
    var s = steps[i];
    $('tour-step').textContent = 'Step ' + (i + 1) + ' of ' + steps.length;
    $('tour-title').textContent = s.title;
    $('tour-body').textContent = s.body;
    $('tour-back').hidden = i === 0;
    $('tour-next').textContent = i === steps.length - 1 ? 'Finish' : 'Next';
    var el = s.el();
    if (el && visible(el)) {
      var r = el.getBoundingClientRect();
      if (r.height > window.innerHeight * 0.6) {
        if (Math.abs(r.top - 80) > 24) window.scrollBy({ top: r.top - 80, behavior: 'smooth' });
      } else if (r.top < 70 || r.bottom > window.innerHeight - 40) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
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
  function tour(trigger) {
    steps = STEPS.filter(function (s) { return visible(s.el()); });
    if (!steps.length) return;
    active = true;
    open($('dash-tour-layer'), trigger && trigger.nodeType === 1 ? trigger : $('tour-btn'));
    show(0);
  }
  api.tour = tour;

  function wireTour() {
    $('tour-next').addEventListener('click', function () { if (step < steps.length - 1) show(step + 1); else endTour(); });
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
    $('customize-btn').addEventListener('click', function () { customize($('customize-btn')); });
    $('tour-btn').addEventListener('click', function () { tour($('tour-btn')); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
