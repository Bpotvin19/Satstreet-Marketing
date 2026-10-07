/* Icons for any market symbol on the Overview: the board, the Customize
   list and the search results all ask here, so a ticker looks the same
   everywhere.

     crypto (XRP-USD)       the coin's logo
     stocks / ETFs (IBIT)   the company or fund issuer's logo
     FX (EURUSD=X, CAD=X)   the two currencies' flags
     indices (^DJI)         the flag of the index's country
     futures (SI=F)         an icon for the commodity
     yields (^TNX)          a bond icon

   Logos are fetched from public logo services with a second source as
   backup; if neither has one, the icon falls back to initials rather than
   a broken image. The Overview registers its own icons for the default
   board, and those win wherever that symbol appears. */
(function () {
  'use strict';

  var registered = {};

  var FX = {
    USD: 'us', CAD: 'ca', EUR: 'eu', GBP: 'gb', JPY: 'jp', CHF: 'ch', AUD: 'au', NZD: 'nz', CNY: 'cn', CNH: 'cn',
    HKD: 'hk', SGD: 'sg', MXN: 'mx', BRL: 'br', INR: 'in', KRW: 'kr', SEK: 'se', NOK: 'no', DKK: 'dk', ZAR: 'za',
    TRY: 'tr', PLN: 'pl', ILS: 'il', AED: 'ae', SAR: 'sa', THB: 'th', IDR: 'id', PHP: 'ph', TWD: 'tw', CZK: 'cz',
    HUF: 'hu', CLP: 'cl', COP: 'co', ARS: 'ar', NGN: 'ng', EGP: 'eg', MYR: 'my', VND: 'vn', PEN: 'pe', RUB: 'ru'
  };
  var INDEX = {
    '^GSPC': 'us', '^IXIC': 'us', '^DJI': 'us', '^RUT': 'us', '^VIX': 'us', '^NDX': 'us', '^NYA': 'us', '^SOX': 'us',
    '^GSPTSE': 'ca', '^FTSE': 'gb', '^GDAXI': 'de', '^FCHI': 'fr', '^N225': 'jp', '^HSI': 'hk', '^STOXX50E': 'eu',
    '^AXJO': 'au', '^KS11': 'kr', '^BSESN': 'in', '^NSEI': 'in', '^BVSP': 'br', '^MXX': 'mx', '^SSMI': 'ch',
    '^IBEX': 'es', '^AEX': 'nl', '000001.SS': 'cn', '^TWII': 'tw', '^STI': 'sg'
  };

  /* Futures roots → [colour class, svg path]. */
  var BAR = '<path d="m6 9 2-4h8l2 4M5 10h14l2 8H3l2-8Z"/><path d="M8 14h8"/>';
  var DROP = '<path d="M12 3c3 4 6 7.3 6 11a6 6 0 1 1-12 0c0-3.7 3-7 6-11Z"/><path d="M9 16c.7 1 1.7 1.5 3 1.5"/>';
  var FLAME = '<path d="M12 3c1 3 5 5.2 5 10a5 5 0 0 1-10 0c0-2.6 1.4-4 2.5-5.5.4 1.6 1.2 2.5 2 2.8C11.2 8 11 5.6 12 3Z"/>';
  var GRAIN = '<path d="M12 21V9"/><path d="M12 9c-2-1-3-3-3-5 2 0 3 2 3 5Zm0 0c2-1 3-3 3-5-2 0-3 2-3 5Zm0 4c-2-1-3.5-2.6-3.5-4.6 2 0 3.5 1.8 3.5 4.6Zm0 0c2-1 3.5-2.6 3.5-4.6-2 0-3.5 1.8-3.5 4.6Zm0 4c-2-1-3.5-2.6-3.5-4.6 2 0 3.5 1.8 3.5 4.6Zm0 0c2-1 3.5-2.6 3.5-4.6-2 0-3.5 1.8-3.5 4.6Z"/>';
  var CUP = '<path d="M5 9h11v5a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5V9Z"/><path d="M16 11h1.5a2.5 2.5 0 0 1 0 5H16M8 3c0 1.5 1 1.5 1 3M12 3c0 1.5 1 1.5 1 3"/>';
  var LINE = '<path d="m4 16 4-4 3 2 5-6 4 2"/><path d="M4 20h16"/>';
  var BOND = '<path d="M4 9h16M6 9v8m4-8v8m4-8v8m4-8v8M3 18h18M12 3l9 4H3l9-4Z"/>';
  var COW = '<path d="M6 8c-2 0-3-1.5-3-3 1.5 0 3 .5 4 2M18 8c2 0 3-1.5 3-3-1.5 0-3 .5-4 2"/><path d="M7 7h10v6a5 5 0 0 1-10 0V7Z"/><path d="M10 15h4"/>';
  var FUT = {
    GC: ['gold', BAR], MGC: ['gold', BAR], SI: ['silver', BAR], SIL: ['silver', BAR], PL: ['platinum', BAR], PA: ['platinum', BAR],
    HG: ['copper', BAR], ALI: ['silver', BAR],
    CL: ['oil', DROP], MCL: ['oil', DROP], BZ: ['oil', DROP], RB: ['oil', DROP], HO: ['oil', DROP],
    NG: ['gas', FLAME],
    ZC: ['grain', GRAIN], ZW: ['grain', GRAIN], ZS: ['grain', GRAIN], ZO: ['grain', GRAIN], KE: ['grain', GRAIN],
    KC: ['coffee', CUP], CC: ['coffee', CUP], SB: ['grain', GRAIN], CT: ['grain', GRAIN], OJ: ['grain', DROP],
    LE: ['cattle', COW], HE: ['cattle', COW], GF: ['cattle', COW],
    ES: ['index', LINE], NQ: ['index', LINE], YM: ['index', LINE], RTY: ['index', LINE], MES: ['index', LINE], MNQ: ['index', LINE],
    ZN: ['bond', BOND], ZB: ['bond', BOND], ZF: ['bond', BOND], ZT: ['bond', BOND], UB: ['bond', BOND],
    BTC: ['btc', null], MBT: ['btc', null], ETH: ['eth', null], MET: ['eth', null]
  };
  var YIELDS = { '^TNX': 1, '^TYX': 1, '^FVX': 1, '^IRX': 1 };

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function svg(path) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + path + '</svg>';
  }
  function flag(code, cls) {
    return '<img class="' + (cls || '') + '" src="https://flagcdn.com/w80/' + code + '.png" alt="" loading="lazy" referrerpolicy="no-referrer">';
  }

  function kind(symbol) {
    if (/-USD$/.test(symbol)) return 'crypto';
    if (/=X$/.test(symbol)) return 'fx';
    if (/=F$/.test(symbol)) return 'future';
    if (YIELDS[symbol]) return 'yield';
    if (symbol.charAt(0) === '^' || INDEX[symbol]) return 'index';
    return 'stock';
  }

  function initials(symbol, label) {
    var base = symbol.replace('-USD', '').replace(/^\^/, '').replace(/=.*/, '').replace(/\..*/, '');
    return (base || label || '?').slice(0, 4).toUpperCase();
  }

  /* <img> that walks a list of sources, then gives way to the initials. */
  function chain(srcs) {
    return '<img src="' + esc(srcs[0]) + '" data-next="' + esc(srcs.slice(1).join('|')) + '" alt="" loading="lazy" ' +
      'referrerpolicy="no-referrer" onerror="SSIcons.next(this)">';
  }

  function html(symbol, opts) {
    opts = opts || {};
    var cls = opts.cls || '';
    if (registered[symbol]) return registered[symbol](cls);
    var k = kind(symbol), ini = initials(symbol, opts.label), body = '', extra = '';

    if (k === 'crypto') {
      var c = symbol.replace('-USD', '').toLowerCase();
      body = chain([
        'https://assets.coincap.io/assets/icons/' + c + '@2x.png',
        'https://cdn.jsdelivr.net/gh/spothq/cryptocurrency-icons@master/128/color/' + c + '.png'
      ]);
      extra = 'ss-ic-logo';
    } else if (k === 'stock') {
      body = chain([
        'https://assets.parqet.com/logos/symbol/' + encodeURIComponent(symbol) + '?format=png',
        'https://financialmodelingprep.com/image-stock/' + encodeURIComponent(symbol) + '.png'
      ]);
      extra = 'ss-ic-logo';
    } else if (k === 'fx') {
      var pair = symbol.replace('=X', '');
      var base = pair.length === 6 ? pair.slice(0, 3) : 'USD', quote = pair.length === 6 ? pair.slice(3) : pair;
      if (FX[base] && FX[quote]) { body = flag(FX[base], 'f1') + flag(FX[quote], 'f2'); extra = 'ss-ic-fx'; }
    } else if (k === 'index') {
      if (INDEX[symbol]) { body = flag(INDEX[symbol], 'f0'); extra = 'ss-ic-flag'; }
      else { body = svg(LINE); extra = 'ss-ic-index'; }
    } else if (k === 'yield') {
      body = svg(BOND); extra = 'ss-ic-bond';
    } else if (k === 'future') {
      var root = symbol.replace('=F', '');
      var f = FUT[root];
      if (f && f[0] === 'btc') {
        body = chain(['https://assets.coincap.io/assets/icons/btc@2x.png']); extra = 'ss-ic-logo';
      } else if (f && f[0] === 'eth') {
        body = chain(['https://assets.coincap.io/assets/icons/eth@2x.png']); extra = 'ss-ic-logo';
      } else if (f) {
        body = svg(f[1]); extra = 'ss-ic-' + f[0];
      } else {
        body = svg(LINE); extra = 'ss-ic-index';
      }
    }
    return '<span class="ss-ic ' + extra + ' ' + cls + (body ? '' : ' fallback') + '" aria-hidden="true">' + body +
      '<i>' + esc(ini) + '</i></span>';
  }

  window.SSIcons = {
    html: html,
    kind: kind,
    register: function (symbol, fn) { registered[symbol] = fn; },
    next: function (img) {
      var rest = (img.getAttribute('data-next') || '').split('|').filter(Boolean);
      if (rest.length) {
        img.setAttribute('data-next', rest.slice(1).join('|'));
        img.src = rest[0];
      } else {
        var box = img.parentNode;
        img.remove();
        if (box && box.classList) box.classList.add('fallback');
      }
    }
  };
})();
