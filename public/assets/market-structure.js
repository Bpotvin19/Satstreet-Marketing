/* Market structure: the Bitcoin network and spot ETF flows, shown as a
   tabbed section at the foot of Markets. It used to be a page of its own
   with a Derivatives tab; the derivatives view is not carried here. */
(function () {
  'use strict';
  var S = window.SATSTREET, $ = function (id) { return document.getElementById(id); };
  var esc = S.esc, fmt = S.fmt;

  var root = $('structure');
  if (!root) return;
  var TABS = ['network', 'institutional'];
  var loaded = {}, current = 'network', inView = false;

  var DISCLOSURE = {
    network:
      '<p><strong>Source.</strong> Bitcoin network figures come from mempool.space and describe the public blockchain. Hashrate is an estimate derived from observed block times and is not directly measurable.</p>' +
      '<p>Fee estimates change continuously and are indicative of conditions at the time shown.</p>',
    institutional:
      '<p><strong>Source.</strong> Spot Bitcoin ETF flow figures come from the public daily tape published by <a href="https://www.tftc.io/bitcoin-etf-flows" target="_blank" rel="noopener noreferrer">TFTC</a>, compiled from SoSoValue and <a href="https://farside.co.uk/btc/" target="_blank" rel="noopener noreferrer">Farside Investors</a>. Satstreet does not originate this series.</p>' +
      '<p><strong>Method.</strong> Daily net flow is creations minus redemptions in USD. A positive print is a net inflow; a negative print is a net outflow. Weekend and holiday sessions are omitted because creations settle on US equity-market days. The latest session can revise as issuers finalize.</p>' +
      '<p>Indicative reference data only \u2014 not a quote, not an offer, and not a statement about future ETF demand or Bitcoin price.</p>'
  };

  function show(name) {
    TABS.forEach(function (t) {
      var sel = t === name;
      var btn = $('tab-' + t);
      if (!btn) return;
      btn.setAttribute('aria-selected', String(sel));
      btn.tabIndex = sel ? 0 : -1;
      var panel = $('p-' + t);
      if (panel) panel.hidden = !sel;
    });
    current = name;
    if (name === 'network' && inView) startFeed(); else stopFeed();
    $('structure-disclosure').innerHTML = DISCLOSURE[name] || '';
    if (!loaded[name]) { loaded[name] = true; (LOAD[name] || function () {})(); }
  }

  var tablist = root.querySelector('.tabs');
  tablist.addEventListener('click', function (e) {
    var b = e.target.closest('button[data-t]');
    if (b) show(b.getAttribute('data-t'));
  });
  tablist.addEventListener('keydown', function (e) {
    var i = TABS.indexOf(document.activeElement.getAttribute('data-t'));
    if (i < 0) return;
    var n = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1
          : e.key === 'Home' ? 0 : e.key === 'End' ? TABS.length - 1 : -1;
    if (n === -1) return;
    e.preventDefault();
    n = (n + TABS.length) % TABS.length;
    show(TABS[n]); $('tab-' + TABS[n]).focus();
  });

  function feeWords(n) {
    if (!isFinite(n)) return '';
    if (n <= 2) return 'minimal congestion';
    if (n <= 10) return 'light congestion';
    if (n <= 40) return 'moderate congestion';
    if (n <= 100) return 'elevated congestion';
    return 'heavy congestion';
  }

  /* mempool.space's own palette runs green to red as the median fee climbs.
     Ours is the terminal's, but the ramp carries the same meaning: how much
     it currently costs to be in the next block. */
  var FEE_BANDS = [
    [2,  '#0f8a63', 'Under 2'],
    [5,  '#3f9a58', '2 to 5'],
    [15, '#a9823c', '5 to 15'],
    [50, '#c2761f', '15 to 50'],
    [1e9,'#c33a49', 'Over 50']
  ];
  function feeTone(rate) {
    var n = Number(rate);
    if (!isFinite(n)) return '#9fb3c4';
    for (var i = 0; i < FEE_BANDS.length; i += 1) if (n < FEE_BANDS[i][0]) return FEE_BANDS[i][1];
    return FEE_BANDS[FEE_BANDS.length - 1][1];
  }
  function satvb(n) {
    var v = Number(n);
    if (!isFinite(v)) return '—';
    return v < 10 ? v.toFixed(1).replace(/\.0$/, '') : String(Math.round(v));
  }
  function mb(vbytes) {
    var v = Number(vbytes);
    return isFinite(v) ? (v / 1e6).toFixed(2) + ' vMB' : '—';
  }
  function txs(n) {
    var v = Number(n);
    return isFinite(v) ? v.toLocaleString('en-US') + ' tx' : '—';
  }

  /* The four tiers mempool.space quotes, plus what is actually queued. */
  function renderFees(fees, pool) {
    if (!fees) { $('net-fees').innerHTML = ''; return; }
    var tiers = [
      ['No priority', fees.economyFee, 'cheapest that still relays'],
      ['Low', fees.hourFee, 'within an hour'],
      ['Medium', fees.halfHourFee, 'within 30 minutes'],
      ['High', fees.fastestFee, 'next block']
    ];
    var queued = pool && isFinite(Number(pool.count))
      ? Number(pool.count).toLocaleString('en-US') + ' transactions waiting · ' + mb(pool.vsize)
      : 'mempool depth unavailable';
    $('net-fees').innerHTML =
      '<header><h2>Fee estimates</h2><span class="eyebrow">' + esc(queued) + '</span></header>' +
      '<div class="feegrid">' + tiers.map(function (t, i) {
        return '<div class="feetier' + (i === 3 ? ' sel' : '') + '">' +
          '<span class="t">' + esc(t[0]) + '</span>' +
          '<span class="r" style="color:' + feeTone(t[1]) + '">' + esc(satvb(t[1])) + '</span>' +
          '<span class="u">sat/vB · ' + esc(t[2]) + '</span></div>';
      }).join('') + '</div>';
  }

  /* Projected blocks to the left of now, mined blocks to the right, which is
     the arrangement mempool.space uses and the reason the picture reads at a
     glance: everything left of the line has not happened yet. */
  function renderStrip(pending, blocks) {
    var left = (pending || []).slice(0, 4).reverse();
    var right = (blocks || []).slice(0, 8);
    if (!left.length && !right.length) { $('net-blocks').innerHTML = ''; return; }

    var pendingHtml = left.map(function (b, i) {
      var eta = (left.length - i) * 10;
      var full = Math.min(100, (Number(b.blockVSize) || 0) / 1e6 * 100);
      return '<div class="blk pending" style="--tone:' + feeTone(b.medianFee) + '">' +
        '<span class="meta">next but ' + (left.length - i - 1) + '</span>' +
        '<span class="fee">' + esc(satvb(b.medianFee)) + ' sat/vB</span>' +
        '<span class="rng">' + esc((b.feeRange || []).length ? satvb(b.feeRange[0]) + '–' + satvb(b.feeRange[b.feeRange.length - 1]) : '—') + '</span>' +
        '<span class="meta">' + esc(txs(b.nTx)) + '</span>' +
        '<span class="meta">~' + eta + ' min</span>' +
        '<span class="fill" style="width:' + full.toFixed(0) + '%"></span></div>';
    }).join('');

    var now = Date.now() / 1000;
    var minedHtml = right.map(function (b) {
      var age = Math.max(0, Math.round((now - (Number(b.timestamp) || now)) / 60));
      var median = b.extras && b.extras.medianFee;
      var pool = b.extras && b.extras.pool && b.extras.pool.name;
      var full = Math.min(100, (Number(b.weight) || 0) / 4e6 * 100);
      return '<div class="blk" style="--tone:' + feeTone(median) + '">' +
        '<a href="https://mempool.space/block/' + esc(b.id) + '" target="_blank" rel="noopener noreferrer">' +
        '<span class="hgt">' + esc(Number(b.height).toLocaleString('en-US')) + '</span></a>' +
        '<span class="fee">' + esc(median != null ? satvb(median) + ' sat/vB' : '—') + '</span>' +
        '<span class="meta">' + esc(txs(b.tx_count)) + '</span>' +
        '<span class="meta">' + esc(age + ' min ago') + '</span>' +
        (pool ? '<span class="meta">' + esc(pool) + '</span>' : '') +
        '<span class="fill" style="width:' + full.toFixed(0) + '%"></span></div>';
    }).join('');

    var legend = FEE_BANDS.map(function (b) {
      return '<span><i style="background:' + b[1] + '"></i>' + esc(b[2]) + '</span>';
    }).join('');

    $('net-blocks').innerHTML =
      '<header><h2>Mempool and recent blocks</h2><span class="eyebrow">median fee, sat/vB</span></header>' +
      '<div class="strip">' + pendingHtml +
      '<div class="now"><span>now</span></div>' + minedHtml + '</div>' +
      '<div class="striplegend">' + legend + '</div>';
  }

  /* The live feed runs only while its own tab is on screen and the browser
     tab is in the foreground. Everywhere else it is torn down, socket and
     all, rather than left spinning behind a hidden panel. */
  var feed = null;
  function feedStats(st) {
    var el = $('feed-stat');
    if (!el) return;
    el.innerHTML = '<span class="dot' + (st.live ? ' on' : '') + '"></span>' +
      (st.live
        ? st.perSecond.toFixed(1) + '/s · ' + st.staged.toLocaleString('en-US') + ' packed · ' +
          (st.vsize / 1e6).toFixed(2) + ' MB' + (st.fills ? ' · ' + st.fills + ' cleared' : '')
        : 'reconnecting…');
  }
  function startFeed() {
    var canvas = $('feed-canvas');
    if (!canvas || !window.SATSTREET_MEMPOOL) return;
    if (!feed) {
      feed = window.SATSTREET_MEMPOOL.create(canvas, feedStats);
      var legend = $('feed-legend');
      if (legend) {
        legend.innerHTML = [['#0f8a63','under 2'],['#3f9a58','2 to 5'],['#a9823c','5 to 15'],
                            ['#c2761f','15 to 50'],['#c33a49','over 50'],['#9fb3c4','fee unknown']]
          .map(function (b) { return '<span><i style="background:' + b[0] + '"></i>' + b[1] + ' sat/vB</span>'; }).join('') +
          (feed.reduced() ? '<span>reduced motion: squares appear without animating</span>' : '');
      }
    }
    feed.start();
  }
  function stopFeed() { if (feed) feed.stop(); }

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) stopFeed();
    else if (inView && current === 'network') startFeed();
  });


  /* ---- Bitcoin Halving Countdown ---- */
  var halvingTimer = null;
  var NEXT_HALVING = 1050000;

  function renderHalving(height) {
    if (halvingTimer) { clearInterval(halvingTimer); halvingTimer = null; }
    var el = $('net-halving');
    if (!el) return;
    height = Number(height);
    if (!isFinite(height) || height <= 0) { el.innerHTML = ''; return; }

    var blocksLeft = Math.max(0, NEXT_HALVING - height);
    var secsLeft = blocksLeft * 600; // 10 min avg per block
    var predictedMs = Date.now() + secsLeft * 1000;
    var predictedDate = new Date(predictedMs);

    function pad(n) { return String(Math.floor(n)).padStart(2, '0'); }

    function tick() {
      var remaining = Math.max(0, predictedMs - Date.now());
      var d = Math.floor(remaining / 86400000);
      var h = Math.floor((remaining % 86400000) / 3600000);
      var m = Math.floor((remaining % 3600000) / 60000);
      var s = Math.floor((remaining % 60000) / 1000);
      var cdEl = $('halving-cd');
      if (cdEl) cdEl.textContent = d + 'd ' + pad(h) + 'h ' + pad(m) + 'm ' + pad(s) + 's';
    }

    var predictedStr = predictedDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    var progressPct = Math.min(100, ((NEXT_HALVING - 210000) === 840000
      ? (height - 840000) / 210000 * 100
      : (210000 - blocksLeft) / 210000 * 100)).toFixed(1);

    el.innerHTML =
      '<header><h2>Next Bitcoin Halving</h2><span class="eyebrow">Block ' + NEXT_HALVING.toLocaleString('en-US') + '</span></header>' +
      '<div class="halving-cd-wrap"><span id="halving-cd" class="halving-cd">—</span><span class="halving-cd-label">estimated time remaining</span></div>' +
      '<div class="dgrid" style="margin-top:14px">' +
        '<div class="dcell"><div class="k">Blocks Remaining</div><div class="v">' + blocksLeft.toLocaleString('en-US') + '</div><div class="s">at ~10 min / block</div></div>' +
        '<div class="dcell"><div class="k">Current Height</div><div class="v">' + height.toLocaleString('en-US') + '</div><div class="s">chain tip</div></div>' +
        '<div class="dcell"><div class="k">Predicted Date</div><div class="v" style="font-size:15px">' + esc(predictedStr) + '</div><div class="s">estimate only</div></div>' +
        '<div class="dcell"><div class="k">Epoch Progress</div><div class="v">' + progressPct + '%</div><div class="s">blocks 840,000 → 1,050,000</div></div>' +
      '</div>' +
      '<div class="halving-bar-wrap"><div class="halving-bar" style="width:' + progressPct + '%"></div></div>' +
      '<div class="venue"><span>Source: mempool.space</span><span>Halving #5 · reward drops to 1.5625 BTC</span></div>';

    tick();
    halvingTimer = setInterval(tick, 1000);
  }

  function loadNetwork() {
    var api = 'https://mempool.space/api/';
    $('net').innerHTML = '<div class="metric">' + S.skeleton(2, 16) + '</div><div class="metric">' + S.skeleton(2, 16) + '</div><div class="metric">' + S.skeleton(2, 16) + '</div><div class="metric">' + S.skeleton(2, 16) + '</div>';
    $('net-extra').innerHTML = S.skeleton(2, 14);
    var get = function (p) {
      return fetch(api + p).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        var ct = r.headers.get('content-type') || '';
        return ct.indexOf('json') > -1 ? r.json() : r.text();
      });
    };
    Promise.all([
      get('v1/mining/hashrate/3d').catch(function () { return null; }),
      get('v1/difficulty-adjustment').catch(function () { return null; }),
      get('v1/fees/recommended').catch(function () { return null; }),
      get('blocks/tip/height').catch(function () { return null; }),
      get('v1/blocks').catch(function () { return null; }),
      get('v1/fees/mempool-blocks').catch(function () { return null; }),
      get('mempool').catch(function () { return null; })
    ]).then(function (r) {
      var hash = r[0], diff = r[1], fees = r[2], height = r[3], blocks = r[4], pending = r[5], pool = r[6];
      if (!hash && !diff && !fees && height === null) throw new Error('network data unavailable');
      var hs = hash && hash.hashrates && hash.hashrates.length ? hash.hashrates[hash.hashrates.length - 1].avgHashrate : NaN;
      var m = function (k, v, s) { return '<div class="metric"><div class="k">' + esc(k) + '</div><div class="v">' + v + '</div><div class="s">' + s + '</div></div>'; };
      $('net').innerHTML =
        m('Hashrate', isFinite(hs) ? (hs / 1e18).toLocaleString('en-US', { maximumFractionDigits: 0 }) + ' EH/s' : '\u2014', 'seven-day average') +
        m('Difficulty', diff && isFinite(diff.difficultyChange) ? (diff.difficultyChange > 0 ? '+' : '') + diff.difficultyChange.toFixed(2) + '%' : '\u2014', diff ? 'estimated change at next retarget' : '') +
        m('Fee estimate', fees ? fees.fastestFee + ' sat/vB' : '\u2014', fees ? esc(feeWords(fees.fastestFee)) : '') +
        m('Block height', height !== null ? Number(height).toLocaleString('en-US') : '\u2014', 'chain tip');
      renderFees(fees, pool);
      renderStrip(pending, blocks);
      renderHalving(height);

      var rows = [];
      if (diff) {
        rows.push(['Difficulty period', Math.round(diff.progressPercent || 0) + '% complete', (diff.remainingBlocks != null ? Number(diff.remainingBlocks).toLocaleString('en-US') + ' blocks remaining' : '')]);
        if (diff.estimatedRetargetDate) rows.push(['Next adjustment', new Date(diff.estimatedRetargetDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), 'estimated']);
      }
      if (fees) rows.push(['Fee range', fees.hourFee + '\u2013' + fees.fastestFee + ' sat/vB', 'within the hour to next block']);
      if (blocks && blocks.length && blocks[0].timestamp) {
        var mins = Math.max(0, Math.round((Date.now() / 1000 - blocks[0].timestamp) / 60));
        rows.push(['Last block', mins + ' min ago', new Date(blocks[0].timestamp * 1000).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })]);
      }
      $('net-extra').innerHTML = '<header><h2>Detail</h2></header><div class="dgrid">' + rows.map(function (x) {
        return '<div class="dcell"><div class="k">' + esc(x[0]) + '</div><div class="v" style="font-size:17px">' + esc(x[1]) + '</div><div class="s">' + esc(x[2]) + '</div></div>';
      }).join('') + '</div><div class="venue"><span>Source: mempool.space</span></div>';
    }).catch(function (e) {
      $('net').innerHTML = '';
      $('net-fees').innerHTML = '';
      $('net-blocks').innerHTML = '';
      $('net-extra').innerHTML = S.errorState('Network data unavailable', e.message, 'retry-n');
      if (halvingTimer) { clearInterval(halvingTimer); halvingTimer = null; }
      var hEl = $('net-halving'); if (hEl) hEl.innerHTML = '';
      var r = $('retry-n'); if (r) r.addEventListener('click', function () { loaded.network = false; show('network'); });
    });
  }

  function money(n) {
    if (n == null || !isFinite(n)) return '\u2014';
    var sign = n < 0 ? '-' : n > 0 ? '+' : '';
    var abs = Math.abs(n);
    var body = abs >= 1e9 ? (abs/1e9).toFixed(2) + 'B' : abs >= 1e6 ? (abs/1e6).toFixed(1) + 'M' : abs >= 1e3 ? (abs/1e3).toFixed(0) + 'K' : abs.toFixed(0);
    return sign + '$' + body;
  }
  function moneyAbs(n) {
    if (n == null || !isFinite(n)) return '\u2014';
    var abs = Math.abs(n);
    var body = abs >= 1e9 ? (abs/1e9).toFixed(2) + 'B' : abs >= 1e6 ? (abs/1e6).toFixed(1) + 'M' : abs >= 1e3 ? (abs/1e3).toFixed(0) + 'K' : abs.toFixed(0);
    return '$' + body;
  }
  function flowBars(days) {
    var vals = days.map(function(d){ return d.flowUsd; }).filter(function(n){ return isFinite(n); });
    var max = Math.max.apply(null, vals.map(Math.abs).concat([1]));
    return '<div class="flowbar" aria-hidden="true">' + days.map(function(d){
      var h = Math.max(3, Math.round(Math.abs(d.flowUsd)/max*62));
      return '<i class="'+(d.flowUsd<0?'out':'')+'" style="height:'+h+'px" title="'+esc(d.date)+' '+money(d.flowUsd)+'"></i>';
    }).join('') + '</div>';
  }
  /* Cumulative net flow since the US spot products launched. The daily bars
     above show how noisy the tape is; this shows where it actually got to,
     including the stretch it spent below zero. */
  function cumulativeChart(days) {
    if (!days || days.length < 5) return '';
    var w = 600, h = 150;
    var run = 0;
    var series = days.map(function (d) { run += Number(d.flowUsd) || 0; return run; });
    var lo = Math.min.apply(null, series.concat([0]));
    var hi = Math.max.apply(null, series.concat([0]));
    if (hi - lo < 1) hi = lo + 1;
    var xOf = function (i) { return (i / (series.length - 1)) * w; };
    var yOf = function (v) { return h - ((v - lo) / (hi - lo)) * h; };

    var line = series.map(function (v, i) {
      return (i ? 'L' : 'M') + xOf(i).toFixed(1) + ' ' + yOf(v).toFixed(1);
    }).join(' ');
    var base = yOf(Math.max(lo, 0)).toFixed(1);
    var area = line + ' L' + w + ' ' + base + ' L0 ' + base + ' Z';

    var peak = series.indexOf(hi);
    var last = series[series.length - 1];
    var zero = yOf(0).toFixed(1);

    return '<svg viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none" role="img" aria-label="Cumulative net flow since launch">' +
      '<defs><linearGradient id="cumg" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0%" stop-color="#27d3a5" stop-opacity=".30"/>' +
      '<stop offset="100%" stop-color="#27d3a5" stop-opacity="0"/></linearGradient></defs>' +
      '<path d="' + area + '" fill="url(#cumg)"/>' +
      (lo < 0 ? '<line x1="0" y1="' + zero + '" x2="' + w + '" y2="' + zero + '" stroke="#c3cedb" stroke-width="1" stroke-dasharray="3 3"/>' : '') +
      '<path d="' + line + '" fill="none" stroke="#17a37d" stroke-width="2" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>' +
      '<circle cx="' + xOf(peak).toFixed(1) + '" cy="' + yOf(hi).toFixed(1) + '" r="3" fill="#17a37d" opacity=".55"/>' +
      '<circle cx="' + xOf(series.length - 1).toFixed(1) + '" cy="' + yOf(last).toFixed(1) + '" r="3.5" fill="#17a37d"/>' +
      '</svg>' +
      '<div class="cumfoot"><span>' + esc(days[0].date) + '</span>' +
      '<span>peak <b>' + money(hi) + '</b> · ' + esc(days[peak].date) + '</span>' +
      '<span>now <b>' + money(last) + '</b></span></div>';
  }

  function loadInstitutional() {
    $('etf-kpis').innerHTML = Array(4).join('x').split('x').map(function(){ return '<div class="metric">'+S.skeleton(2,16)+'</div>'; }).join('');
    $('etf-tape').innerHTML = S.skeleton(4,16);
    $('etf-cumulative').innerHTML = S.skeleton(4,16);
    $('etf-issuers').innerHTML = S.skeleton(4,16);
    $('etf-days').innerHTML = S.skeleton(6,14);
    fetch('/api/etf', { cache: 'no-store' })
      .then(function(r){ return r.json().then(function(j){ if(!r.ok) throw new Error(j.error||('HTTP '+r.status)); return j; }); })
      .then(function(d){
        if (!d.days || !d.days.length) throw new Error(d.error || 'ETF tape returned no sessions');
        var last = d.days[d.days.length-1];
        var five = d.days.slice(-5).reduce(function(s,x){ return s+(x.flowUsd||0); },0);
        var m = function(k,v,sub,cls){
          return '<div class="metric"><div class="k">'+esc(k)+'</div><div class="v '+(cls||'')+'">'+v+'</div><div class="s">'+esc(sub||'')+'</div></div>';
        };
        $('etf-kpis').innerHTML =
          m('Latest session', money(last.flowUsd), last.date + (last.flowUsd>=0?' net inflow':' net outflow'), fmt.dir(last.flowUsd)) +
          m('Five sessions', money(five), 'sum of the last five prints', fmt.dir(five)) +
          m('Cumulative net', money(d.cumulativeUsd), 'since the US spot products launched', fmt.dir(d.cumulativeUsd)) +
          m('Reported AUM', moneyAbs(d.aumUsd), d.listCount ? d.listCount+' listed spot products' : 'issuer-reported assets');
        var recent = d.days.slice(-24);
        $('etf-tape').innerHTML = '<header><h2>Daily net flow</h2><span class="eyebrow">USD creations minus redemptions</span></header>' +
          flowBars(recent) +
          '<div class="venue"><span>Source: '+esc(d.source||'TFTC')+'</span><span>'+esc(recent[0].date)+' \u2192 '+esc(recent[recent.length-1].date)+'</span></div>';
        $('etf-cumulative').innerHTML =
          '<header><h2>Cumulative net flow</h2><span class="eyebrow">since launch · ' + d.days.length + ' sessions</span></header>' +
          cumulativeChart(d.days);

        var issuers = (d.issuers||[]).slice(0,8);
        $('etf-issuers').innerHTML = '<header><h2>Latest session by fund</h2><span class="eyebrow">Same-day prints</span></header>' +
          (issuers.length? issuers.map(function(x){
            var print = x.lastFlowUsd != null ? x.lastFlowUsd : x.aumUsd;
            var peak = Math.max.apply(null, issuers.map(function(y){
              var v = y.lastFlowUsd != null ? y.lastFlowUsd : y.aumUsd; return Math.abs(Number(v)||0);
            }).concat([1]));
            var w = Math.round(Math.abs(Number(print)||0)/peak*100);
            return '<div class="issuer"><div><strong>'+esc(x.ticker)+'</strong><div class="s">'+esc(x.name||'')+'</div></div>' +
              '<div style="text-align:right"><div class="v" style="font-size:16px">'+money(print)+'</div></div>' +
              '<span class="mag'+(Number(print)<0?' out':'')+'" style="width:'+w+'%"></span></div>';
          }).join('') : '<p class="ctx">Per-fund prints were not included in this refresh.</p>') +
          '';
        var rows = d.days.slice(-12).reverse();
        $('etf-days').innerHTML = '<header><h2>Recent sessions</h2><span class="eyebrow">Largest named prints on the tape</span></header>' +
          '<div style="overflow-x:auto"><table class="etf-table"><thead><tr><th>Session</th><th>Net flow</th><th>Lead inflow</th><th>Lead outflow</th></tr></thead><tbody>' +
          rows.map(function(day){
            return '<tr><td>'+esc(day.date)+'</td><td class="'+fmt.dir(day.flowUsd)+'">'+money(day.flowUsd)+'</td><td>'+esc(day.leadIn || '\u2014')+'</td><td>'+esc(day.leadOut || '\u2014')+'</td></tr>';
          }).join('') + '</tbody></table></div>' +
          '<div class="venue"><a href="'+(d.sourceUrl||'https://www.tftc.io/bitcoin-etf-flows')+'" target="_blank" rel="noopener noreferrer">Open source tape \u2197</a></div>';
      })
      .catch(function(e){
        $('etf-kpis').innerHTML = '';
        $('etf-tape').innerHTML = S.errorState('ETF flow data unavailable', e.message, 'retry-i');
        $('etf-cumulative').innerHTML = '';
        $('etf-issuers').innerHTML = '';
        $('etf-days').innerHTML = '';
        var r = $('retry-i'); if (r) r.addEventListener('click', function(){ loaded.institutional=false; show('institutional'); });
      });
  }

  var LOAD = { institutional: loadInstitutional, network: loadNetwork };

  /* Nothing loads, and the mempool socket stays closed, until the reader
     scrolls down to the section. Leaving it again stops the live feed. */
  $('structure-disclosure').innerHTML = DISCLOSURE.network;
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (entries) {
      inView = entries[0].isIntersecting;
      if (inView) {
        if (!loaded[current]) show(current);
        else if (current === 'network' && !document.hidden) startFeed();
      } else {
        stopFeed();
      }
    }, { rootMargin: '300px 0px' }).observe(root);
  } else {
    inView = true;
    show('network');
  }
})();
