/* Client terminal themes: applies the saved theme before the page paints, and adds a
   "Theme" menu to the top bar. The choice is stored on this device only (localStorage). */
(function () {
  var KEY = 'satstreet.theme.v1';
  var THEMES = [
    { id: 'classic', name: 'Classic', note: 'The original light terminal' },
    { id: 'horizon', name: 'Horizon', note: 'Night sky up top, daylight below' },
    { id: 'night', name: 'Night', note: 'Dark, in the style of our videos' },
    { id: 'desk', name: 'Desk', note: 'Charcoal and serif, trading-desk feel' }
  ];
  var FONTS = {
    horizon: 'https://fonts.googleapis.com/css2?family=Source+Sans+3:wght@400;600;700&display=swap',
    night: 'https://fonts.googleapis.com/css2?family=Source+Sans+3:wght@400;600;700&display=swap',
    desk: 'https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600&family=Instrument+Serif&display=swap'
  };
  var root = document.documentElement, MKEY = 'satstreet.motion.v1';
  var themeSrc = document.currentScript && document.currentScript.src;
  function motionOn() { try { return localStorage.getItem(MKEY) !== 'off'; } catch (e) { return true; } }
  function applyMotion(on) { root.setAttribute('data-motion', on ? 'on' : 'off'); }
  applyMotion(motionOn());
  /* Cursor trail: desktop mouse only, and never when the visitor prefers reduced motion. */
  function loadTrail() {
    if (window.__ssTrail || !window.matchMedia || !matchMedia('(pointer:fine)').matches || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    window.__ssTrail = true; var sc = document.createElement('script'); sc.src = (themeSrc || './assets/theme.js').replace(/theme\.js.*$/, 'cursor-trail.js'); document.head.appendChild(sc);
  }

  function saved() { try { var t = localStorage.getItem(KEY); return THEMES.some(function (x) { return x.id === t; }) ? t : 'classic'; } catch (e) { return 'classic'; } }
  function loadFonts(id) {
    var href = FONTS[id]; if (!href || document.querySelector('link[data-theme-font="' + id + '"]')) return;
    var l = document.createElement('link'); l.rel = 'stylesheet'; l.href = href; l.setAttribute('data-theme-font', id); document.head.appendChild(l);
  }
  function apply(id) {
    if (id === 'classic') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', id);
    loadFonts(id);
    var meta = document.querySelector('meta[name="theme-color"]'); if (meta) meta.setAttribute('content', id === 'desk' ? '#111214' : id === 'classic' ? '#0d1b2e' : '#000000');
  }
  function choose(id) {
    try { localStorage.setItem(KEY, id); } catch (e) {}
    apply(id);
    /* Charts redraw on resize; nudge them so they pick up the new colours. */
    window.dispatchEvent(new Event('resize'));
    window.dispatchEvent(new CustomEvent('ss-themechange', { detail: id }));
    sync();
  }
  apply(saved());

  var menu, btn;
  function sync() {
    if (!menu) return; var cur = saved();
    menu.querySelectorAll('.ss-theme-opt').forEach(function (o) { o.setAttribute('aria-checked', String(o.dataset.theme === cur)); });
  }
  function close() { if (menu && !menu.hidden) { menu.hidden = true; btn.setAttribute('aria-expanded', 'false'); } }
  function mount() {
    var bar = document.querySelector('.topbar-in'); if (!bar || bar.querySelector('.ss-theme')) return !!bar;
    var wrap = document.createElement('div'); wrap.className = 'ss-theme';
    wrap.innerHTML = '<button type="button" class="ss-theme-btn" aria-haspopup="true" aria-expanded="false" aria-label="Change theme">' +
      '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M8 1.8a6.2 6.2 0 0 1 0 12.4z" fill="currentColor"/></svg><span>Theme</span></button>' +
      '<div class="ss-theme-menu" role="menu" aria-label="Theme" hidden><p>Theme</p>' +
      THEMES.map(function (t) {
        return '<button type="button" class="ss-theme-opt" role="menuitemradio" data-theme="' + t.id + '"><span class="ss-theme-sw ss-sw-' + t.id + '"><i></i></span>' +
          '<span>' + t.name + '<small>' + t.note + '</small></span></button>';
      }).join('') + '<div class="ss-motion"><span>Motion<small>Cursor trail and moving borders</small></span><button type="button" class="ss-switch" role="switch" aria-label="Motion effects"></button></div></div>';
    var spacer = bar.querySelector('.spacer');
    if (spacer && spacer.nextSibling) bar.insertBefore(wrap, spacer.nextSibling); else bar.appendChild(wrap);
    btn = wrap.querySelector('.ss-theme-btn'); menu = wrap.querySelector('.ss-theme-menu');
    btn.addEventListener('click', function (e) { e.stopPropagation(); var open = menu.hidden; menu.hidden = !open; btn.setAttribute('aria-expanded', String(open)); if (open) { var c = menu.querySelector('[aria-checked="true"]'); if (c) c.focus(); } });
    menu.addEventListener('click', function (e) { var o = e.target.closest('.ss-theme-opt'); if (!o) return; choose(o.dataset.theme); close(); btn.focus(); });
    menu.addEventListener('keydown', function (e) {
      var opts = [].slice.call(menu.querySelectorAll('.ss-theme-opt')), i = opts.indexOf(document.activeElement);
      if (e.key === 'ArrowDown') { e.preventDefault(); opts[(i + 1) % opts.length].focus(); }
      if (e.key === 'ArrowUp') { e.preventDefault(); opts[(i - 1 + opts.length) % opts.length].focus(); }
    });
    document.addEventListener('click', function (e) { if (!wrap.contains(e.target)) close(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { close(); } });
    var sw = wrap.querySelector('.ss-switch');
    sw.setAttribute('aria-checked', String(motionOn()));
    sw.addEventListener('click', function (e) { e.stopPropagation(); var on = !motionOn(); try { localStorage.setItem(MKEY, on ? 'on' : 'off'); } catch (x) {} applyMotion(on); sw.setAttribute('aria-checked', String(on)); if (on) loadTrail(); });
    sync(); return true;
  }
  /* The top bar is either in the page (Overview) or drawn by terminal.js, so wait for it. */
  function tryMount() { if (mount()) return; var n = 0, iv = setInterval(function () { if (mount() || ++n > 40) clearInterval(iv); }, 100); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', tryMount); else tryMount();
  if (motionOn()) { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', loadTrail); else loadTrail(); }
  window.SSTheme = { list: THEMES.map(function (t) { return t.id; }), get: saved, set: choose };
})();
