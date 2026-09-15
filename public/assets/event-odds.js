/* ──────────────────────────────────────────────────────────────────────────
   Event Odds.

   Renders whatever /api/forecasts returns and nothing else. The endpoint has
   already stripped every venue identifier — no slug, no condition id, no
   token id is in scope here — so this file could not build a link to an
   exchange if it tried. That is the point, and it is why the page carries no
   anchors at all.

   The page states probabilities and declines to interpret them. No "this
   implies", no "the desk reads this as". A number with a source and a
   timestamp is reporting; the sentence after it would be advice.

   One market, one shape. An exclusive market is a single distribution and is
   drawn as one segmented bar. An independent group is several questions that
   share a heading and is drawn as separate tracks, because one bar would
   assert a relationship that is not there.
   ────────────────────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  var S = window.SATSTREET;
  var $ = function (id) { return document.getElementById(id); };
  var esc = S.esc;
  S.mountHeader('Event Odds');

  var REFRESH_MS = 120000;

  var markets = [];
  var category = 'All';
  var query = '';
  var sort = 'volume';
  var source = 'Third-party market';
  var updatedAt = '';

  /* ── formatting ─────────────────────────────────────────────────────────── */

  function pct(p) {
    if (p === null || p === undefined || !isFinite(p)) return '—';
    var v = p * 100;
    // A market pricing something at a third of a percent is saying unlikely,
    // not impossible. Rounding that to 0% would say the wrong thing.
    if (v > 0 && v < 1) return '<1%';
    if (v > 99 && v < 100) return '>99%';
    return Math.round(v) + '%';
  }

  function money(v) {
    if (v === null || v === undefined || !isFinite(v)) return '—';
    if (v >= 1e9) return '$' + (v / 1e9).toFixed(1) + 'B';
    if (v >= 1e6) return '$' + (v / 1e6).toFixed(v < 1e7 ? 1 : 0) + 'M';
    if (v >= 1e3) return '$' + Math.round(v / 1e3) + 'K';
    return '$' + Math.round(v);
  }

  function daysOut(iso) {
    if (!iso) return null;
    var d = new Date(iso);
    if (isNaN(d)) return null;
    return Math.ceil((d - new Date()) / 86400000);
  }

  function dateLabel(iso) {
    if (!iso) return 'Date unavailable';
    var d = new Date(iso);
    if (isNaN(d)) return 'Date unavailable';
    var thisYear = d.getFullYear() === new Date().getFullYear();
    return d.toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: thisYear ? undefined : 'numeric',
    });
  }

  /* How close a market is to resolving, as a chip. A market settling tomorrow
     is the most useful thing on the page and should not look like one
     settling in fourteen months. */
  function resolveChip(iso) {
    var n = daysOut(iso);
    if (n === null) return '';
    if (n < 0) return '<span class="chip later">Closed</span>';
    if (n === 0) return '<span class="chip soon">Resolves today</span>';
    if (n === 1) return '<span class="chip soon">Resolves tomorrow</span>';
    if (n <= 14) return '<span class="chip soon">Resolves in ' + n + ' days</span>';
    return '<span class="chip later">' + esc(dateLabel(iso)) + '</span>';
  }

  /* A week of drift, shown only where the feed carried it. Upstream leaves
     this null on young markets, and an absent change is not a flat one. */
  function move(c) {
    if (c === null || c === undefined || !isFinite(c)) return '';
    var n = c * 100;
    if (Math.abs(n) < 0.5) return '<span class="move flat">Flat on the week</span>';
    var dir = n > 0 ? 'up' : 'down';
    var arrow = n > 0 ? '▲' : '▼';
    return '<span class="move ' + dir + '">' + arrow + ' ' + Math.abs(Math.round(n)) + ' pts on the week</span>';
  }

  /* ── shaping the feed ───────────────────────────────────────────────────── */

  function flatten(d) {
    var out = [];
    (d.categories || []).forEach(function (group) {
      if (group.available === false) return;
      (group.events || []).forEach(function (ev, i) {
        var outcomes = (ev.outcomes || [])
          .filter(function (o) { return o.probability !== null && o.probability !== undefined; })
          .slice()
          .sort(function (a, b) { return b.probability - a.probability; });
        if (!outcomes.length) return;
        out.push({
          id: group.label + '-' + i,
          // The endpoint already grouped these. Re-deriving a category by
          // pattern-matching the question text would only invent ways to
          // disagree with it.
          category: group.label,
          question: ev.question,
          endDate: ev.endDate || null,
          volume: isFinite(ev.volume) ? ev.volume : null,
          exclusive: !!ev.exclusive,
          outcomes: outcomes,
          lead: outcomes[0],
          rules: ev.rules || null,
          history: Array.isArray(ev.history) ? ev.history : null,
        });
      });
    });
    return out;
  }


  /* ── the probability line ───────────────────────────────────────────────

     One line: the leading outcome over the past week.

     The vertical scale is the data's own range, padded, not a fixed 0-100.
     A market that moved from 54% to 88% is the story on this page, and on a
     full-height axis that move is a gentle slope in the middle of empty
     space. The axis is labelled at both ends precisely because the scale is
     not fixed — an unlabelled zoomed axis is how a chart misleads. */

  function extent(points) {
    var lo = 1, hi = 0;
    points.forEach(function (pt) { if (pt.p < lo) lo = pt.p; if (pt.p > hi) hi = pt.p; });
    // Never show a band narrower than 12 points, or noise looks like a trend.
    var pad = Math.max((hi - lo) * 0.18, 0.06);
    return { lo: Math.max(0, lo - pad), hi: Math.min(1, hi + pad) };
  }

  function linePath(points, w, h, lo, hi) {
    var span = (hi - lo) || 1;
    var t0 = points[0].t, t1 = points[points.length - 1].t;
    var dt = (t1 - t0) || 1;
    return points.map(function (pt, i) {
      var x = ((pt.t - t0) / dt) * w;
      var y = h - ((pt.p - lo) / span) * h;
      return (i ? 'L' : 'M') + x.toFixed(2) + ' ' + y.toFixed(2);
    }).join(' ');
  }

  function chartHtml(points, opts) {
    if (!points || points.length < 4) return '';
    var big = !!(opts && opts.big);
    var w = 300, h = big ? 84 : 42;
    var e = extent(points);
    var d = linePath(points, w, h, e.lo, e.hi);
    var last = points[points.length - 1];
    var lastX = w, lastY = h - ((last.p - e.lo) / ((e.hi - e.lo) || 1)) * h;
    var rising = last.p >= points[0].p;
    var stroke = rising ? 'var(--up)' : 'var(--down)';

    var axis = '';
    if (big) {
      axis = '<div class="chart-axis">' +
        '<span>' + pct(e.hi) + '</span><span>' + pct(e.lo) + '</span></div>';
    }

    return '<div class="chart' + (big ? ' big' : '') + '">' + axis +
      '<svg viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none" role="img" ' +
      'aria-label="Leading outcome moved from ' + pct(points[0].p) + ' to ' + pct(last.p) +
      ' over the past week">' +
      '<path d="' + d + ' L' + w + ' ' + h + ' L0 ' + h + ' Z" fill="' + stroke + '" opacity=".07"/>' +
      '<path d="' + d + '" fill="none" stroke="' + stroke + '" stroke-width="1.6" ' +
      'stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>' +
      '<circle cx="' + lastX.toFixed(1) + '" cy="' + lastY.toFixed(1) + '" r="2.6" fill="' + stroke + '" ' +
      'vector-effect="non-scaling-stroke"/>' +
      '</svg>' +
      (big ? '<div class="chart-foot"><span>7 days ago</span><span>Now</span></div>' : '') +
      '</div>';
  }

  /* How the market settles, in the venue's words. Collapsed, because it is
     reference material rather than something to read on every card — but
     present, because "Bitcoin above $100k" means nothing until you know which
     price, from which source, at which moment. */
  function rulesHtml(m) {
    if (!m.rules) return '';
    return '<details class="more rules"><summary>How this resolves</summary>' +
      '<p>' + esc(m.rules) + '</p></details>';
  }

  /* ── drawing a market ───────────────────────────────────────────────────── */

  var SEGMENTS = ['var(--seg-1)', 'var(--seg-2)', 'var(--seg-3)', 'var(--seg-4)'];
  function segColor(i) { return SEGMENTS[i] || 'var(--seg-rest)'; }

  /* The distribution, as one bar. Only meaningful when exactly one outcome can
     resolve Yes — which is why nothing else calls this. */
  function distHtml(outcomes) {
    var total = outcomes.reduce(function (n, o) { return n + o.probability; }, 0);
    if (!(total > 0)) return '';
    var segs = outcomes.map(function (o, i) {
      var w = (o.probability / total) * 100;
      // Below about a percent a segment is thinner than its own border and
      // reads as a rendering artifact. The legend still lists it.
      if (w < 0.8) return '';
      return '<span style="width:' + w.toFixed(2) + '%;background:' + segColor(i) + '"></span>';
    }).join('');
    return '<div class="dist" role="img" aria-label="Probability distribution across ' +
      outcomes.length + ' outcomes">' + segs + '</div>';
  }

  function legendHtml(outcomes) {
    return '<div class="legend">' + outcomes.map(function (o, i) {
      return '<div class="legend-row' + (i === 0 ? ' top' : '') + '">' +
        '<span class="legend-key" style="background:' + segColor(i) + '"></span>' +
        '<span class="legend-label">' + esc(o.label) +
        (o.volume ? '<i class="ovol">' + money(o.volume) + '</i>' : '') + '</span>' +
        '<span class="legend-pct">' + pct(o.probability) + '</span>' +
        '</div>';
    }).join('') + '</div>';
  }

  function trackHtml(o, isTop) {
    var w = Math.max(0, Math.min(100, o.probability * 100));
    return '<div class="track-row' + (isTop ? ' top' : '') + '">' +
      '<span class="track-label">' + esc(o.label) +
      (o.volume ? '<i class="ovol">' + money(o.volume) + '</i>' : '') + '</span>' +
      '<span class="track-pct">' + pct(o.probability) + '</span>' +
      '<span class="track"><i style="width:' + w.toFixed(1) + '%"></i></span>' +
      '</div>';
  }

  /* Independent questions, each on its own track. Long groups collapse, and
     the summary counts what it is actually hiding. */
  function tracksHtml(outcomes) {
    var shown = outcomes.slice(0, 4);
    var extra = outcomes.slice(4);
    var html = '<div class="tracks">' + shown.map(function (o, i) { return trackHtml(o, i === 0); }).join('');
    if (extra.length) {
      html += '<details class="more"><summary>Show ' + extra.length +
        (extra.length === 1 ? ' more outcome' : ' more outcomes') + '</summary>' +
        extra.map(function (o) { return trackHtml(o, false); }).join('') + '</details>';
    }
    return html + '</div>';
  }

  function basisNote(m) {
    return m.exclusive
      ? 'One of these outcomes resolves Yes. The bar is the whole distribution.'
      : 'Each line is priced as its own question. They are not alternatives and do not sum to 100%.';
  }

  function bodyHtml(m) {
    if (m.exclusive) {
      var top = m.outcomes.slice(0, 5);
      var rest = m.outcomes.slice(5);
      var html = distHtml(m.outcomes) + legendHtml(top);
      if (rest.length) {
        html += '<details class="more"><summary>Show ' + rest.length +
          (rest.length === 1 ? ' more outcome' : ' more outcomes') + '</summary>' +
          legendHtml(rest) + '</details>';
      }
      return html;
    }
    return tracksHtml(m.outcomes);
  }

  function footHtml(m) {
    var bits = [];
    if (m.volume) bits.push('<span><strong>' + money(m.volume) + '</strong> traded</span>');
    var mv = move(m.lead.changeWeek);
    if (mv) bits.push(mv);
    return '<div class="market-card-foot">' +
      (bits.length ? '<div class="meta-line">' + bits.join('') + '</div>' : '') +
      '<p class="basis-note">' + basisNote(m) + '</p>' +
      '</div>';
  }

  function headHtml(m) {
    return '<div class="market-card-head">' +
      '<span class="market-category">' + esc(m.category) + '</span>' +
      resolveChip(m.endDate) +
      '</div>';
  }

  /* The headline number names its own outcome, and that outcome is not then
     repeated as the first row underneath it. */
  function leadHtml(m) {
    return '<div class="lead-block">' +
      '<div class="lead">' +
      '<span class="lead-number">' + pct(m.lead.probability) + '</span>' +
      '<span class="lead-label">' + esc(m.lead.label) + '</span>' +
      '</div><p class="lead-caption">Leading outcome</p></div>';
  }

  function cardHtml(m) {
    return '<article class="market-card" data-market-id="' + esc(m.id) + '">' +
      headHtml(m) +
      '<h3 class="market-q">' + esc(m.question) + '</h3>' +
      leadHtml(m) + chartHtml(m.history) + bodyHtml(m) + footHtml(m) + rulesHtml(m) +
      '</article>';
  }

  function featuredHtml(m) {
    return '<article class="market-card featured" data-market-id="' + esc(m.id) + '">' +
      '<div class="feat-left">' + headHtml(m) +
      '<h3 class="market-q">' + esc(m.question) + '</h3>' + leadHtml(m) +
      chartHtml(m.history, { big: true }) + '</div>' +
      '<div class="feat-right">' + bodyHtml(m) + footHtml(m) + rulesHtml(m) + '</div>' +
      '</article>';
  }


  /* ── what moved ─────────────────────────────────────────────────────────

     A board of fourteen probabilities answers "where do things stand". It
     does not answer "what changed", which is the question a desk actually
     opens with. This strip is the three largest weekly moves, and it is free:
     the change is already on every leading outcome.

     It is drawn from the full set, not the filtered one. A category filter
     narrows the board below; the movers stay the movers. */
  function moversHtml() {
    var moved = markets
      .filter(function (m) {
        var c = m.lead.changeWeek;
        return c !== null && c !== undefined && isFinite(c) && Math.abs(c) >= 0.03;
      })
      .sort(function (a, b) { return Math.abs(b.lead.changeWeek) - Math.abs(a.lead.changeWeek); })
      .slice(0, 3);

    if (!moved.length) return '';

    var items = moved.map(function (m) {
      var pts = m.lead.changeWeek * 100;
      var dir = pts > 0 ? 'up' : 'down';
      return '<div class="mover">' +
        '<p class="mover-q">' + esc(m.question) + '</p>' +
        '<div class="mover-row">' +
        '<span class="mover-lab">' + esc(m.lead.label) + '</span>' +
        '<span class="mover-pct">' + pct(m.lead.probability) + '</span>' +
        '<span class="move ' + dir + '">' + (pts > 0 ? '\u25B2 +' : '\u25BC ') +
        Math.round(pts) + '</span>' +
        '</div>' +
        chartHtml(m.history) +
        '</div>';
    }).join('');

    return '<section class="movers" aria-labelledby="movers-h">' +
      '<div class="section-title"><h2 id="movers-h">Biggest moves this week</h2>' +
      '<span>Change in the leading outcome</span></div>' +
      '<div class="movers-grid">' + items + '</div></section>';
  }

  /* ── filtering, sorting, featuring ──────────────────────────────────────── */

  function filtered() {
    var q = query.toLowerCase();
    var list = markets.filter(function (m) {
      var hay = [m.question, m.category]
        .concat(m.outcomes.map(function (o) { return o.label; }))
        .join(' ').toLowerCase();
      return (category === 'All' || m.category === category) && (!q || hay.indexOf(q) > -1);
    });
    return list.sort(function (a, b) {
      if (sort === 'probability') return b.lead.probability - a.lead.probability;
      if (sort === 'closing') {
        return (a.endDate ? new Date(a.endDate).getTime() : Infinity) -
               (b.endDate ? new Date(b.endDate).getTime() : Infinity);
      }
      return (b.volume || -1) - (a.volume || -1);
    });
  }

  /* What to feature: the soonest market that anyone is actually trading.
     Chosen by what is about to happen rather than by size, because a market
     resolving tomorrow is the one a client opened this page for. The volume
     floor keeps a thin, near-dated curiosity off the top of the page. */
  function pickFeatured(list) {
    if (list.length < 3) return -1;
    var best = -1, bestDays = Infinity;
    var floor = Math.max.apply(null, list.map(function (m) { return m.volume || 0; })) * 0.1;
    list.forEach(function (m, i) {
      var n = daysOut(m.endDate);
      if (n === null || n < 0) return;
      if ((m.volume || 0) < floor) return;
      if (n < bestDays) { bestDays = n; best = i; }
    });
    // Nothing is imminent, so nothing earns the big slot.
    return bestDays <= 45 ? best : -1;
  }

  /* ── chrome ─────────────────────────────────────────────────────────────── */

  /* Categories come from the feed. A fixed list would advertise sections that
     the endpoint never returns, and a permanently disabled chip is a promise
     the page cannot keep. */
  function renderTabs() {
    var present = [];
    markets.forEach(function (m) {
      if (present.indexOf(m.category) === -1) present.push(m.category);
    });
    var all = ['All'].concat(present);
    if (all.indexOf(category) === -1) category = 'All';
    // Rendered as the terminal's own .tabs component, the same control
    // Market Structure uses for its sections, so this page reads as part of
    // the set rather than as something with its own idea of a filter.
    $('category-tabs').innerHTML = all.map(function (c) {
      var on = c === category;
      return '<button type="button" role="tab" data-category="' + esc(c) + '"' +
        ' aria-selected="' + on + '"' + (on ? '' : ' tabindex="-1"') + '>' + esc(c) + '</button>';
    }).join('');
    $('category-tabs').querySelectorAll('button').forEach(function (b) {
      b.addEventListener('click', function () {
        category = b.dataset.category;
        renderTabs();
        render();
      });
    });
  }

  function render() {
    var list = filtered();
    $('result-count').textContent = list.length + ' market' + (list.length === 1 ? '' : 's');

    if (!list.length) {
      $('movers').innerHTML = '';
      $('market-grid').innerHTML = '<div class="odds-state"><strong>' +
        (query ? 'No markets match that search.' : 'No active markets in this category.') +
        '</strong>Try another search or category.</div>';
      return;
    }

    // The movers strip answers a different question from the board, so it is
    // hidden once the reader has narrowed to a category or a search.
    var unfiltered = category === 'All' && !query;
    $('movers').innerHTML = unfiltered ? moversHtml() : '';

    var f = pickFeatured(list);
    $('market-grid').innerHTML = list.map(function (m, i) {
      return i === f ? featuredHtml(m) : cardHtml(m);
    }).join('');
  }

  function status(text, ok) {
    $('feed-status').textContent = text;
    $('pip').className = 'pip ' + (ok ? 'ok' : 'bad');
  }

  function fail() {
    markets = [];
    $('active-count').textContent = '—';
    $('total-volume').textContent = '—';
    $('source-name').textContent = '—';
    $('result-count').textContent = '';
    $('movers').innerHTML = '';
    status('Data temporarily unavailable', false);
    $('market-grid').innerHTML =
      '<div class="odds-state"><strong>Market data is temporarily unavailable.</strong>' +
      'Nothing stale or estimated is shown in its place.' +
      '<br><button id="retry" type="button">Try again</button></div>';
    $('retry').addEventListener('click', load);
  }

  function load() {
    fetch('/api/forecasts', { headers: { accept: 'application/json' } })
      .then(function (r) {
        if (!r.ok) throw new Error('unavailable');
        return r.json();
      })
      .then(function (d) {
        if (!d || !d.available) throw new Error('unavailable');
        markets = flatten(d);
        if (!markets.length) throw new Error('unavailable');
        source = d.source || 'Third-party market';

        var volume = markets.reduce(function (n, m) { return n + (m.volume || 0); }, 0);
        var t = new Date(d.asOf);
        updatedAt = isNaN(t) ? 'Unavailable'
          : t.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

        $('active-count').textContent = markets.length;
        $('total-volume').textContent = volume ? money(volume) : 'Unavailable';
        $('source-name').textContent = source;
        // The pill carries the timestamp, the same as every other page's does.
        status(isNaN(t) ? 'Updated' : 'Updated ' + updatedAt, true);

        renderTabs();
        render();
      })
      .catch(fail);
  }

  $('market-search').addEventListener('input', function (e) {
    query = e.target.value.trim();
    render();
  });
  $('market-sort').addEventListener('change', function (e) {
    sort = e.target.value;
    render();
  });

  load();
  setInterval(load, REFRESH_MS);
})();
