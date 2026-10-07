/* News.

   Renders whatever /api/news returns. The endpoint has already dropped any
   item without a headline or a link, and any link pointing somewhere other
   than decrypt.co, so this file's job is presentation: group the sections
   into filters, format the clock, and open stories in the reader panel.

   No item is scored, ranked or reordered. The feed's order is Decrypt's
   order and it stays that way, because the moment this page decided which
   story mattered most it would be publishing a view rather than a feed. */
(function () {
  'use strict';
  var S = window.SATSTREET, $ = function (id) { return document.getElementById(id); };
  var esc = S.esc;
  S.mountHeader('News');

  /* S.esc leaves quotes alone, which is fine for text between tags and not
     fine inside an attribute. Anything interpolated into href or src goes
     through this instead. */
  function escAttr(s) {
    return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;')
      .replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  var REFRESH_MS = 5 * 60 * 1000;
  var items = [], section = 'All', timer = null, lastAt = null;

  /* "4 min ago" while that is still the useful unit, then the hour, then the
     date. A story from last Tuesday does not need its age counted in hours. */
  function ago(iso) {
    if (!iso) return '';
    var then = new Date(iso).getTime();
    if (!isFinite(then)) return '';
    var mins = Math.floor((Date.now() - then) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return mins + ' min ago';
    var hrs = Math.floor(mins / 60);
    if (hrs < 24) return hrs + (hrs === 1 ? ' hour ago' : ' hours ago');
    var days = Math.floor(hrs / 24);
    if (days === 1) return 'Yesterday';
    if (days < 7) return days + ' days ago';
    return new Date(then).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  function stamp(state) {
    var pip = $('pip'), label = $('feed-status');
    if (!pip || !label) return;
    if (state === 'error') { pip.className = 'pip bad'; label.textContent = 'Unavailable'; return; }
    if (!lastAt) { pip.className = 'pip'; label.textContent = 'Loading…'; return; }
    var st = S.staleness(lastAt);
    pip.className = 'pip ' + (st.stale ? 'warn' : 'ok');
    label.innerHTML = st.stale
      ? '<span class="stale">Feed ' + st.minutes + ' min old</span>'
      : 'Updated ' + S.fmt.time(lastAt);
  }

  function story(n) {
    var when = ago(n.publishedAt);
    return '<article class="story">' +
      (n.image ? '<a href="' + escAttr(n.link) + '" target="_blank" rel="noopener noreferrer">' +
        '<img class="thumb" src="' + escAttr(n.image) + '" alt="" loading="lazy" ' +
        'referrerpolicy="no-referrer" decoding="async" /></a>' : '') +
      '<div class="in">' +
      '<div class="meta">' +
        (when ? '<span class="ago">' + esc(when) + '</span>' : '') +
        (n.section ? '<span class="chip">' + esc(n.section) + '</span>' : '') +
      '</div>' +
      '<h3><a href="' + escAttr(n.link) + '" target="_blank" rel="noopener noreferrer">' +
        esc(n.title) + '</a></h3>' +
      (n.summary ? '<p>' + esc(n.summary) + '</p>' : '') +
      /* The byline only, and only when the feed carries one. The source is
         named once, in the disclosure at the foot of the page, rather than
         stamped on every card. */
      (n.author ? '<div class="by"><span>' + esc(n.author) + '</span></div>' : '') +
      '</div></article>';
  }

  function renderFilters() {
    var box = $('news-filters');
    if (!box) return;
    var seen = {}, order = [];
    items.forEach(function (n) {
      if (n.section && !seen[n.section]) { seen[n.section] = true; order.push(n.section); }
    });
    /* One section is not a filter, it is a label for everything on screen. */
    if (order.length < 2) { box.innerHTML = ''; return; }
    box.innerHTML = ['All'].concat(order).map(function (s) {
      return '<button type="button" data-s="' + escAttr(s) + '" aria-pressed="' +
        (s === section ? 'true' : 'false') + '">' + esc(s) + '</button>';
    }).join('');
  }

  function renderGrid() {
    var grid = $('news-grid');
    if (!grid) return;
    var show = section === 'All' ? items : items.filter(function (n) { return n.section === section; });
    if (!show.length) {
      grid.innerHTML = '<p class="emptybox">Nothing filed under ' + esc(section) + ' in the current feed.</p>';
      return;
    }
    grid.innerHTML = show.map(story).join('');
  }

  function load() {
    fetch('/api/news', { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (d) {
        if (d.error || !d.items || !d.items.length) {
          throw new Error(d.error || 'the feed returned nothing');
        }
        items = d.items;
        lastAt = new Date(d.asOf).getTime();
        /* A section that vanished from the feed since the last refresh must
           not leave the page filtered to an empty set. */
        if (section !== 'All' && !items.some(function (n) { return n.section === section; })) {
          section = 'All';
        }
        renderFilters();
        renderGrid();
        stamp();
      })
      .catch(function (e) {
        var grid = $('news-grid');
        if (grid) {
          grid.innerHTML = S.errorState('News unavailable',
            'The news feed could not be read (' + e.message + ').', 'retry-news');
        }
        var f = $('news-filters'); if (f) f.innerHTML = '';
        stamp('error');
        var r = $('retry-news');
        if (r) r.addEventListener('click', function () { load(); });
      });
  }

  var filters = $('news-filters');
  if (filters) {
    filters.addEventListener('click', function (e) {
      var b = e.target.closest('button[data-s]');
      if (!b) return;
      section = b.getAttribute('data-s');
      Array.prototype.forEach.call(this.querySelectorAll('button'), function (o) {
        o.setAttribute('aria-pressed', String(o === b));
      });
      renderGrid();
    });
  }

  /* Refresh on a timer, but only while the tab is actually being looked at.
     A backgrounded terminal polling a news feed all afternoon is just noise
     on someone else's origin. */
  function startTimer() { if (!timer) timer = setInterval(load, REFRESH_MS); }
  function stopTimer() { if (timer) { clearInterval(timer); timer = null; } }

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) { stopTimer(); return; }
    startTimer();
    /* Re-clock the "4 min ago" labels, which went stale while hidden. */
    if (lastAt && Date.now() - lastAt > 60000) load(); else renderGrid();
  });

  /* ── reader panel ─────────────────────────────────────────────
     A story opens Decrypt's own article page in a frame on this page. Only
     decrypt.co is ever framed. Cmd/Ctrl-click still opens a new tab, and a
     link here (news.html#read=…) opens straight into the reader, which is
     how the Overview card's headlines arrive. */
  var reader = $('reader'), lastFocus = null;
  function allowed(url) {
    try { var u = new URL(url); return u.protocol === 'https:' && /(^|\.)decrypt\.co$/i.test(u.hostname); }
    catch (e) { return false; }
  }
  function openReader(url, title, push) {
    if (!reader || !allowed(url)) return false;
    lastFocus = document.activeElement;
    $('reader-title').textContent = title || 'Decrypt';
    $('reader-out').href = url;
    $('reader-body').innerHTML = '<div class="reader-loading">Loading article from Decrypt…</div>';
    var f = document.createElement('iframe');
    f.title = title || 'Article from Decrypt';
    f.onload = function () { var l = $('reader-body').querySelector('.reader-loading'); if (l) l.remove(); };
    f.src = url;
    $('reader-body').appendChild(f);
    reader.hidden = false;
    document.body.classList.add('reading');
    $('reader-close').focus();
    if (push) history.pushState({ read: url }, '', '#read=' + encodeURIComponent(url));
    return true;
  }
  function closeReader(fromHistory) {
    if (!reader || reader.hidden) return;
    reader.hidden = true;
    $('reader-body').innerHTML = '';
    document.body.classList.remove('reading');
    if (!fromHistory && /^#read=/.test(location.hash)) {
      if (history.state && history.state.read) history.back();
      else history.replaceState(null, '', location.pathname + location.search);
    }
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  function fromHash() {
    var m = /^#read=(.+)$/.exec(location.hash);
    if (!m) { closeReader(true); return; }
    var url = decodeURIComponent(m[1]);
    var hit = items.filter(function (n) { return n.link === url; })[0];
    if (reader.hidden || $('reader-out').href !== url) openReader(url, hit ? hit.title : '', false);
  }

  document.addEventListener('click', function (e) {
    var a = e.target.closest('#news-grid a[href]');
    if (!a || e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return;
    var card = a.closest('.story'), h = card && card.querySelector('h3');
    if (openReader(a.href, h ? h.textContent : '', true)) e.preventDefault();
  });
  if (reader) {
    $('reader-close').addEventListener('click', function () { closeReader(false); });
    reader.addEventListener('click', function (e) { if (e.target === reader) closeReader(false); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeReader(false); });
    window.addEventListener('popstate', fromHash);
  }

  load();
  startTimer();
  if (/^#read=/.test(location.hash)) fromHash();
})();
