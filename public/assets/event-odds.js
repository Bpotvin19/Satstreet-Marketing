/* ──────────────────────────────────────────────────────────────────────────
   Event Odds.

   Renders whatever /api/forecasts returns and nothing else. The endpoint has
   already stripped every Polymarket identifier, so there is no slug, no
   condition id and no token id in scope here — this file could not build a
   link to a venue if it tried, which is the point.

   The page states probabilities and declines to interpret them. No "this
   implies", no "the desk reads this as". A number with a source and a
   timestamp is reporting; the sentence after it would be advice.
   ────────────────────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  var S = window.SATSTREET;
  var $ = function (id) { return document.getElementById(id); };
  var esc = S.esc;
  S.mountHeader('Event Odds');

  var REFRESH_MS = 120000;

  function pct(p) {
    if (p === null || p === undefined || !isFinite(p)) return '—';
    var v = p * 100;
    // Sub-1% outcomes are real and worth showing as "<1%" rather than "0%",
    // which reads as impossible when the market is merely saying unlikely.
    if (v > 0 && v < 1) return '<1%';
    if (v > 99 && v < 100) return '>99%';
    return Math.round(v) + '%';
  }

  function money(v) {
    if (v === null || v === undefined || !isFinite(v)) return '—';
    if (v >= 1e9) return '$' + (v / 1e9).toFixed(1) + 'B';
    if (v >= 1e6) return '$' + Math.round(v / 1e6) + 'M';
    if (v >= 1e3) return '$' + Math.round(v / 1e3) + 'K';
    return '$' + Math.round(v);
  }

  function closes(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d)) return '';
    var days = Math.ceil((d - new Date()) / 86400000);
    var when = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    if (days < 0) return 'Closed ' + when;
    if (days === 0) return 'Resolves today';
    if (days === 1) return 'Resolves tomorrow';
    if (days <= 45) return 'Resolves in ' + days + ' days';
    return 'Resolves ' + when;
  }

  /* A week of drift, shown only when the feed actually carried it. Polymarket
     leaves oneWeekPriceChange null on young markets, and an absent change is
     not a flat one. */
  function change(c) {
    if (c === null || c === undefined || !isFinite(c)) return '';
    var pts = c * 100;
    if (Math.abs(pts) < 0.5) return '<span class="chg flat">flat on the week</span>';
    var cls = pts > 0 ? 'up' : 'down';
    return '<span class="chg ' + cls + '">' + (pts > 0 ? '+' : '') + pts.toFixed(0) + ' pts on the week</span>';
  }

  function rowHtml(o, isLead) {
    var width = Math.max(0, Math.min(100, (o.probability || 0) * 100));
    return '<div class="row' + (isLead ? ' lead' : '') + '">' +
      '<span class="lab">' + esc(o.label) + '</span>' +
      '<span class="pct">' + pct(o.probability) + '</span>' +
      '<span class="bar"><i style="width:' + width.toFixed(1) + '%"></i></span>' +
      change(o.changeWeek) +
      '</div>';
  }

  /* Two kinds of card, and the reader has to be told which one they are
     looking at. An exclusive group is a single question with one answer, and
     its rows sum to about 100. A non-exclusive group is several independent
     questions sharing a heading — "will Bitcoin touch 75k", "touch 85k" — and
     its rows sum to whatever they sum to, often far past 100. Unlabelled,
     the second kind reads as a broken page. */
  function basisHtml(ev) {
    if (ev.outcomes.length < 2) return '';
    return ev.exclusive
      ? '<p class="basis">One of these resolves Yes. Prices sum to about 100%.</p>'
      : '<p class="basis">Each line is priced as its own question. They are not alternatives and do not sum to 100%.</p>';
  }

  function eventHtml(ev) {
    var rows = ev.outcomes.map(function (o, i) { return rowHtml(o, i === 0 && ev.exclusive); }).join('');
    var meta = [];
    var c = closes(ev.endDate);
    if (c) meta.push('<span>' + esc(c) + '</span>');
    if (ev.volume) meta.push('<span><b>' + money(ev.volume) + '</b> traded</span>');
    return '<section class="card ev visual-card">' +
      '<div class="ev-h"><h3>' + esc(ev.question) + '</h3>' +
      '<div class="ev-meta">' + meta.join('') + '</div>' +
      basisHtml(ev) + '</div>' +
      '<div class="rows">' + rows + '</div>' +
      '</section>';
  }

  function categoryHtml(cat) {
    var body;
    if (!cat.available) {
      body = '<div class="card empty"><b>Odds unavailable</b>' +
        'The market data source could not be reached. Nothing is shown rather than ' +
        'showing a stale or partial book.</div>';
    } else if (!cat.events.length) {
      body = '<div class="card empty"><b>No open markets</b>' +
        'Nothing in this category is currently trading.</div>';
    } else {
      body = cat.events.map(eventHtml).join('');
    }
    return '<div class="cat">' +
      '<div class="cat-h"><h2>' + esc(cat.label) + '</h2>' +
      '<span>' + (cat.available ? cat.events.length + (cat.events.length === 1 ? ' market' : ' markets') : 'unavailable') + '</span></div>' +
      '<div class="events">' + body + '</div></div>';
  }

  function setStatus(text, state) {
    $('status').textContent = text;
    $('pip').className = state || '';
  }

  function fail(message) {
    setStatus(message, 'off');
    $('board').innerHTML =
      '<div class="card empty"><b>Odds unavailable</b>' +
      'Event odds are temporarily unavailable. ' +
      '<a href="#" id="retry">Try again</a></div>';
    var r = $('retry');
    if (r) r.addEventListener('click', function (e) { e.preventDefault(); load(); });
  }

  function load() {
    fetch('/api/forecasts', { headers: { accept: 'application/json' } })
      .then(function (r) {
        if (!r.ok) throw new Error('http ' + r.status);
        return r.json();
      })
      .then(function (d) {
        if (!d || !d.available) { fail('Odds unavailable'); return; }
        $('board').innerHTML = d.categories.map(categoryHtml).join('');
        var t = new Date(d.asOf);
        setStatus('Odds as of ' + t.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }), 'on');
      })
      .catch(function () { fail('Odds unavailable'); });
  }

  load();
  setInterval(load, REFRESH_MS);
})();
