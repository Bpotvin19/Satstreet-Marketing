/* ──────────────────────────────────────────────────────────────────────
   Satstreet terminal — shared shell.

   The header, the logo, and the formatting every page needs to agree on.
   One nav definition means the five pages cannot drift apart, and one
   logo constant means the brand mark is the existing asset everywhere,
   never re-encoded.
   ────────────────────────────────────────────────────────────────────── */

window.SATSTREET = (function () {
  'use strict';

  var LOGO = 'data:image/png;base64,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';

  /* The client cut of the nav. News and Resources are absent because the
     pages themselves are absent from this branch, not merely unlinked.

     Chart sits ahead of Structure here. On the desk build an edge function
     reorders these two at request time; there is no reason to ship the wrong
     order and patch it in the browser, so this branch states the order it
     wants and the edge function no longer touches the nav at all. */
  var NAV = [
    ['Overview',  './overview.html'],
    ['Markets',   './ticker.html'],
    ['Chart',     './chart.html'],
    ['Structure', './structure.html'],
    ['Treasuries','./treasuries.html'],
    ['Explorer',  './explorer.html'],
    ['Event Odds','./event-odds.html'],
    ['Portfolio', './portfolio.html']
  ];

  var esc = function (s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  };

  /* The header, rendered rather than copied into five files. `current` is the
     nav label of the page drawing it, so the underline and aria-current are
     always in step with where the visitor actually is. */
  function header(current) {
    var wide = current === 'Markets' || current === 'Chart' || current === 'Treasuries' || current === 'Explorer' || current === 'Event Odds';
    var links = NAV.map(function (n) {
      var on = n[0] === current;
      return '<a href="' + n[1] + '"' + (on ? ' aria-current="page"' : '') + '>' + esc(n[0]) + '</a>';
    }).join('');

    return '<header class="topbar navy"><div class="topbar-in' + (wide ? ' wide' : '') + '">' +
      '<a class="brand" href="./overview.html" aria-label="Satstreet — Overview">' +
      '<img src="' + LOGO + '" alt="Satstreet" /></a>' +
      '<button class="navtoggle" id="navtoggle" aria-expanded="false" aria-controls="mainnav">Menu</button>' +
      '<nav class="mainnav" id="mainnav" aria-label="Primary">' + links + '</nav>' +
      '<span class="spacer"></span>' +
      /* No notification bell and no staff avatar. Both belong to whoever runs
         the desk, and neither does anything a visitor to this site can use. */
      '</div></header>';
  }

  function mountHeader(current) {
    var slot = document.getElementById('shell-header');
    if (!slot) return;
    slot.outerHTML = header(current);
    var t = document.getElementById('navtoggle');
    t.addEventListener('click', function () {
      var open = document.getElementById('mainnav').classList.toggle('open');
      t.setAttribute('aria-expanded', String(open));
    });
  }

  /* ── formatting, shared so pages never disagree on a number ── */
  var fmt = {
    money: function (v, ccy, dp) {
      if (v === null || v === undefined || !isFinite(v)) return '—';
      return (ccy === 'CAD' ? 'CA$' : '$') +
        v.toLocaleString('en-US', { maximumFractionDigits: dp === undefined ? 2 : dp });
    },
    compact: function (v) {
      if (v === null || v === undefined || !isFinite(v)) return '—';
      var a = Math.abs(v);
      if (a >= 1e12) return '$' + (v / 1e12).toFixed(2) + 'T';
      if (a >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B';
      if (a >= 1e6) return '$' + (v / 1e6).toFixed(1) + 'M';
      return '$' + v.toLocaleString('en-US', { maximumFractionDigits: 0 });
    },
    pct: function (v, dp) {
      if (v === null || v === undefined || !isFinite(v)) return '—';
      return (v > 0 ? '+' : '') + v.toFixed(dp === undefined ? 2 : dp) + '%';
    },
    bps: function (v) {
      if (v === null || v === undefined || !isFinite(v)) return '—';
      var b = Math.round(v * 100);
      return (b > 0 ? '+' : '') + b + ' bps';
    },
    time: function (d) {
      return new Date(d).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    },
    dir: function (v) { return v > 0 ? 'up' : v < 0 ? 'down' : 'flat'; }
  };

  /* A sparkline, or nothing. Never a flat line standing in for absent data. */
  function spark(points, cls, w, h) {
    if (!points || points.length < 3) return '';
    w = w || 58; h = h || 26;
    var lo = Math.min.apply(null, points), hi = Math.max.apply(null, points), span = hi - lo || 1;
    var d = points.map(function (p, i) {
      return (i ? 'L' : 'M') + (i / (points.length - 1) * w).toFixed(1) + ' ' +
        (h - ((p - lo) / span) * h).toFixed(1);
    }).join(' ');
    var stroke = cls === 'up' ? '#0f8a63' : cls === 'down' ? '#c33a49' : '#98a5b4';
    return '<svg width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h +
      '" aria-hidden="true"><path d="' + d + '" fill="none" stroke="' + stroke +
      '" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/></svg>';
  }

  /* ── shared states ─────────────────────────────────────────── */
  function skeleton(rows, height) {
    var out = '';
    for (var i = 0; i < (rows || 3); i++) {
      out += '<div class="skel" style="height:' + (height || 14) + 'px;width:' +
        (70 + (i % 3) * 12) + '%;margin-bottom:9px"></div>';
    }
    return out;
  }
  function errorState(what, detail, retryId) {
    return '<p class="errbox"><b>' + esc(what) + '</b>' + esc(detail || '') +
      (retryId ? ' <button class="retry" id="' + retryId + '" type="button">Try again</button>' : '') + '</p>';
  }
  function emptyState(text) { return '<p class="emptybox">' + esc(text) + '</p>'; }

  /* Data older than this is labelled rather than shown as current. */
  var STALE_MINUTES = 15;
  function staleness(asOf) {
    var mins = (Date.now() - new Date(asOf).getTime()) / 60000;
    return { stale: mins > STALE_MINUTES, minutes: Math.round(mins) };
  }

  return {
    LOGO: LOGO, NAV: NAV, esc: esc, header: header, mountHeader: mountHeader,
    fmt: fmt, spark: spark, skeleton: skeleton, errorState: errorState,
    emptyState: emptyState, staleness: staleness
  };
})();
