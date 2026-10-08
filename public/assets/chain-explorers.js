/* Ethereum, Solana and the XRP Ledger on the Explorer page.

   Works the same way as the Bitcoin explorer (explorer.js): search, a
   network overview with recent blocks, and block / transaction / address
   pages rendered right here, with nothing handed off to another site.

   Ethereum reads Blockscout's public API, which indexes the chain and so
   can answer address history. Solana reads a public RPC node directly.

   Routes live in the query string: ?chain=eth&view=tx&id=0x…  Nothing loads
   until its tab is opened. */
(function () {
  'use strict';

  var S = window.SATSTREET;
  var $ = function (id) { return document.getElementById(id); };
  var esc = S.esc;

  var BLOCKSCOUT = 'https://eth.blockscout.com/api/v2/';
  var SOL_RPC = 'https://solana-rpc.publicnode.com';
  var UNAVAILABLE = 'Network data temporarily unavailable.';

  /* ── formatting ──────────────────────────────────────────────────── */
  function attr(v) { return esc(v).replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
  function short(v, a, b) {
    v = String(v || '');
    a = a || 10; b = b || 8;
    return v.length <= a + b + 3 ? v : v.slice(0, a) + '…' + v.slice(-b);
  }
  function trunc(v, n) { v = String(v || ''); return v.length > n ? v.slice(0, n) + '…' : v; }
  function num(v) {
    return v === null || v === undefined || v === '' || !isFinite(Number(v)) ? '—' : Number(v).toLocaleString('en-US');
  }
  function secsOf(t) {
    if (t === null || t === undefined) return null;
    return typeof t === 'number' ? t : Math.floor(new Date(t).getTime() / 1000);
  }
  function age(t) {
    var sec = secsOf(t);
    if (!sec) return '—';
    var s = Math.max(0, Math.floor(Date.now() / 1000 - sec));
    if (s < 60) return s + ' sec ago';
    var m = Math.floor(s / 60);
    if (m < 60) return m + ' min ago';
    var h = Math.floor(m / 60);
    if (h < 24) return h + ' hr ago';
    var d = Math.floor(h / 24);
    return d + ' day' + (d === 1 ? '' : 's') + ' ago';
  }
  function when(t) {
    var sec = secsOf(t);
    if (!sec) return '—';
    return new Date(sec * 1000).toLocaleString('en-CA', {
      year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit'
    });
  }
  /* Integer string in base units → decimal string, exact (BigInt), trimmed. */
  function units(raw, decimals, maxFrac) {
    if (raw === null || raw === undefined || raw === '') return null;
    var neg = false, s = String(raw);
    if (s.charAt(0) === '-') { neg = true; s = s.slice(1); }
    if (!/^\d+$/.test(s)) return null;
    decimals = Number(decimals) || 0;
    var big = BigInt(s), base = BigInt(10) ** BigInt(decimals);
    var whole = big / base, frac = (big % base).toString().padStart(decimals, '0');
    if (maxFrac !== undefined) frac = frac.slice(0, maxFrac);
    frac = frac.replace(/0+$/, '');
    var w = whole.toLocaleString('en-US');
    return (neg ? '-' : '') + w + (frac ? '.' + frac : '');
  }
  function eth(wei, maxFrac) { var v = units(wei, 18, maxFrac === undefined ? 8 : maxFrac); return v === null ? '—' : v + ' ETH'; }
  function gwei(wei) {
    if (wei === null || wei === undefined || wei === '') return '—';
    var g = Number(wei) / 1e9;
    return (g < 10 ? g.toFixed(3) : g.toFixed(1)) + ' gwei';
  }
  function sol(lamports, signed) {
    if (lamports === null || lamports === undefined || !isFinite(Number(lamports))) return '—';
    var v = units(String(lamports), 9, 9);
    return (signed && Number(lamports) > 0 ? '+' : '') + v + ' SOL';
  }

  /* ── shared page pieces (same classes as the Bitcoin explorer) ───── */
  function link(chain, view, id, label, cls) {
    return '<a class="' + (cls || '') + '" data-xroute="1" href="./explorer.html?chain=' + chain + '&view=' +
      encodeURIComponent(view) + '&id=' + encodeURIComponent(id) + '">' + esc(label) + '</a>';
  }
  function hashLine(v) {
    if (!v) return '—';
    return '<span class="hash-line"><span class="hash-value" title="' + attr(v) + '">' + esc(short(v, 12, 10)) +
      '</span><button class="copy-button" type="button" data-copy="' + encodeURIComponent(v) +
      '" aria-label="Copy ' + attr(short(v, 8, 6)) + '">Copy</button></span>';
  }
  function field(label, value) {
    return '<div class="detail-field"><div class="k">' + esc(label) + '</div><div class="v">' + value + '</div></div>';
  }
  function metric(k, v, s) {
    return '<div class="metric"><div class="k">' + esc(k) + '</div><div class="v">' + esc(v) +
      '</div><div class="s">' + esc(s || '') + '</div></div>';
  }
  function badge(ok, label) {
    return '<span class="status-badge ' + (ok ? 'confirmed' : 'failed') + '">' + esc(label) + '</span>';
  }
  function backLink(chain) {
    return '<a class="back-link" data-xhome="' + chain + '" href="./explorer.html?chain=' + chain + '">← Explorer overview</a>';
  }
  function moreButton(id, label) {
    return '<div class="pagination"><span></span><button class="btn ghost small" type="button" id="' + id + '">' + esc(label || 'Show more') + '</button><span></span></div>';
  }
  /* Asset movements: logo, amount and what it is on the left, where it went
     on the right. Used for token transfers, native ETH/SOL moves, balance
     changes and holdings. */
  var ETH_LOGO = 'https://coin-images.coingecko.com/coins/images/279/small/ethereum.png';
  var SOL_LOGO = 'https://coin-images.coingecko.com/coins/images/4128/small/solana.png';
  /* Resolved from this script's own URL so it also works inside the Webflow embed. */
  var ASSET_BASE = (document.currentScript && document.currentScript.src || '').replace(/[^\/]*$/, '') || './assets/';
  var XRP_LOGO = ASSET_BASE + 'coins/xrp.svg';
  function logo(url, label) {
    var words = String(label || '?').replace(/[^A-Za-z0-9 ]/g, ' ').trim().split(/\s+/);
    var ini = (words.length > 1 ? words[0][0] + words[1][0] : (words[0] || '?').slice(0, 2)).toUpperCase();
    return '<span class="mv-logo' + (url ? '' : ' fallback') + '">' +
      (url ? '<img src="' + attr(url) + '" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.parentNode.classList.add(&quot;fallback&quot;);this.remove()">' : '') +
      '<i>' + esc(ini) + '</i></span>';
  }
  function usdText(v) {
    if (v === null || v === undefined || !isFinite(v)) return '';
    return '≈ ' + (usd(Math.abs(v)) || '$0');
  }
  /* o: { logo, label, amount, symbol, name, usd, tone, parties: [[label, html], …] } */
  function moveRow(o) {
    var sub = [o.name, usdText(o.usd)].filter(Boolean).join(' · ');
    var parties = (o.parties || []).map(function (p, i) {
      return (i ? '<span class="mv-arrow" aria-hidden="true">→</span>' : '') +
        '<div class="mv-party"><small>' + esc(p[0]) + '</small>' + p[1] + '</div>';
    }).join('');
    return '<div class="move">' + logo(o.logo, o.label || o.symbol) +
      '<div class="mv-amt"><b class="' + (o.tone || '') + '">' + esc(o.amount) +
        (o.symbol ? ' <span class="mv-sym">' + o.symbol + '</span>' : '') + '</b>' +
        (sub ? '<small>' + esc(sub) + '</small>' : '') + '</div>' +
      (parties ? '<div class="mv-path">' + parties + '</div>' : '') +
      (o.right ? '<div class="mv-right">' + o.right + '</div>' : '') + '</div>';
  }
  function moveSection(eyebrow, title, meta, rows) {
    return '<section class="card subcard"><header><div><p class="eyebrow">' + esc(eyebrow) + '</p><h2>' + esc(title) +
      '</h2></div>' + (meta ? '<span class="section-meta">' + esc(meta) + '</span>' : '') + '</header>' +
      '<div class="move-list">' + rows.join('') + '</div></section>';
  }

  function setLoading(chain, message) {
    $(chain + '-overview').hidden = true;
    $(chain + '-detail').hidden = true;
    $(chain + '-route-error').hidden = true;
    var el = $(chain + '-route-loading');
    el.hidden = false;
    el.innerHTML = '<p class="state-title">' + esc(message) + '</p>' + S.skeleton(3, 13);
  }
  function setError(chain, title, message) {
    $(chain + '-overview').hidden = true;
    $(chain + '-detail').hidden = true;
    $(chain + '-route-loading').hidden = true;
    var el = $(chain + '-route-error');
    el.hidden = false;
    el.innerHTML = '<p class="state-title">' + esc(title) + '</p><p>' + esc(message) +
      '</p><p style="margin-top:12px">' + backLink(chain).replace('← Explorer overview', '← Return to Explorer') + '</p>';
  }
  function showDetail(chain, html, title) {
    $(chain + '-overview').hidden = true;
    $(chain + '-route-loading').hidden = true;
    $(chain + '-route-error').hidden = true;
    var el = $(chain + '-detail');
    el.hidden = false;
    el.innerHTML = html;
    if (title) document.title = title + ' · Satstreet Explorer';
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function showOverviewPanel(chain) {
    $(chain + '-detail').hidden = true;
    $(chain + '-route-loading').hidden = true;
    $(chain + '-route-error').hidden = true;
    $(chain + '-overview').hidden = false;
  }

  function withTimeout(promise, ms) {
    return Promise.race([promise, new Promise(function (_, reject) {
      setTimeout(function () { reject(new Error(UNAVAILABLE)); }, ms || 15000);
    })]);
  }

  /* ════════════════════════════ Ethereum ════════════════════════════ */
  function bs(path) {
    return withTimeout(fetch(BLOCKSCOUT + path, { headers: { accept: 'application/json' } }).then(function (r) {
      if (r.status === 404) throw new Error('Not found on Ethereum mainnet.');
      if (!r.ok) throw new Error(UNAVAILABLE);
      return r.json();
    }));
  }
  function addrName(a) { return a ? (a.ens_domain_name || a.name || null) : null; }
  function ethAddr(a, cls) {
    if (!a || !a.hash) return '—';
    return link('eth', 'address', a.hash, addrName(a) || short(a.hash, 8, 6), cls || 'chain-addr');
  }

  function ethBlocksTable(items) {
    if (!items || !items.length) return S.emptyState('No recent blocks were returned.');
    return '<div class="explorer-tablewrap"><table class="explorer-table"><caption class="sr">Latest Ethereum blocks</caption>' +
      '<thead><tr><th>Block</th><th>Age</th><th>Transactions</th><th>Gas used</th><th>Base fee</th><th>Fee recipient</th></tr></thead><tbody>' +
      items.map(function (b) {
        return '<tr data-xhref="./explorer.html?chain=eth&view=block&id=' + b.height + '">' +
          '<td data-label="Block">' + link('eth', 'block', b.height, num(b.height), 'block-height') + '</td>' +
          '<td data-label="Age">' + esc(age(b.timestamp)) + '</td>' +
          '<td data-label="Transactions">' + num(b.transactions_count) + '</td>' +
          '<td data-label="Gas used">' + (b.gas_used_percentage != null ? Number(b.gas_used_percentage).toFixed(1) + '%' : '—') + '</td>' +
          '<td data-label="Base fee">' + esc(gwei(b.base_fee_per_gas)) + '</td>' +
          '<td data-label="Fee recipient">' + ethAddr(b.miner) + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  function ethOverview() {
    $('eth-metrics').innerHTML = [1, 2, 3, 4].map(function () { return '<div class="metric">' + S.skeleton(2, 16) + '</div>'; }).join('');
    $('eth-blocks').innerHTML = '<div style="padding:20px">' + S.skeleton(8, 13) + '</div>';
    Promise.all([bs('stats').catch(function () { return null; }), bs('blocks?type=block')])
      .then(function (r) {
        var st = r[0], blocks = (r[1].items || []).slice(0, 10);
        if (!blocks.length) throw new Error('No recent blocks were returned.');
        $('eth-metrics').innerHTML =
          metric('Latest block', num(blocks[0].height), age(blocks[0].timestamp)) +
          metric('Average block time', st && st.average_block_time ? (st.average_block_time / 1000).toFixed(1) + ' sec' : '—', 'Ethereum mainnet') +
          metric('Gas price', st && st.gas_prices && st.gas_prices.average != null ? st.gas_prices.average + ' gwei' : '—', 'average network estimate') +
          metric('Transactions today', st ? num(st.transactions_today) : '—', st && st.network_utilization_percentage != null ? Number(st.network_utilization_percentage).toFixed(1) + '% network utilisation' : '');
        $('eth-blocks').innerHTML = ethBlocksTable(blocks);
      })
      .catch(function (e) {
        $('eth-metrics').innerHTML = '<div class="card" style="grid-column:1/-1">' +
          S.errorState('Unable to load Ethereum network data.', e.message, 'retry-eth') + '</div>';
        $('eth-blocks').innerHTML = '';
      });
  }

  /* Transaction rows shared by block and address pages. `self` marks the
     address being viewed so direction can be shown. */
  function ethTxRows(items, self) {
    if (!items || !items.length) return '<div style="padding:18px">' + S.emptyState('No transactions were returned.') + '</div>';
    var me = self ? self.toLowerCase() : null;
    return items.map(function (t) {
      var from = t.from && t.from.hash, to = t.to && t.to.hash;
      var dir = '';
      if (me) {
        var out = from && from.toLowerCase() === me, inn = to && to.toLowerCase() === me;
        dir = out && inn ? 'Self' : out ? 'Out' : inn ? 'In' : '';
      }
      var party = me
        ? (dir === 'Out' ? (t.to ? ethAddr(t.to) : 'Contract creation') : ethAddr(t.from))
        : (ethAddr(t.from) + ' → ' + (t.to ? ethAddr(t.to) : 'Contract creation'));
      var ok = t.result === 'success' || t.status === 'ok';
      return '<div class="transaction-row">' + link('eth', 'tx', t.hash, short(t.hash, 14, 10)) +
        '<div class="tx-stat"><span>' + (me ? (dir === 'Out' ? 'To' : 'From') : 'From → To') + '</span><b>' + party + '</b></div>' +
        '<div class="tx-stat"><span>' + esc(t.method ? 'Method' : 'Status') + '</span><b>' +
          (t.method ? esc(trunc(t.method, 22)) : (ok ? 'Success' : 'Failed')) +
          (!ok ? ' <span class="amount-negative">· Failed</span>' : '') + '</b></div>' +
        '<div class="tx-stat"><span>' + (me ? esc(dir || 'Value') + (t.timestamp ? ' · ' + esc(age(t.timestamp)) : '') : 'Value') + '</span><b class="' +
          (dir === 'In' && t.value !== '0' ? 'amount-positive' : dir === 'Out' && t.value !== '0' ? 'amount-negative' : '') + '">' +
          esc(eth(t.value, 6)) + '</b></div></div>';
    }).join('');
  }

  var ethPager = null;   // { kind, base, next, self }
  function ethMore() {
    if (!ethPager || !ethPager.next) return;
    var btn = $('eth-more');
    if (btn) { btn.disabled = true; btn.textContent = 'Loading…'; }
    var q = Object.keys(ethPager.next).filter(function (k) { return ethPager.next[k] !== null && ethPager.next[k] !== undefined; }).map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(ethPager.next[k]); }).join('&');
    bs(ethPager.base + (ethPager.base.indexOf('?') > -1 ? '&' : '?') + q).then(function (d) {
      $('eth-txlist').insertAdjacentHTML('beforeend', ethTxRows(d.items, ethPager.self));
      ethPager.next = d.next_page_params;
      if (btn) {
        if (ethPager.next) { btn.disabled = false; btn.textContent = 'Show more'; } else btn.parentNode.remove();
      }
    }).catch(function (e) {
      if (btn) { btn.disabled = false; btn.textContent = 'Try again'; }
    });
  }

  function ethBlock(id) {
    setLoading('eth', 'Loading block…');
    Promise.all([bs('blocks/' + encodeURIComponent(id)), bs('blocks/' + encodeURIComponent(id) + '/transactions').catch(function () { return { items: [] }; })])
      .then(function (r) {
        var b = r[0], txs = r[1];
        var reward = (b.rewards || []).reduce(function (s, x) { return s + BigInt(x.reward || '0'); }, BigInt(0));
        var prev = b.height > 0 ? link('eth', 'block', b.height - 1, '← Previous Block', 'btn ghost small') : '';
        var next = link('eth', 'block', b.height + 1, 'Next Block →', 'btn ghost small');
        ethPager = { base: 'blocks/' + b.height + '/transactions', next: txs.next_page_params, self: null };
        var html = '<div class="detail-shell"><div class="detail-topline">' + backLink('eth') + '<div class="block-nav">' + prev + next + '</div></div>' +
          '<section class="card detail-card"><header><div><p class="eyebrow">Ethereum block</p><h2>Block ' + num(b.height) + '</h2></div>' +
          badge(true, 'Confirmed') + '</header><div class="detail-grid">' +
          field('Block height', num(b.height)) + field('Block hash', hashLine(b.hash)) +
          field('Timestamp', esc(when(b.timestamp))) + field('Age', esc(age(b.timestamp))) +
          field('Transactions', num(b.transactions_count)) + field('Fee recipient', ethAddr(b.miner)) +
          field('Gas used', num(b.gas_used) + (b.gas_used_percentage != null ? ' (' + Number(b.gas_used_percentage).toFixed(1) + '%)' : '')) +
          field('Gas limit', num(b.gas_limit)) +
          field('Base fee', esc(gwei(b.base_fee_per_gas))) + field('Burnt fees', esc(eth(b.burnt_fees, 6))) +
          field('Block reward', esc(eth(reward.toString(), 6))) + field('Size', num(b.size) + ' bytes') +
          '</div><details class="technical"><summary>Technical details</summary><dl>' +
          '<dt>Parent hash</dt><dd>' + (b.parent_hash ? link('eth', 'block', b.parent_hash, b.parent_hash) : '—') + '</dd>' +
          '<dt>Withdrawals</dt><dd>' + num(b.withdrawals_count) + '</dd>' +
          '<dt>Blob transactions</dt><dd>' + num(b.blob_transactions_count) + '</dd>' +
          '<dt>Internal transactions</dt><dd>' + num(b.internal_transactions_count) + '</dd>' +
          '</dl></details></section>' +
          '<section class="card subcard"><header><div><p class="eyebrow">Included activity</p><h2>Transactions</h2></div>' +
          '<span class="section-meta">' + num(b.transactions_count) + ' in this block</span></header>' +
          '<div class="transaction-list" id="eth-txlist">' + ethTxRows(txs.items, null) + '</div>' +
          (txs.next_page_params ? moreButton('eth-more') : '') + '</section></div>';
        showDetail('eth', html, 'Block ' + b.height);
      })
      .catch(function (e) { setError('eth', 'Block not found.', e.message); });
  }

  function ethTransferRow(x) {
    var t = x.token || {}, total = x.total || {};
    var tokenAddr = t.address_hash || t.address;
    var symbol = t.symbol || 'Token', amount, usd = null;
    if (total.value === undefined) {
      amount = total.token_id ? '#' + short(total.token_id, 8, 4) : '1';
    } else {
      amount = units(total.value, total.decimals || t.decimals || 0, 6) || '—';
      if (t.exchange_rate && amount !== '—') usd = Number(amount.replace(/,/g, '')) * Number(t.exchange_rate);
    }
    return moveRow({
      logo: t.icon_url, label: t.name || symbol, amount: amount,
      symbol: tokenAddr ? link('eth', 'address', tokenAddr, symbol, 'mv-symlink') : esc(symbol),
      name: t.name && t.name !== symbol ? t.name : (x.token_type && x.token_type !== 'ERC-20' ? x.token_type : ''),
      usd: usd,
      parties: [['From', ethAddr(x.from)], ['To', ethAddr(x.to)]]
    });
  }

  function ethTx(hash) {
    setLoading('eth', 'Loading transaction…');
    bs('transactions/' + encodeURIComponent(hash)).then(function (t) {
      var ok = t.result === 'success' || t.status === 'ok';
      var pending = t.result === 'pending' || !t.block_number;
      var gasPct = t.gas_limit && t.gas_used ? ' (' + (Number(t.gas_used) / Number(t.gas_limit) * 100).toFixed(1) + '%)' : '';
      var transfers = t.token_transfers || [];
      var moves = [];
      if (t.value && t.value !== '0') {
        var ethAmt = units(t.value, 18, 6);
        moves.push(moveRow({
          logo: ETH_LOGO, label: 'Ether', amount: ethAmt, symbol: 'ETH', name: 'Ether',
          usd: t.exchange_rate ? Number(ethAmt.replace(/,/g, '')) * Number(t.exchange_rate) : null,
          parties: [['From', ethAddr(t.from)], ['To', t.to ? ethAddr(t.to) : ethAddr(t.created_contract)]]
        }));
      }
      transfers.forEach(function (x) { moves.push(ethTransferRow(x)); });
      var tt = moves.length
        ? moveSection('What moved', 'Assets moved', num(moves.length) + (t.token_transfers_overflow ? '+' : '') + (moves.length === 1 ? ' transfer' : ' transfers'), moves)
        : '';
      var html = '<div class="detail-shell"><div class="detail-topline">' + backLink('eth') + '</div>' +
        '<section class="card detail-card"><header><div><p class="eyebrow">Ethereum transaction</p><h2>Transaction</h2></div>' +
        (pending ? '<span class="status-badge pending">Pending</span>' : badge(ok, ok ? 'Success' : 'Failed')) + '</header><div class="detail-grid">' +
        field('Transaction hash', hashLine(t.hash)) + field('Status', pending ? 'Pending' : ok ? 'Success' : 'Failed' + (t.revert_reason ? ' · reverted' : '')) +
        field('Block', t.block_number ? link('eth', 'block', t.block_number, num(t.block_number)) : 'Pending') +
        field('Confirmations', num(t.confirmations)) +
        field('Timestamp', esc(when(t.timestamp))) + field('Age', esc(age(t.timestamp))) +
        field('From', ethAddr(t.from)) +
        field(t.to ? 'To' : 'Contract created', t.to ? ethAddr(t.to) : ethAddr(t.created_contract)) +
        field('Value', esc(eth(t.value))) + field('Transaction fee', esc(eth(t.fee && t.fee.value))) +
        field('Gas price', esc(gwei(t.gas_price))) + field('Gas used', num(t.gas_used) + esc(gasPct)) +
        '</div><details class="technical"><summary>Technical details</summary><dl>' +
        '<dt>Method</dt><dd>' + esc(t.method || '—') + '</dd>' +
        '<dt>Nonce</dt><dd>' + num(t.nonce) + '</dd>' +
        '<dt>Position in block</dt><dd>' + num(t.position) + '</dd>' +
        '<dt>Transaction type</dt><dd>' + num(t.type) + '</dd>' +
        '<dt>Gas limit</dt><dd>' + num(t.gas_limit) + '</dd>' +
        '<dt>Max fee per gas</dt><dd>' + esc(gwei(t.max_fee_per_gas)) + '</dd>' +
        '<dt>Max priority fee</dt><dd>' + esc(gwei(t.max_priority_fee_per_gas)) + '</dd>' +
        '<dt>Burnt fee</dt><dd>' + esc(eth(t.transaction_burnt_fee)) + '</dd>' +
        (t.revert_reason ? '<dt>Revert reason</dt><dd>' + esc(typeof t.revert_reason === 'string' ? t.revert_reason : (t.revert_reason.raw || JSON.stringify(t.revert_reason))) + '</dd>' : '') +
        '<dt>Input data</dt><dd>' + esc(trunc(t.raw_input || '0x', 138)) + '</dd>' +
        '</dl></details></section>' + tt +
        '<section class="card education ' + (pending ? 'pending-card' : '') + '">' +
        (pending ? '<h2>Transaction pending</h2><p>This transaction is waiting to be included in an Ethereum block.</p>'
          : ok ? '<h2>Transaction confirmed</h2><p>Included in block ' + num(t.block_number) + ' · ' + num(t.confirmations) +
            ' confirmations.</p><p>Ethereum blocks are produced about every twelve seconds. A block is considered finalised roughly two epochs (about 13 minutes) after inclusion.</p>'
          : '<h2>Transaction failed</h2><p>This transaction was included in block ' + num(t.block_number) +
            ' but its execution reverted. No value moved, but the sender still paid the gas fee.</p>') +
        '</section></div>';
      showDetail('eth', html, short(t.hash, 10, 8));
    }).catch(function (e) { setError('eth', 'Transaction not found.', e.message); });
  }

  function ethAddress(addr) {
    setLoading('eth', 'Loading address…');
    Promise.all([
      bs('addresses/' + encodeURIComponent(addr)),
      bs('addresses/' + encodeURIComponent(addr) + '/counters').catch(function () { return {}; }),
      bs('addresses/' + encodeURIComponent(addr) + '/transactions').catch(function () { return { items: [] }; })
    ]).then(function (r) {
      var a = r[0], c = r[1], txs = r[2];
      ethPager = { base: 'addresses/' + a.hash + '/transactions', next: txs.next_page_params, self: a.hash };
      var kind = a.is_contract ? (a.token ? 'Token contract' : 'Contract') : 'Wallet';
      var usd = a.exchange_rate && a.coin_balance ? Number(units(a.coin_balance, 18, 6).replace(/,/g, '')) * Number(a.exchange_rate) : null;
      var token = a.token
        ? field('Token', esc((a.token.name || '') + (a.token.symbol ? ' (' + a.token.symbol + ')' : ''))) +
          field('Token holders', num(a.token.holders_count))
        : '';
      var html = '<div class="detail-shell"><div class="detail-topline">' + backLink('eth') + '</div>' +
        '<section class="card detail-card"><header><div class="title-with-logo">' +
          (a.token ? logo(a.token.icon_url, a.token.name || a.token.symbol) : '') +
          '<div><p class="eyebrow">Ethereum ' + esc(kind.toLowerCase()) + '</p><h2>' +
          esc(a.token ? (a.token.name || a.name || 'Token') + (a.token.symbol ? ' (' + a.token.symbol + ')' : '') : (a.ens_domain_name || a.name || 'Address')) + '</h2></div></div>' +
          (a.is_contract && a.is_verified ? '<span class="status-badge confirmed">Verified contract</span>' : '') + '</header><div class="detail-grid">' +
        field('Address', hashLine(a.hash)) + field('Type', esc(kind)) +
        field('ETH balance', esc(eth(a.coin_balance, 6))) + field('Balance value', usd === null ? '—' : esc(S.fmt.money(usd, 'USD', 2))) +
        field('Transactions', num(c.transactions_count)) + field('Token transfers', num(c.token_transfers_count)) +
        (a.ens_domain_name ? field('ENS name', esc(a.ens_domain_name)) : '') +
        (a.creator_address_hash ? field('Created by', link('eth', 'address', a.creator_address_hash, short(a.creator_address_hash, 8, 6), 'chain-addr')) : '') +
        token +
        '</div></section><p class="srcnote privacy-note">Ethereum addresses and transactions are public blockchain data. Searching an address does not identify its owner.</p>' +
        '<section class="card subcard" id="eth-holdings" hidden></section>' +
        '<section class="card subcard"><header><div><p class="eyebrow">Recent activity</p><h2>Transaction history</h2></div>' +
        '<span class="section-meta">Most recent first</span></header>' +
        '<div class="transaction-list" id="eth-txlist">' + ethTxRows(txs.items, a.hash) + '</div>' +
        (txs.next_page_params ? moreButton('eth-more') : '') + '</section></div>';
      showDetail('eth', html, a.ens_domain_name || short(a.hash, 12, 8));
      if (a.has_tokens) ethHoldings(a.hash);
    }).catch(function (e) { setError('eth', 'Address not found.', e.message); });
  }

  /* Token holdings arrive separately: for a large wallet they are slow, and
     the page should not wait on them. */
  function ethHoldings(addr) {
    bs('addresses/' + encodeURIComponent(addr) + '/tokens?type=ERC-20').then(function (d) {
      var el = $('eth-holdings');
      if (!el) return;
      var rows = (d.items || []).map(function (x) {
        var t = x.token || {}, amt = units(x.value, t.decimals || 0, 6);
        var usd = t.exchange_rate && amt !== null ? Number(amt.replace(/,/g, '')) * Number(t.exchange_rate) : null;
        return { t: t, amt: amt, usd: usd };
      }).filter(function (x) { return x.amt !== null && x.amt !== '0'; })
        .sort(function (a, b) { return (b.usd || 0) - (a.usd || 0); }).slice(0, 10);
      if (!rows.length) return;
      var tmp = document.createElement('div');
      tmp.innerHTML = moveSection('Holdings', 'Tokens', 'Largest ' + rows.length + ' by value', rows.map(function (x) {
        var addr = x.t.address_hash || x.t.address, sym = x.t.symbol || 'Token';
        return moveRow({
          logo: x.t.icon_url, label: x.t.name || sym, amount: x.amt,
          symbol: addr ? link('eth', 'address', addr, sym, 'mv-symlink') : esc(sym),
          name: x.t.name,
          right: '<b>' + (x.usd === null ? '—' : esc(S.fmt.money(x.usd, 'USD', 2))) + '</b><small>value</small>'
        });
      }));
      el.innerHTML = tmp.firstChild.innerHTML;
      el.hidden = false;
    }).catch(function () {});
  }

  function ethSearch(q) {
    if (/^\d+$/.test(q)) return Promise.resolve({ view: 'block', id: q });
    return bs('search/check-redirect?q=' + encodeURIComponent(q)).then(function (r) {
      if (!r.redirect || !r.parameter) throw new Error('Nothing on Ethereum mainnet matches that search.');
      var view = r.type === 'transaction' ? 'tx' : r.type === 'block' ? 'block' : r.type === 'address' ? 'address' : null;
      if (!view) throw new Error('Nothing on Ethereum mainnet matches that search.');
      return { view: view, id: r.parameter };
    });
  }

  /* ════════════════════════════ Solana ══════════════════════════════ */
  function rpc(body) {
    return withTimeout(fetch(SOL_RPC, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
    }).then(function (r) {
      if (!r.ok) throw new Error(UNAVAILABLE);
      return r.json();
    }).then(function (j) {
      if (Array.isArray(j)) return j.sort(function (a, b) { return a.id - b.id; }).map(function (x) { return x.result; });
      if (j.error) throw new Error(j.error.message || UNAVAILABLE);
      return j.result;
    }));
  }
  function call(id, method, params) { return { jsonrpc: '2.0', id: id, method: method, params: params || [] }; }

  var PROGRAMS = {
    '11111111111111111111111111111111': 'System Program',
    'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA': 'Token Program',
    'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb': 'Token-2022 Program',
    'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL': 'Associated Token Account',
    'ComputeBudget111111111111111111111111111111': 'Compute Budget',
    'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr': 'Memo Program',
    'Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo': 'Memo Program (v1)',
    'Vote111111111111111111111111111111111111111': 'Vote Program',
    'Stake11111111111111111111111111111111111111': 'Stake Program',
    'BPFLoaderUpgradeab1e11111111111111111111111': 'BPF Upgradeable Loader',
    'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4': 'Jupiter Aggregator v6',
    'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc': 'Orca Whirlpools',
    '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8': 'Raydium AMM v4',
    'CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK': 'Raydium CLMM',
    '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P': 'Pump.fun',
    'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA': 'Pump.fun AMM',
    'JUP4Fb2cqiRUcaTHdrPC8h2gNsA5ETXEPDoQyEkUohe': 'Jupiter Aggregator v4',
    'jupoNjAxXgZ4rjzxzPMP4oxduvQsQtZzyknqvzYNrNu': 'Jupiter Limit Order',
    'CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C': 'Raydium CPMM',
    'routeUGWgWzqBWFcrCfv8tritsqukccJPu3q5GPP3xS': 'Raydium Router',
    'LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo': 'Meteora DLMM',
    'Eo7WjKq67rjJQSZxS6z3YkapzY3eMj6Xy8X5EQVn5UaB': 'Meteora Pools',
    'cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG': 'Meteora DAMM v2',
    '9W959DqEETiGZocYWCQPaJ6sBmUzgfxXfqGeTEdp3aQP': 'Orca Swap',
    'PhoeNiXZ8ByJGLkxNfZRnkUfjvmuYqLR89jjFHGqdXY': 'Phoenix',
    'srmqPvymJeFKQ4zGQed1GFppgkRHL9kaELCbyksJtPX': 'OpenBook',
    'opnb2LAfJYbRMAHHvqjCwQxanZn7ReEHp1k81EohpZb': 'OpenBook v2',
    '2wT8Yq49kHgDzXuPxZSaeLaH1qbmGXtEyPy64bL7aD3c': 'Lifinity',
    'SoLFiHG9TfgtdUXUjWAxi3LtvYuFyDLVhBWxdMZxyCe': 'SolFi',
    'TessVdML9pBGgG9yGks7o4HewRaXVAMuoVj4x83GLQH': 'Tessera',
    'BiSoNHVpsVZW2F7rx2eQ59yQwKxzU5NvBcmKshCSUypi': 'Bisonfi',
    'MarBmsSgKXdrN1egZf5sqe1TMai9K1rChYNDJgjq7aD': 'Marinade',
    'SPoo1Ku8WFXoNDMHPsrGSTSG1Y47rzgn41SLUNakuHy': 'Stake Pool Program',
    'dRiftyHA39MWEi3m9aunc5MzRF1JYuBsbn6VPcn33UH': 'Drift',
    'KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD': 'Kamino Lending',
    'MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA': 'Marginfi',
    'cndy3Z4yapfJBmL3ShUp5exZKqR3z33thTzeNMm2gRZ': 'Candy Machine',
    'M2mx93ekt1fmXSVkTrUL9xVFHkmME8HTUi5Cyc5aF7K': 'Magic Eden',
    'wormDTUJ6AWPNvk59vGQbDvGJmqbDTdgWgAqcLBCgUb': 'Wormhole',
    'DeJBGdMFa1uynnnKiwrVioatTuHmNLpyFKnmB5kaFdzQ': 'Phantom Swap',
    'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s': 'Metaplex Token Metadata'
  };
  function programName(id) { return PROGRAMS[id] || null; }
  /* Token names and logos for Solana mints, from Jupiter's public token
     list. Optional: a slow or missing answer leaves the short mint address. */
  var WSOL = 'So11111111111111111111111111111111111111112';
  var tokenCache = {};
  function solTokens(mints) {
    var need = mints.filter(function (m) { return m && !(m in tokenCache); });
    if (!need.length) return Promise.resolve(tokenCache);
    return withTimeout(fetch('https://lite-api.jup.ag/tokens/v2/search?query=' + need.slice(0, 50).join(','))
      .then(function (r) { return r.ok ? r.json() : []; }), 5000)
      .then(function (list) {
        need.forEach(function (m) { tokenCache[m] = null; });
        (list || []).forEach(function (t) { if (t && t.id) tokenCache[t.id] = t; });
        return tokenCache;
      })
      .catch(function () { return tokenCache; });
  }
  var DEX = /Jupiter|Raydium|Orca|Meteora|Pump\.fun|Phoenix|OpenBook|Lifinity|SolFi|Tessera|Bisonfi|Phantom Swap/;
  var solUsd = null;
  function solPrice() {
    if (solUsd !== null) return Promise.resolve(solUsd);
    return withTimeout(fetch('https://lite-api.jup.ag/price/v3?ids=' + WSOL).then(function (r) { return r.ok ? r.json() : {}; }), 5000)
      .then(function (d) { solUsd = d && d[WSOL] && d[WSOL].usdPrice || 0; return solUsd; })
      .catch(function () { return 0; });
  }
  /* Dollar values read like Solscan: cents above $1 ($1,381.20), four
     significant decimals below it. */
  function usd(v) {
    if (!v || !isFinite(v)) return null;
    return v >= 1 ? '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : S.fmt.money(v, 'USD', 4);
  }
  /* Look up up to 100 mints in two batches (Jupiter answers 50 at a time). */
  function solTokensMany(mints) {
    var a = mints.slice(0, 50), b = mints.slice(50, 100);
    return solTokens(a).then(function () { return b.length ? solTokens(b) : tokenCache; });
  }
  function solAddr(pk, cls) {
    if (!pk) return '—';
    return link('sol', 'address', pk, programName(pk) || short(pk, 6, 6), cls || 'chain-addr');
  }

  function solOverview() {
    $('sol-metrics').innerHTML = [1, 2, 3, 4].map(function () { return '<div class="metric">' + S.skeleton(2, 16) + '</div>'; }).join('');
    $('sol-blocks').innerHTML = '<div style="padding:20px">' + S.skeleton(6, 13) + '</div>';
    rpc([call(0, 'getEpochInfo', [{ commitment: 'finalized' }]), call(1, 'getRecentPerformanceSamples', [5])])
      .then(function (r) {
        var ep = r[0], perf = r[1] || [];
        if (!ep) throw new Error(UNAVAILABLE);
        var tps = 0, nonVote = 0, secs = 0;
        perf.forEach(function (p) { tps += p.numTransactions; nonVote += p.numNonVoteTransactions || 0; secs += p.samplePeriodSecs; });
        $('sol-metrics').innerHTML =
          metric('Current slot', num(ep.absoluteSlot), 'finalized') +
          metric('Block height', num(ep.blockHeight), 'Solana mainnet') +
          metric('Throughput', secs ? Math.round(tps / secs).toLocaleString('en-US') + ' TPS' : '—',
            secs ? Math.round(nonVote / secs).toLocaleString('en-US') + ' TPS excluding votes' : '') +
          metric('Epoch', num(ep.epoch), (ep.slotIndex / ep.slotsInEpoch * 100).toFixed(1) + '% complete');
        return rpc(call(2, 'getBlocks', [ep.absoluteSlot - 14, ep.absoluteSlot, { commitment: 'finalized' }]));
      })
      .then(function (slots) {
        slots = (slots || []).slice(-6).reverse();
        if (!slots.length) throw new Error('No recent blocks were returned.');
        return rpc(slots.map(function (s, i) {
          return call(i, 'getBlock', [s, { transactionDetails: 'signatures', rewards: true, maxSupportedTransactionVersion: 1, commitment: 'finalized' }]);
        })).then(function (blocks) { return { slots: slots, blocks: blocks }; });
      })
      .then(function (d) {
        $('sol-blocks').innerHTML = '<div class="explorer-tablewrap"><table class="explorer-table"><caption class="sr">Latest Solana blocks</caption>' +
          '<thead><tr><th>Slot</th><th>Age</th><th>Transactions</th><th>Leader</th><th>Block hash</th></tr></thead><tbody>' +
          d.blocks.map(function (b, i) {
            if (!b) return '';
            var slot = d.slots[i];
            var leader = (b.rewards || []).filter(function (x) { return x.rewardType === 'Fee'; })[0];
            return '<tr data-xhref="./explorer.html?chain=sol&view=block&id=' + slot + '">' +
              '<td data-label="Slot">' + link('sol', 'block', slot, num(slot), 'block-height') + '</td>' +
              '<td data-label="Age">' + esc(age(b.blockTime)) + '</td>' +
              '<td data-label="Transactions">' + num((b.signatures || []).length) + '</td>' +
              '<td data-label="Leader">' + (leader ? solAddr(leader.pubkey) : '—') + '</td>' +
              '<td data-label="Block hash"><span class="chain-hash">' + esc(short(b.blockhash, 6, 6)) + '</span></td></tr>';
          }).join('') + '</tbody></table></div>';
      })
      .catch(function (e) {
        if (!$('sol-metrics').querySelector('.metric .v')) {
          $('sol-metrics').innerHTML = '<div class="card" style="grid-column:1/-1">' +
            S.errorState('Unable to load Solana network data.', e.message, 'retry-sol') + '</div>';
          $('sol-blocks').innerHTML = '';
        } else {
          $('sol-blocks').innerHTML = '<div style="padding:20px">' + S.errorState('Unable to load latest blocks.', e.message, 'retry-sol') + '</div>';
        }
      });
  }

  /* Signature lists: a block's signatures are already in hand and are paged
     locally; an address's are fetched 25 at a time, older ones on request. */
  var solPager = null;   // { kind: 'block'|'address', sigs, shown, addr, before }
  function solSigRows(list) {
    if (!list.length) return '<div style="padding:18px">' + S.emptyState('No transactions were returned.') + '</div>';
    return list.map(function (x) {
      var sig = typeof x === 'string' ? x : x.signature;
      if (typeof x === 'string') {
        return '<div class="transaction-row sig-row">' + link('sol', 'tx', sig, short(sig, 18, 12)) + '</div>';
      }
      return '<div class="transaction-row">' + link('sol', 'tx', sig, short(sig, 14, 10)) +
        '<div class="tx-stat"><span>Status</span><b class="' + (x.err ? 'amount-negative' : '') + '">' + (x.err ? 'Failed' : 'Success') + '</b></div>' +
        '<div class="tx-stat"><span>Slot</span><b>' + link('sol', 'block', x.slot, num(x.slot)) + '</b></div>' +
        '<div class="tx-stat"><span>Age</span><b>' + esc(age(x.blockTime)) + '</b></div></div>';
    }).join('');
  }
  function solMore() {
    if (!solPager) return;
    var btn = $('sol-more');
    if (solPager.kind === 'block') {
      var next = solPager.sigs.slice(solPager.shown, solPager.shown + 25);
      solPager.shown += next.length;
      $('sol-txlist').insertAdjacentHTML('beforeend', solSigRows(next));
      if (solPager.shown >= solPager.sigs.length && btn) btn.parentNode.remove();
      return;
    }
    if (btn) { btn.disabled = true; btn.textContent = 'Loading…'; }
    rpc(call(1, 'getSignaturesForAddress', [solPager.addr, { limit: 25, before: solPager.before }])).then(function (list) {
      list = list || [];
      $('sol-txlist').insertAdjacentHTML('beforeend', solSigRows(list));
      if (list.length) solPager.before = list[list.length - 1].signature;
      if (btn) {
        if (list.length === 25) { btn.disabled = false; btn.textContent = 'Show more'; } else btn.parentNode.remove();
      }
    }).catch(function () { if (btn) { btn.disabled = false; btn.textContent = 'Try again'; } });
  }

  function solBlock(slot) {
    slot = Number(slot);
    setLoading('sol', 'Loading block…');
    rpc([
      call(0, 'getBlock', [slot, { transactionDetails: 'signatures', rewards: true, maxSupportedTransactionVersion: 1, commitment: 'finalized' }]),
      call(1, 'getBlocks', [slot + 1, slot + 40, { commitment: 'finalized' }])
    ]).then(function (r) {
      var b = r[0], after = r[1] || [];
      if (!b) throw new Error('Slot ' + num(slot) + ' was skipped or is not yet finalized.');
      var sigs = b.signatures || [];
      solPager = { kind: 'block', sigs: sigs, shown: Math.min(25, sigs.length) };
      var leader = (b.rewards || []).filter(function (x) { return x.rewardType === 'Fee'; })[0];
      var prev = link('sol', 'block', b.parentSlot, '← Previous Block', 'btn ghost small');
      var next = after.length ? link('sol', 'block', after[0], 'Next Block →', 'btn ghost small') : '';
      var html = '<div class="detail-shell"><div class="detail-topline">' + backLink('sol') + '<div class="block-nav">' + prev + next + '</div></div>' +
        '<section class="card detail-card"><header><div><p class="eyebrow">Solana block</p><h2>Slot ' + num(slot) + '</h2></div>' +
        badge(true, 'Finalized') + '</header><div class="detail-grid">' +
        field('Slot', num(slot)) + field('Block hash', hashLine(b.blockhash)) +
        field('Timestamp', esc(when(b.blockTime))) + field('Age', esc(age(b.blockTime))) +
        field('Block height', num(b.blockHeight)) + field('Transactions', num(sigs.length)) +
        field('Leader', leader ? solAddr(leader.pubkey) : '—') + field('Leader reward', leader ? esc(sol(leader.lamports)) : '—') +
        field('Parent slot', link('sol', 'block', b.parentSlot, num(b.parentSlot))) +
        field('Previous block hash', hashLine(b.previousBlockhash)) +
        '</div></section>' +
        '<section class="card subcard"><header><div><p class="eyebrow">Included activity</p><h2>Transactions</h2></div>' +
        '<span class="section-meta">' + num(sigs.length) + ' in this block, including validator votes</span></header>' +
        '<div class="transaction-list" id="sol-txlist">' + solSigRows(sigs.slice(0, 25)) + '</div>' +
        (sigs.length > 25 ? moreButton('sol-more') : '') + '</section></div>';
      showDetail('sol', html, 'Slot ' + slot);
    }).catch(function (e) { setError('sol', 'Block not found.', e.message); });
  }

  /* Solscan-style reading of a transaction: who signed it, what it did in
     one line (a swap, transfers, or the programs it called), every balance
     that moved, and the instructions underneath. */
  function solTx(sig) {
    setLoading('sol', 'Loading transaction…');
    rpc(call(1, 'getTransaction', [sig, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 1, commitment: 'confirmed' }])).then(function (t) {
      if (!t) throw new Error('No transaction with that signature was found.');
      var meta = t.meta || {}, msg = t.transaction.message, keys = msg.accountKeys || [];
      var ok = !meta.err;
      var signers = keys.filter(function (k) { return k.signer; }).map(function (k) { return k.pubkey; });
      var feePayer = keys[0] && keys[0].pubkey;

      /* Token accounts → mint and owner, from the balance snapshots. */
      var acct = {};
      (meta.preTokenBalances || []).concat(meta.postTokenBalances || []).forEach(function (b) {
        var k = keys[b.accountIndex]; if (k) acct[k.pubkey] = { mint: b.mint, owner: b.owner, dec: b.uiTokenAmount.decimals };
      });

      var solChanges = keys.map(function (k, i) {
        return { pk: k.pubkey, d: (meta.postBalances[i] || 0) - (meta.preBalances[i] || 0) };
      }).filter(function (x) { return x.d !== 0; });

      var tok = {};
      (meta.preTokenBalances || []).forEach(function (b) {
        tok[b.accountIndex] = { owner: b.owner, mint: b.mint, dec: b.uiTokenAmount.decimals, pre: BigInt(b.uiTokenAmount.amount), post: BigInt(0) };
      });
      (meta.postTokenBalances || []).forEach(function (b) {
        var e = tok[b.accountIndex] || { owner: b.owner, mint: b.mint, dec: b.uiTokenAmount.decimals, pre: BigInt(0) };
        e.post = BigInt(b.uiTokenAmount.amount);
        tok[b.accountIndex] = e;
      });
      var tokChanges = Object.keys(tok).map(function (k) { return tok[k]; }).filter(function (x) { return x.post !== x.pre; });

      /* Every instruction, outer and inner, in order. */
      var all = [];
      (msg.instructions || []).forEach(function (ix, i) {
        all.push(ix);
        (meta.innerInstructions || []).filter(function (g) { return g.index === i; })
          .forEach(function (g) { g.instructions.forEach(function (x) { all.push(x); }); });
      });
      var programs = [];
      all.forEach(function (ix) { if (programs.indexOf(ix.programId) < 0) programs.push(ix.programId); });

      var mints = tokChanges.map(function (x) { return x.mint; });
      Object.keys(acct).forEach(function (k) { mints.push(acct[k].mint); });
      return Promise.all([solTokensMany(mints.filter(function (m, i) { return mints.indexOf(m) === i; }).concat([WSOL])), solPrice()]).then(function (res) {
        var info = res[0], price = res[1];
        var symOf = function (mint) { return mint === WSOL ? 'SOL' : (info[mint] && info[mint].symbol) || short(mint, 4, 4); };
        var tokenLink = function (mint) { return mint === WSOL ? 'SOL' : link('sol', 'address', mint, symOf(mint), 'mv-symlink'); };

        /* ── action summary ── */
        var actions = [];
        var signer = signers[0];
        var net = {};   // signer's net change per asset, wrapped SOL folded into SOL
        solChanges.forEach(function (x) {
          if (x.pk !== signer) return;
          net.SOL = (net.SOL || 0) + x.d + (x.pk === feePayer ? meta.fee : 0);
        });
        tokChanges.forEach(function (x) {
          if (x.owner !== signer) return;
          var key = x.mint === WSOL ? 'SOL' : x.mint;
          var d = Number(x.post - x.pre) / Math.pow(10, x.mint === WSOL ? 9 : x.dec) * (x.mint === WSOL ? 1e9 : 1);
          if (key === 'SOL') net.SOL = (net.SOL || 0) + d;
          else net[key] = { d: (net[key] ? net[key].d : 0) + Number(x.post - x.pre), dec: x.dec };
        });
        var outs = [], ins = [];
        var tokenLegs = Object.keys(net).filter(function (k) { return k !== 'SOL'; }).length;
        Object.keys(net).forEach(function (k) {
          var v = k === 'SOL' ? { d: net.SOL, dec: 9 } : net[k];
          /* Account rent (~0.002 SOL) is not a trade leg when tokens moved. */
          if (k === 'SOL' && Math.abs(v.d) < (tokenLegs ? 1e7 : 1e5)) return;
          if (v.d < 0) outs.push({ k: k, a: -v.d, dec: v.dec }); else if (v.d > 0) ins.push({ k: k, a: v.d, dec: v.dec });
        });
        var dex = programs.map(programName).filter(function (n) { return n && DEX.test(n); })[0];
        var leg = function (x) { return '<b>' + esc(units(String(Math.round(x.a)), x.dec, 6)) + '</b> ' + tokenLink(x.k === 'SOL' ? WSOL : x.k); };
        /* Every SOL and token transfer, in order, with the program that
           made it (the DEX pool, for a swap hop). */
        var transfers = [], lastProg = null;
        all.forEach(function (ix) {
          var pn = programName(ix.programId);
          if (pn && !/^(Token|Token-2022|System|Associated Token|Compute Budget)/.test(pn)) lastProg = pn;
          var p = ix.parsed; if (!p) return;
          var inf = p.info || {};
          if (ix.program === 'system' && p.type === 'transfer') {
            transfers.push({ from: inf.source, to: inf.destination, mint: WSOL, raw: String(inf.lamports), dec: 9, via: lastProg });
          } else if ((ix.program === 'spl-token' || ix.program === 'spl-token-2022') && (p.type === 'transfer' || p.type === 'transferChecked')) {
            var src = acct[inf.source] || {}, dst = acct[inf.destination] || {};
            var mint = inf.mint || src.mint || dst.mint;
            if (!mint) return;
            transfers.push({
              from: src.owner || inf.authority || inf.source, to: dst.owner || inf.destination, mint: mint,
              raw: String(inf.tokenAmount ? inf.tokenAmount.amount : inf.amount),
              dec: inf.tokenAmount ? inf.tokenAmount.decimals : (src.dec || dst.dec || 0), via: lastProg
            });
          }
        });
        var amt = function (x) { return '<b>' + esc(units(x.raw, x.dec, 6)) + '</b> ' + tokenLink(x.mint); };
        var venue = function (n) { return n ? ' on <b>' + esc(n.replace(/ Aggregator v\d| v\d$/, '')) + '</b>' : ''; };

        /* A hop: the signer sends one asset to a pool and receives a
           different one back from that same pool. */
        var used = {};
        transfers.forEach(function (t, a) {
          if (used[a] || t.from !== signer) return;
          for (var b = a + 1; b < transfers.length; b++) {
            var u = transfers[b];
            if (used[b] || u.to !== signer || u.from !== t.to || u.mint === t.mint) continue;
            used[a] = used[b] = true;
            t.swapWith = u;
            break;
          }
          if (!t.swapWith) for (var c = a - 1; c >= 0; c--) {
            var w = transfers[c];
            if (used[c] || w.to !== signer || w.from !== t.to || w.mint === t.mint) continue;
            used[a] = used[c] = true;
            t.swapWith = w;
            break;
          }
        });
        var hops = transfers.filter(function (t) { return t.swapWith; });

        if (outs.length && ins.length && (dex || outs.length + ins.length === 2) && hops.length <= 1) {
          actions.push('Swapped ' + leg(outs[0]) + ' for ' + leg(ins[0]) + venue(dex));
        } else {
          if (outs.length && ins.length && dex) actions.push('Swapped ' + leg(outs[0]) + ' for ' + leg(ins[0]) + venue(dex) + ' (net)');
          transfers.forEach(function (t, k) {
            if (actions.length >= 8) return;
            if (t.swapWith) {
              actions.push('Swapped ' + amt(t) + ' for ' + amt(t.swapWith) + venue(t.via || t.swapWith.via || dex));
            } else if (!used[k]) {
              actions.push('Transferred ' + amt(t) + ' from ' + solAddr(t.from) + ' to ' + solAddr(t.to));
            }
          });
          if (!actions.length) {
            var named = programs.filter(function (pid) { return !/^(ComputeBudget|11111111111111111111111111111111$)/.test(pid); });
            actions.push('Interacted with ' + (named.length ? named.slice(0, 3).map(function (pid) { return solAddr(pid).replace(/>[^<]*</, '>' + esc(programName(pid) || short(pid, 6, 6)) + '<'); }).join(', ') : 'the System Program'));
          }
        }

        /* ── balance changes ── */
        var moves = [];
        solChanges.forEach(function (x) {
          var amtS = units(String(Math.abs(x.d)), 9, 9);
          moves.push(moveRow({
            logo: SOL_LOGO, label: 'Solana', amount: (x.d > 0 ? '+' : '−') + amtS, symbol: 'SOL', name: 'Solana',
            usd: price ? Math.abs(x.d) / 1e9 * price : null, tone: x.d > 0 ? 'amount-positive' : 'amount-negative',
            parties: [['Account', solAddr(x.pk)]]
          }));
        });
        tokChanges.forEach(function (x) {
          var d = x.post - x.pre, neg = d < BigInt(0), abs = neg ? -d : d;
          var ti = info[x.mint] || {}, sym = x.mint === WSOL ? 'wSOL' : (ti.symbol || short(x.mint, 4, 4));
          var amt = units(abs.toString(), x.dec, 6);
          moves.push(moveRow({
            logo: x.mint === WSOL ? SOL_LOGO : ti.icon, label: ti.name || sym, amount: (neg ? '−' : '+') + amt,
            symbol: link('sol', 'address', x.mint, sym, 'mv-symlink'),
            name: x.mint === WSOL ? 'Wrapped SOL' : ti.name, tone: neg ? 'amount-negative' : 'amount-positive',
            usd: (x.mint === WSOL ? price : ti.usdPrice) ? Number(amt.replace(/,/g, '')) * (x.mint === WSOL ? price : ti.usdPrice) : null,
            parties: [['Owner', solAddr(x.owner)]]
          }));
        });

        var sigCount = (t.transaction.signatures || []).length || 1;
        var prio = Math.max(0, meta.fee - 5000 * sigCount);
        var ixRows = (msg.instructions || []).map(function (ix, i) {
          var name = programName(ix.programId) || (ix.program ? ix.program.replace(/^spl-/, '').replace(/-/g, ' ') : short(ix.programId, 6, 6));
          var inner = (meta.innerInstructions || []).filter(function (g) { return g.index === i; }).reduce(function (n, g) { return n + g.instructions.length; }, 0);
          return '<div class="transaction-row ix-row"><div class="tx-stat"><span>#' + (i + 1) + ' Program</span><b>' + solAddr(ix.programId).replace(/>[^<]*</, '>' + esc(name) + '<') + '</b></div>' +
            '<div class="tx-stat"><span>Instruction</span><b>' + esc(ix.parsed && ix.parsed.type ? ix.parsed.type : (inner ? 'Program call · ' + inner + ' inner' : 'Program call')) + '</b></div></div>';
        }).join('');

        var html = '<div class="detail-shell"><div class="detail-topline">' + backLink('sol') + '</div>' +
          '<section class="card detail-card"><header><div><p class="eyebrow">Solana transaction</p><h2>Transaction</h2></div>' +
          badge(ok, ok ? 'Success' : 'Failed') + '</header>' +
          '<div class="tx-summary"><span class="tx-summary-k">Summary</span><ul>' + actions.map(function (a) { return '<li>' + a + '</li>'; }).join('') + '</ul></div>' +
          '<div class="detail-grid">' +
          field('Signature', hashLine(sig)) + field('Result', ok ? 'Success' : 'Failed') +
          field('Block', link('sol', 'block', t.slot, num(t.slot))) + field('Timestamp', esc(when(t.blockTime)) + ' · ' + esc(age(t.blockTime))) +
          field('Signer', signers.map(function (pk) { return solAddr(pk); }).join('<br>')) +
          field('Fee', esc(sol(meta.fee)) + (price ? ' <span class="muted">(' + esc(usd(meta.fee / 1e9 * price)) + ')</span>' : '')) +
          field('Priority fee', esc(sol(prio))) +
          field('Compute units', num(meta.computeUnitsConsumed)) +
          field('Programs', programs.filter(function (pid) { return !/^ComputeBudget/.test(pid); }).slice(0, 4).map(function (pid) { return solAddr(pid).replace(/>[^<]*</, '>' + esc(programName(pid) || short(pid, 6, 6)) + '<'); }).join('<br>')) +
          field('Version', esc(String(t.version))) +
          field('Instructions', num((msg.instructions || []).length) + ' · ' + num(all.length - (msg.instructions || []).length) + ' inner') +
          field('Accounts', num(keys.length)) +
          '</div><details class="technical"><summary>Technical details</summary><dl>' +
          '<dt>Recent blockhash</dt><dd>' + esc(msg.recentBlockhash || '—') + '</dd>' +
          (meta.err ? '<dt>Error</dt><dd>' + esc(JSON.stringify(meta.err)) + '</dd>' : '') +
          '<dt>Log messages</dt><dd class="logs">' + ((meta.logMessages || []).slice(0, 60).map(esc).join('<br>') || '—') + '</dd>' +
          '</dl></details></section>' +
          (moves.length ? moveSection('Balance changes', 'Assets moved', num(moves.length) + (moves.length === 1 ? ' change' : ' changes') + ' · fees included', moves) : '') +
          '<section class="card subcard"><header><div><p class="eyebrow">What it did</p><h2>Instructions</h2></div></header><div class="transaction-list">' +
            (ixRows || '<div style="padding:18px">' + S.emptyState('No instructions.') + '</div>') + '</div></section>' +
          '<section class="card education ' + (ok ? '' : 'pending-card') + '">' +
          (ok ? '<h2>Transaction confirmed</h2><p>Included in slot ' + num(t.slot) + '. Solana produces a block roughly every 400 milliseconds, and a block is finalized once a supermajority of stake has voted on it, usually within seconds.</p>'
              : '<h2>Transaction failed</h2><p>This transaction was included in slot ' + num(t.slot) + ' but did not execute successfully. The fee was still charged.</p>') +
          '</section></div>';
        showDetail('sol', html, short(sig, 10, 8));
      });
    }).catch(function (e) { setError('sol', 'Transaction not found.', e.message); });
  }

  function solAddress(pk) {
    setLoading('sol', 'Loading address…');
    rpc([
      call(0, 'getAccountInfo', [pk, { encoding: 'jsonParsed', commitment: 'confirmed' }]),
      call(1, 'getSignaturesForAddress', [pk, { limit: 25 }])
    ]).then(function (r) {
      var info = r[0] && r[0].value, sigs = r[1] || [];
      if (!info && !sigs.length) throw new Error('This address has no balance and no recorded activity on Solana mainnet.');
      var isMint = info && info.data && info.data.parsed && info.data.parsed.type === 'mint';
      return (isMint ? solTokens([pk]) : Promise.resolve({})).then(function (tk) {
      var tinfo = tk[pk] || null;
      solPager = { kind: 'address', addr: pk, before: sigs.length ? sigs[sigs.length - 1].signature : null };
      var parsed = info && info.data && info.data.parsed;
      var kind = !info ? 'Unfunded account'
        : info.executable ? 'Program'
        : parsed && parsed.type === 'mint' ? 'Token mint'
        : parsed && parsed.type === 'account' ? 'Token account'
        : info.owner === '11111111111111111111111111111111' ? 'Wallet' : 'Account';
      var extra = '';
      if (parsed && parsed.type === 'mint') {
        var m = parsed.info;
        extra = field('Supply', esc(units(m.supply, m.decimals, 2))) + field('Decimals', num(m.decimals)) +
          field('Mint authority', m.mintAuthority ? solAddr(m.mintAuthority) : 'None (fixed supply)');
      } else if (parsed && parsed.type === 'account') {
        var a = parsed.info;
        extra = field('Token mint', solAddr(a.mint)) + field('Token owner', solAddr(a.owner)) +
          field('Token balance', esc(a.tokenAmount ? a.tokenAmount.uiAmountString : '—'));
      }
      var html = '<div class="detail-shell"><div class="detail-topline">' + backLink('sol') + '</div>' +
        '<section class="card detail-card"><header><div class="title-with-logo">' +
          (tinfo ? logo(tinfo.icon, tinfo.name || tinfo.symbol) : '') +
          '<div><p class="eyebrow">Solana ' + esc(kind.toLowerCase()) + '</p><h2>' +
          esc(tinfo ? (tinfo.name || 'Token') + (tinfo.symbol ? ' (' + tinfo.symbol + ')' : '') : (programName(pk) || 'Address')) + '</h2></div></div></header><div class="detail-grid">' +
        field('Address', hashLine(pk)) + field('Type', esc(kind)) +
        field('SOL balance', esc(sol(info ? info.lamports : 0)) + '<span class="muted" id="sol-bal-usd"></span>') +
        field('Owner program', info ? solAddr(info.owner) : '—') +
        field('Data size', info ? num(info.space !== undefined ? info.space : 0) + ' bytes' : '—') +
        field('Executable', info ? (info.executable ? 'Yes' : 'No') : '—') + extra +
        '</div></section><p class="srcnote privacy-note">Solana addresses and transactions are public blockchain data. Searching an address does not identify its owner.</p>' +
        '<section class="card subcard" id="sol-holdings" hidden></section>' +
        '<section class="card subcard"><header><div><p class="eyebrow">Recent activity</p><h2>Transaction history</h2></div>' +
        '<span class="section-meta">Most recent first</span></header>' +
        '<div class="transaction-list" id="sol-txlist">' + solSigRows(sigs) + '</div>' +
        (sigs.length === 25 ? moreButton('sol-more') : '') + '</section></div>';
      showDetail('sol', html, tinfo && tinfo.symbol ? tinfo.symbol : short(pk, 12, 8));
      solPrice().then(function (p) {
        var el = $('sol-bal-usd');
        if (el && p && info) el.textContent = ' (' + usd(info.lamports / 1e9 * p) + ')';
      });
      if (!info || info.owner === '11111111111111111111111111111111') solHoldings(pk);
      });
    }).catch(function (e) { setError('sol', 'Address not found.', e.message); });
  }

  /* Token holdings, as Solscan's Portfolio tab shows them: every SPL token
     the wallet holds, valued and sorted, from Jupiter's public holdings and
     token APIs. Loaded after the page so a large wallet never holds it up. */
  function solHoldings(pk) {
    withTimeout(fetch('https://lite-api.jup.ag/ultra/v1/holdings/' + encodeURIComponent(pk)).then(function (r) {
      if (!r.ok) throw new Error('holdings unavailable'); return r.json();
    }), 12000).then(function (d) {
      var tokens = d && d.tokens || {};
      var list = Object.keys(tokens).map(function (mint) {
        var total = (tokens[mint] || []).reduce(function (n, a) { return n + (Number(a.uiAmount) || 0); }, 0);
        return { mint: mint, amount: total };
      }).filter(function (x) { return x.amount > 0; });
      if (!list.length) return null;
      return Promise.all([solTokensMany(list.map(function (x) { return x.mint; })), solPrice()]).then(function (r) {
        var info = r[0];
        list.forEach(function (x) {
          var ti = info[x.mint] || {};
          x.info = ti;
          x.usd = x.mint === WSOL ? x.amount * (r[1] || 0) : ti.usdPrice ? x.amount * ti.usdPrice : null;
        });
        list.sort(function (a, b) { return (b.usd || 0) - (a.usd || 0) || (b.info.symbol ? 1 : 0) - (a.info.symbol ? 1 : 0); });
        var solVal = d.uiAmount && r[1] ? d.uiAmount * r[1] : 0;
        var total = list.reduce(function (n, x) { return n + (x.usd || 0); }, solVal);
        return { list: list, total: total };
      });
    }).then(function (res) {
      var el = $('sol-holdings');
      if (!el || !res) return;
      var shown = res.list.slice(0, 20);
      var tmp = document.createElement('div');
      tmp.innerHTML = moveSection('Portfolio', 'Token holdings',
        res.list.length + ' token' + (res.list.length === 1 ? '' : 's') + (res.total ? ' · ' + usd(res.total) + ' total incl. SOL' : ''),
        shown.map(function (x) {
          var sym = x.mint === WSOL ? 'wSOL' : (x.info.symbol || short(x.mint, 4, 4));
          return moveRow({
            logo: x.mint === WSOL ? SOL_LOGO : x.info.icon, label: x.info.name || sym,
            amount: x.amount.toLocaleString('en-US', { maximumFractionDigits: x.amount >= 1 ? 4 : 8 }),
            symbol: link('sol', 'address', x.mint, sym, 'mv-symlink'), name: x.mint === WSOL ? 'Wrapped SOL' : x.info.name,
            right: '<b>' + (x.usd ? esc(usd(x.usd)) : '—') + '</b><small>value</small>'
          });
        }).concat(res.list.length > shown.length ? ['<p class="moves-more">' + (res.list.length - shown.length) + ' smaller holdings not shown</p>'] : []));
      el.innerHTML = tmp.firstChild.innerHTML;
      el.hidden = false;
    }).catch(function () {});
  }

  var B58 = /^[1-9A-HJ-NP-Za-km-z]+$/;
  function solSearch(q) {
    if (/^\d+$/.test(q)) return Promise.resolve({ view: 'block', id: q });
    if (B58.test(q) && q.length >= 32 && q.length <= 44) return Promise.resolve({ view: 'address', id: q });
    if (B58.test(q) && q.length >= 64 && q.length <= 90) return Promise.resolve({ view: 'tx', id: q });
    return Promise.reject(new Error('Enter a Solana address, transaction signature or slot number.'));
  }

  /* ═══════════════════════════ XRP Ledger ═══════════════════════════ */
  /* Public XRP Ledger JSON-RPC (xrplcluster.com, xrpl.ws as fallback; both
     allow browser requests, Ripple's own s1/s2 do not). Token names, icons
     and XRP prices come from XRPL Meta; the XRP/USD rate from Coinbase. */
  var XRPL = ['https://xrplcluster.com/', 'https://xrpl.ws/'];
  var RIPPLE_EPOCH = 946684800;   // ledger times count seconds from 2000-01-01
  var XR_ERR = {
    txnNotFound: 'No transaction with this hash was found on the XRP Ledger.',
    actNotFound: 'This address is not activated on the XRP Ledger. An address only exists once it has received its XRP reserve.',
    actMalformed: 'That is not a valid XRP Ledger address.',
    lgrNotFound: 'That ledger was not found. It may not be validated yet.',
    invalidParams: 'That search could not be read as an XRP Ledger address, transaction or ledger.'
  };
  function xr(method, params, i) {
    i = i || 0;
    return withTimeout(fetch(XRPL[i], {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ method: method, params: [params || {}] })
    }).then(function (r) { if (!r.ok) throw new Error(UNAVAILABLE); return r.json(); }), 12000)
      .then(function (d) {
        var res = d && d.result;
        if (!res) throw new Error(UNAVAILABLE);
        if (res.error) { var e = new Error(XR_ERR[res.error] || res.error_message || UNAVAILABLE); e.code = res.error; throw e; }
        return res;
      }, function (e) { if (i + 1 < XRPL.length) return xr(method, params, i + 1); throw e; });
  }
  function xrT(t) { return t === null || t === undefined ? null : Number(t) + RIPPLE_EPOCH; }
  function xrp(drops, signed) {
    if (drops === null || drops === undefined || !/^-?\d+$/.test(String(drops))) return '—';
    return (signed && Number(drops) > 0 ? '+' : '') + units(String(drops), 6, 6) + ' XRP';
  }
  /* Currency codes are three letters or 40 hex characters; the hex form is
     usually an ASCII name padded with zeros, or an AMM pool's LP token. */
  function curName(c) {
    if (!c) return '?';
    if (c.length !== 40 || !/^[0-9A-F]+$/i.test(c)) return c;
    if (/^03/.test(c)) return 'LP token';
    var s = '';
    for (var i = 0; i < 40; i += 2) { var n = parseInt(c.substr(i, 2), 16); if (n) s += String.fromCharCode(n); }
    return /^[\x20-\x7e]+$/.test(s) ? s.trim() : short(c, 4, 4);
  }
  function hexText(h) {
    try { return decodeURIComponent(String(h).replace(/(..)/g, '%$1')); } catch (e) { return null; }
  }
  /* An Amount is drops of XRP as a string, or { currency, issuer, value }. */
  function xrAmt(a) {
    if (a === null || a === undefined) return null;
    if (typeof a === 'string') return { xrp: true, cur: 'XRP', n: Number(a) / 1e6, text: units(a, 6, 6) };
    var n = Number(a.value);
    return { xrp: false, cur: curName(a.currency), code: a.currency, issuer: a.issuer, n: n,
      text: isFinite(n) ? n.toLocaleString('en-US', { maximumFractionDigits: Math.abs(n) >= 1 ? 6 : 10 }) : String(a.value) };
  }
  function amtText(a) { a = typeof a === 'object' && a && 'n' in a ? a : xrAmt(a); return a ? a.text + ' ' + a.cur : '—'; }
  function xrAddr(addr, cls) {
    if (!addr) return '—';
    return link('xrp', 'address', addr, short(addr, 6, 6), cls || 'chain-addr');
  }
  function txType(t) { return String(t || 'Transaction').replace(/([a-z])([A-Z])/g, '$1 $2'); }

  var xrpUsdP = null;
  function xrpUsd() {
    if (!xrpUsdP) xrpUsdP = withTimeout(fetch('https://api.coinbase.com/v2/prices/XRP-USD/spot').then(function (r) { return r.json(); }), 6000)
      .then(function (d) { var v = Number(d && d.data && d.data.amount); return isFinite(v) && v > 0 ? v : null; })
      .catch(function () { xrpUsdP = null; return null; });
    return xrpUsdP;
  }
  var xrTok = {};
  function tokenMeta(code, issuer) {
    var k = code + ':' + issuer;
    if (!xrTok[k]) xrTok[k] = withTimeout(fetch('https://s1.xrplmeta.org/token/' + encodeURIComponent(k)).then(function (r) {
      if (!r.ok) throw new Error('no meta'); return r.json();
    }), 6000).then(function (d) {
      var t = d && d.meta && d.meta.token || {}, iss = d && d.meta && d.meta.issuer || {};
      var px = Number(d && d.metrics && d.metrics.price);
      return { name: t.name || null, icon: t.icon || null, issuerName: iss.name || null, priceXrp: isFinite(px) && px > 0 ? px : null };
    }).catch(function () { return {}; });
    return xrTok[k];
  }
  function tokenMetas(list) {
    var seen = {}, keys = [];
    list.forEach(function (t) { var k = t.code + ':' + t.issuer; if (t.code && t.issuer && !seen[k]) { seen[k] = 1; keys.push(t); } });
    return Promise.all(keys.slice(0, 24).map(function (t) { return tokenMeta(t.code, t.issuer); })).then(function (r) {
      var out = {};
      keys.slice(0, 24).forEach(function (t, i) { out[t.code + ':' + t.issuer] = r[i]; });
      return out;
    });
  }

  /* ── overview ── */
  function xrpOverview() {
    $('xrp-metrics').innerHTML = [1, 2, 3, 4].map(function () { return '<div class="metric">' + S.skeleton(2, 16) + '</div>'; }).join('');
    $('xrp-blocks').innerHTML = '<div style="padding:20px">' + S.skeleton(6, 13) + '</div>';
    xr('server_info').then(function (si) {
      var vl = si.info && si.info.validated_ledger;
      if (!vl) throw new Error(UNAVAILABLE);
      var seqs = [0, 1, 2, 3, 4, 5].map(function (i) { return vl.seq - i; });
      return Promise.all(seqs.map(function (s) {
        return xr('ledger', { ledger_index: s, transactions: true, expand: false }).then(function (r) { return r.ledger; }).catch(function () { return null; });
      })).then(function (ls) { return { info: si.info, vl: vl, ledgers: ls }; });
    }).then(function (d) {
      var ls = d.ledgers.filter(Boolean), txs = 0;
      ls.slice(0, -1).forEach(function (l) { txs += (l.transactions || []).length; });
      var span = ls.length > 1 ? Number(ls[0].close_time) - Number(ls[ls.length - 1].close_time) : 0;
      var load = Number(d.info.load_factor) || 1;
      $('xrp-metrics').innerHTML =
        metric('Validated ledger', num(d.vl.seq), 'closes every 3–5 seconds') +
        metric('Throughput', span > 0 ? (txs / span).toFixed(1) + ' TPS' : '—', 'over the last ' + (ls.length - 1) + ' ledgers') +
        metric('Base fee', (d.vl.base_fee_xrp != null ? d.vl.base_fee_xrp : 0.00001) + ' XRP', load > 1 ? 'load factor ×' + load : 'per transaction, burned') +
        metric('Account reserve', (d.vl.reserve_base_xrp != null ? d.vl.reserve_base_xrp : 1) + ' XRP', '+' + (d.vl.reserve_inc_xrp != null ? d.vl.reserve_inc_xrp : 0.2) + ' XRP per owned object');
      $('xrp-blocks').innerHTML = '<div class="explorer-tablewrap"><table class="explorer-table"><caption class="sr">Latest XRP ledgers</caption>' +
        '<thead><tr><th>Ledger</th><th>Age</th><th>Transactions</th><th>XRP in existence</th><th>Ledger hash</th></tr></thead><tbody>' +
        ls.map(function (l) {
          var idx = Number(l.ledger_index);
          return '<tr data-xhref="./explorer.html?chain=xrp&view=block&id=' + idx + '">' +
            '<td data-label="Ledger">' + link('xrp', 'block', idx, num(idx), 'block-height') + '</td>' +
            '<td data-label="Age">' + esc(age(xrT(l.close_time))) + '</td>' +
            '<td data-label="Transactions">' + num((l.transactions || []).length) + '</td>' +
            '<td data-label="XRP in existence">' + esc(units(l.total_coins, 6, 0)) + '</td>' +
            '<td data-label="Ledger hash"><span class="chain-hash">' + esc(short(l.ledger_hash, 6, 6)) + '</span></td></tr>';
        }).join('') + '</tbody></table></div>';
    }).catch(function (e) {
      $('xrp-metrics').innerHTML = '<div class="card" style="grid-column:1/-1">' +
        S.errorState('Unable to load XRP Ledger data.', e.message, 'retry-xrp') + '</div>';
      $('xrp-blocks').innerHTML = '';
    });
  }

  /* ── transaction lists ── */
  var xrpPager = null;   // { kind: 'block', txs, shown } | { kind: 'address', addr, marker }
  function xrTxRows(list, withAge) {
    if (!list.length) return '<div style="padding:18px">' + S.emptyState('No transactions were returned.') + '</div>';
    return list.map(function (t) {
      var ok = t.meta && t.meta.TransactionResult === 'tesSUCCESS';
      return '<div class="transaction-row">' + link('xrp', 'tx', t.hash, short(t.hash, 14, 10)) +
        '<div class="tx-stat"><span>Type</span><b>' + esc(txType(t.TransactionType)) + '</b></div>' +
        '<div class="tx-stat"><span>Account</span><b>' + xrAddr(t.Account) + '</b></div>' +
        (withAge ? '<div class="tx-stat"><span>Age</span><b>' + esc(age(xrT(t.date))) + '</b></div>'
          : '<div class="tx-stat"><span>Result</span><b class="' + (ok ? '' : 'amount-negative') + '">' + (ok ? 'Success' : 'Failed') + '</b></div>') +
        '</div>';
    }).join('');
  }
  function xrpMore() {
    if (!xrpPager) return;
    var btn = $('xrp-more');
    if (xrpPager.kind === 'block') {
      var next = xrpPager.txs.slice(xrpPager.shown, xrpPager.shown + 25);
      xrpPager.shown += next.length;
      $('xrp-txlist').insertAdjacentHTML('beforeend', xrTxRows(next));
      if (xrpPager.shown >= xrpPager.txs.length && btn) btn.parentNode.remove();
      return;
    }
    if (btn) { btn.disabled = true; btn.textContent = 'Loading…'; }
    xr('account_tx', { account: xrpPager.addr, limit: 25, marker: xrpPager.marker }).then(function (r) {
      var list = (r.transactions || []).map(function (x) { var t = x.tx || x.tx_json || {}; t.meta = x.meta; return t; });
      $('xrp-txlist').insertAdjacentHTML('beforeend', xrTxRows(list, true));
      xrpPager.marker = r.marker || null;
      if (btn) { if (r.marker) { btn.disabled = false; btn.textContent = 'Show more'; } else btn.parentNode.remove(); }
    }).catch(function () { if (btn) { btn.disabled = false; btn.textContent = 'Try again'; } });
  }

  /* ── ledger ── */
  function xrpBlock(id) {
    setLoading('xrp', 'Loading ledger…');
    var q = /^\d+$/.test(String(id)) ? { ledger_index: Number(id) } : { ledger_hash: String(id).toUpperCase() };
    q.transactions = true; q.expand = true;
    xr('ledger', q).then(function (r) {
      var l = r.ledger, idx = Number(l.ledger_index);
      var txs = (l.transactions || []).map(function (t) { t.meta = t.metaData || t.meta; return t; })
        .sort(function (a, b) { return (a.meta ? a.meta.TransactionIndex : 0) - (b.meta ? b.meta.TransactionIndex : 0); });
      xrpPager = { kind: 'block', txs: txs, shown: Math.min(25, txs.length) };
      var prev = link('xrp', 'block', idx - 1, '← Previous Ledger', 'btn ghost small');
      var fresh = Date.now() / 1000 - xrT(l.close_time) < 12;
      var next = fresh ? '' : link('xrp', 'block', idx + 1, 'Next Ledger →', 'btn ghost small');
      var counts = {};
      txs.forEach(function (t) { counts[t.TransactionType] = (counts[t.TransactionType] || 0) + 1; });
      var mix = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; }).slice(0, 4)
        .map(function (k) { return num(counts[k]) + ' ' + txType(k); }).join(' · ');
      var html = '<div class="detail-shell"><div class="detail-topline">' + backLink('xrp') + '<div class="block-nav">' + prev + next + '</div></div>' +
        '<section class="card detail-card"><header><div><p class="eyebrow">XRP Ledger</p><h2>Ledger ' + num(idx) + '</h2></div>' +
        badge(true, 'Validated') + '</header><div class="detail-grid">' +
        field('Ledger index', num(idx)) + field('Ledger hash', hashLine(l.ledger_hash)) +
        field('Close time', esc(when(xrT(l.close_time)))) + field('Age', esc(age(xrT(l.close_time)))) +
        field('Transactions', num(txs.length)) + field('Mix', esc(mix || '—')) +
        field('XRP in existence', esc(xrp(l.total_coins))) + field('Close time resolution', num(l.close_time_resolution) + ' seconds') +
        field('Parent ledger', link('xrp', 'block', idx - 1, num(idx - 1))) + field('Parent hash', hashLine(l.parent_hash)) +
        '</div><details class="technical"><summary>Technical details</summary><dl>' +
        '<dt>Account state hash</dt><dd>' + esc(l.account_hash || '—') + '</dd>' +
        '<dt>Transaction tree hash</dt><dd>' + esc(l.transaction_hash || '—') + '</dd>' +
        '</dl></details></section>' +
        '<section class="card subcard"><header><div><p class="eyebrow">Included activity</p><h2>Transactions</h2></div>' +
        '<span class="section-meta">' + num(txs.length) + ' in this ledger, in execution order</span></header>' +
        '<div class="transaction-list" id="xrp-txlist">' + xrTxRows(txs.slice(0, 25)) + '</div>' +
        (txs.length > 25 ? moreButton('xrp-more') : '') + '</section></div>';
      showDetail('xrp', html, 'Ledger ' + idx);
    }).catch(function (e) { setError('xrp', 'Ledger not found.', e.message); });
  }

  /* ── balance changes, read from the ledger objects a transaction touched ── */
  function xrChanges(meta) {
    var out = [];
    (meta && meta.AffectedNodes || []).forEach(function (w) {
      var kind = Object.keys(w)[0], n = w[kind];
      var fin = n.FinalFields || n.NewFields || {}, prev = n.PreviousFields || {};
      if (n.LedgerEntryType === 'AccountRoot') {
        var after = kind === 'DeletedNode' ? '0' : fin.Balance, before = kind === 'CreatedNode' ? '0' : (prev.Balance !== undefined ? prev.Balance : null);
        if (kind === 'DeletedNode') before = prev.Balance !== undefined ? prev.Balance : fin.Balance;
        if (before === null || after === undefined) return;
        var d = BigInt(after) - BigInt(before);
        if (d !== BigInt(0)) out.push({ xrp: true, account: fin.Account, d: d });
      } else if (n.LedgerEntryType === 'RippleState') {
        var fb = Number(fin.Balance && fin.Balance.value || 0);
        var pb = kind === 'CreatedNode' ? 0 : Number(prev.Balance ? prev.Balance.value : fb);
        if (kind === 'DeletedNode' && prev.Balance) { pb = Number(prev.Balance.value); fb = 0; }
        var dt = fb - pb;
        if (!dt || !fin.LowLimit || !fin.HighLimit) return;
        /* Positive balance: the low account holds tokens the high account
           issued. Report the holder's side. */
        var lowHolds = (fb || pb) > 0;
        out.push({
          xrp: false, code: fin.Balance.currency, cur: curName(fin.Balance.currency),
          account: lowHolds ? fin.LowLimit.issuer : fin.HighLimit.issuer,
          issuer: lowHolds ? fin.HighLimit.issuer : fin.LowLimit.issuer,
          d: lowHolds ? dt : -dt
        });
      }
    });
    return out;
  }

  /* ── transaction ── */
  function xrpTx(hash) {
    setLoading('xrp', 'Loading transaction…');
    xr('tx', { transaction: String(hash).toUpperCase() }).then(function (t) {
      var tj = t.tx_json || t, meta = t.meta || t.metaData || {};
      var ok = meta.TransactionResult === 'tesSUCCESS', code = meta.TransactionResult || '—';
      var date = xrT(t.date || tj.date), changes = xrChanges(meta);
      var toks = changes.filter(function (c) { return !c.xrp; });
      var ga = xrAmt(tj.TakerGets), pa = xrAmt(tj.TakerPays), am = xrAmt(tj.Amount || tj.DeliverMax);
      [ga, pa, am, xrAmt(meta.delivered_amount), xrAmt(tj.LimitAmount)].forEach(function (a) { if (a && !a.xrp) toks.push(a); });
      return Promise.all([xrpUsd(), tokenMetas(toks)]).then(function (px) {
        var usdRate = px[0], metas = px[1];
        var tokName = function (code, issuer) { var m = metas[code + ':' + issuer]; return m && m.name; };
        var tokUsd = function (code, issuer, n) { var m = metas[code + ':' + issuer]; return m && m.priceXrp && usdRate ? Math.abs(n) * m.priceXrp * usdRate : null; };
        var A = function (a) { return a ? '<b>' + esc(amtText(a)) + '</b>' : '—'; };

        /* One plain-English line for what the transaction did. */
        var type = tj.TransactionType, acts = [];
        if (type === 'Payment') {
          var del = xrAmt(meta.delivered_amount && meta.delivered_amount !== 'unavailable' ? meta.delivered_amount : (tj.Amount || tj.DeliverMax));
          if (tj.Account === tj.Destination) {
            var spent = changes.filter(function (c) { return c.account === tj.Account && (c.xrp ? c.d < BigInt(0) : c.d < 0); })
              .filter(function (c) { return !(c.xrp && del && del.xrp); })[0];
            acts.push('Converted ' + (spent ? '<b>' + esc((spent.xrp ? units((-spent.d).toString(), 6, 6) : Math.abs(spent.d).toLocaleString('en-US', { maximumFractionDigits: 6 })) + ' ' + (spent.xrp ? 'XRP' : spent.cur)) + '</b> into ' : 'funds into ') + A(del) + ' through the DEX');
          } else {
            acts.push('Sent ' + A(del) + ' from ' + xrAddr(tj.Account) + ' to ' + xrAddr(tj.Destination) +
              (tj.DestinationTag !== undefined ? ' (destination tag ' + esc(String(tj.DestinationTag)) + ')' : ''));
          }
        } else if (type === 'OfferCreate') {
          var filled = (meta.AffectedNodes || []).some(function (w) { var k = Object.keys(w)[0]; return w[k].LedgerEntryType === 'Offer' && w[k].FinalFields && w[k].FinalFields.Account !== tj.Account; });
          acts.push('Placed a DEX order to sell ' + A(ga) + ' for ' + A(pa) + (filled ? ', filled at least in part against existing orders' : ''));
        } else if (type === 'OfferCancel') {
          acts.push('Cancelled DEX order #' + esc(String(tj.OfferSequence)));
        } else if (type === 'TrustSet') {
          var la = xrAmt(tj.LimitAmount);
          acts.push((la && la.n === 0 ? 'Removed the trust line for ' : 'Opened a trust line for ') + '<b>' + esc(la ? la.cur : '?') + '</b> issued by ' + xrAddr(la && la.issuer) +
            (la && la.n ? ' (limit ' + esc(la.text) + ')' : ''));
        } else if (type === 'AccountSet') {
          acts.push('Updated settings on ' + xrAddr(tj.Account));
        } else if (/^AMM/.test(type)) {
          acts.push(esc(txType(type)) + ' on an automated market maker pool' + (am ? ': ' + A(am) : ''));
        } else if (type === 'EscrowCreate') {
          acts.push('Locked ' + A(am) + ' in escrow for ' + xrAddr(tj.Destination));
        } else {
          acts.push(esc(txType(type)) + ' by ' + xrAddr(tj.Account));
        }
        if (!ok) acts.push('Did not succeed: result <b>' + esc(code) + '</b>' + (/^tec/.test(code) ? '; the fee was still charged' : ''));

        var feeN = Number(tj.Fee) / 1e6;
        var moves = changes.map(function (c) {
          if (c.xrp) {
            var abs = c.d < BigInt(0) ? -c.d : c.d;
            return moveRow({ logo: XRP_LOGO, label: 'XRP', amount: (c.d > BigInt(0) ? '+' : '−') + units(abs.toString(), 6, 6), symbol: 'XRP', name: 'XRP',
              usd: usdRate ? Number(abs) / 1e6 * usdRate : null, tone: c.d > BigInt(0) ? 'amount-positive' : 'amount-negative',
              parties: [['Account', xrAddr(c.account)]] });
          }
          var m = metas[c.code + ':' + c.issuer] || {};
          return moveRow({ logo: m.icon, label: m.name || c.cur, amount: (c.d > 0 ? '+' : '−') + Math.abs(c.d).toLocaleString('en-US', { maximumFractionDigits: 6 }),
            symbol: esc(c.cur), name: m.name || ('Issued by ' + short(c.issuer, 5, 4)), usd: tokUsd(c.code, c.issuer, c.d),
            tone: c.d > 0 ? 'amount-positive' : 'amount-negative', parties: [['Holder', xrAddr(c.account)], ['Issuer', xrAddr(c.issuer)]] });
        });
        var memos = (tj.Memos || []).map(function (m) { var d = m.Memo && m.Memo.MemoData && hexText(m.Memo.MemoData); return d && /^[\s\S]{1,300}$/.test(d) && !/[\x00-\x08]/.test(d) ? d : null; }).filter(Boolean);
        var idx = Number(t.ledger_index || tj.ledger_index);

        var html = '<div class="detail-shell"><div class="detail-topline">' + backLink('xrp') + '</div>' +
          '<section class="card detail-card"><header><div><p class="eyebrow">XRP Ledger transaction</p><h2>' + esc(txType(type)) + '</h2></div>' +
          badge(ok, ok ? 'Success' : 'Failed') + '</header>' +
          '<div class="tx-summary"><span class="tx-summary-k">Summary</span><ul>' + acts.map(function (a) { return '<li>' + a + '</li>'; }).join('') + '</ul></div>' +
          '<div class="detail-grid">' +
          field('Transaction hash', hashLine(tj.hash || t.hash)) + field('Result', esc(ok ? 'Success' : 'Failed') + ' <span class="muted">(' + esc(code) + ')</span>') +
          field('Ledger', isFinite(idx) ? link('xrp', 'block', idx, num(idx)) : '—') + field('Timestamp', esc(when(date)) + ' · ' + esc(age(date))) +
          field('Type', esc(txType(type))) + field('Account', xrAddr(tj.Account)) +
          (tj.Destination ? field('Destination', xrAddr(tj.Destination)) : '') +
          (tj.DestinationTag !== undefined ? field('Destination tag', esc(String(tj.DestinationTag))) : '') +
          (type === 'Payment' ? field('Delivered', A(xrAmt(meta.delivered_amount && meta.delivered_amount !== 'unavailable' ? meta.delivered_amount : tj.Amount))) : '') +
          (type === 'OfferCreate' ? field('Selling', A(ga)) + field('Buying', A(pa)) : '') +
          field('Fee', esc(xrp(tj.Fee)) + (usdRate ? ' <span class="muted">(' + esc(feeN * usdRate < 0.0001 ? '<$0.0001' : usd(feeN * usdRate)) + ')</span>' : '')) +
          field('Sequence', tj.Sequence ? num(tj.Sequence) : (tj.TicketSequence ? 'Ticket ' + num(tj.TicketSequence) : '—')) +
          (memos.length ? field('Memo', memos.map(esc).join('<br>')) : '') +
          '</div><details class="technical"><summary>Technical details</summary><dl>' +
          '<dt>Result code</dt><dd>' + esc(code) + '</dd>' +
          '<dt>Position in ledger</dt><dd>' + esc(meta.TransactionIndex !== undefined ? String(meta.TransactionIndex) : '—') + '</dd>' +
          '<dt>Last ledger sequence</dt><dd>' + esc(tj.LastLedgerSequence !== undefined ? String(tj.LastLedgerSequence) : '—') + '</dd>' +
          '<dt>Flags</dt><dd>' + esc(tj.Flags !== undefined ? String(tj.Flags) : '0') + '</dd>' +
          '<dt>Signing public key</dt><dd>' + esc(tj.SigningPubKey || '—') + '</dd>' +
          '<dt>Ledger objects touched</dt><dd>' + num((meta.AffectedNodes || []).length) + '</dd>' +
          '</dl></details></section>' +
          (moves.length ? moveSection('Balance changes', 'Assets moved', num(moves.length) + (moves.length === 1 ? ' change' : ' changes') + ' · fees included', moves) : '') +
          '<section class="card education ' + (ok ? '' : 'pending-card') + '">' +
          (ok ? '<h2>Transaction validated</h2><p>Included in validated ledger ' + num(idx) + '. The XRP Ledger closes a new ledger every three to five seconds, and a validated ledger is final: it cannot be reorganised.</p>'
              : '<h2>Transaction failed</h2><p>This transaction was included in ledger ' + num(idx) + ' with result ' + esc(code) + ', so it did not do what it asked. ' + (/^tec/.test(code) ? 'The transaction fee was still burned.' : '') + '</p>') +
          '</section></div>';
        showDetail('xrp', html, short(tj.hash || hash, 10, 8));
      });
    }).catch(function (e) { setError('xrp', 'Transaction not found.', e.message); });
  }

  /* ── address ── */
  function xrpAddress(addr) {
    setLoading('xrp', 'Loading address…');
    Promise.all([
      xr('account_info', { account: addr, ledger_index: 'validated', signer_lists: false }).catch(function (e) { if (e.code === 'actNotFound') return null; throw e; }),
      xr('account_tx', { account: addr, limit: 25 }).catch(function () { return { transactions: [] }; }),
      xr('account_lines', { account: addr, ledger_index: 'validated', limit: 400 }).catch(function () { return { lines: [] }; }),
      xr('server_info').catch(function () { return null; })
    ]).then(function (r) {
      var info = r[0], hist = r[1], lines = r[2].lines || [], vl = r[3] && r[3].info && r[3].info.validated_ledger;
      if (!info) throw new Error(XR_ERR.actNotFound);
      var ad = info.account_data, flags = info.account_flags || {};
      var base = vl ? vl.reserve_base_xrp : 1, inc = vl ? vl.reserve_inc_xrp : 0.2;
      var reserve = base + inc * (ad.OwnerCount || 0), bal = Number(ad.Balance) / 1e6;
      var issued = lines.filter(function (l) { return Number(l.balance) < 0; }).length;
      var kind = issued > 0 && issued >= lines.length / 2 ? 'Token issuer' : 'Account';
      var list = (hist.transactions || []).map(function (x) { var t = x.tx || x.tx_json || {}; t.meta = x.meta; if (!t.hash && x.hash) t.hash = x.hash; return t; });
      xrpPager = { kind: 'address', addr: addr, marker: hist.marker || null };
      var domain = ad.Domain ? hexText(ad.Domain) : null;
      var html = '<div class="detail-shell"><div class="detail-topline">' + backLink('xrp') + '</div>' +
        '<section class="card detail-card"><header><div><p class="eyebrow">XRP Ledger ' + esc(kind.toLowerCase()) + '</p><h2>' + esc(domain || 'Address') + '</h2></div></header><div class="detail-grid">' +
        field('Address', hashLine(addr)) + field('Type', esc(kind)) +
        field('XRP balance', esc(xrp(ad.Balance)) + '<span class="muted" id="xrp-bal-usd"></span>') +
        field('Reserved', esc(reserve.toLocaleString('en-US', { maximumFractionDigits: 6 }) + ' XRP') + ' <span class="muted">(' + base + ' base + ' + inc + ' × ' + num(ad.OwnerCount || 0) + ' objects)</span>') +
        field('Available', esc(Math.max(0, bal - reserve).toLocaleString('en-US', { maximumFractionDigits: 6 }) + ' XRP')) +
        field('Trust lines', num(lines.length)) +
        field('Destination tag', flags.requireDestinationTag ? 'Required' : 'Not required') +
        field('Sequence', num(ad.Sequence)) +
        (domain ? field('Domain', esc(domain)) : '') +
        (flags.disableMasterKey ? field('Master key', 'Disabled') : '') +
        '</div></section><p class="srcnote privacy-note">XRP Ledger addresses and transactions are public blockchain data. Searching an address does not identify its owner.</p>' +
        '<section class="card subcard" id="xrp-holdings" hidden></section>' +
        '<section class="card subcard"><header><div><p class="eyebrow">Recent activity</p><h2>Transaction history</h2></div>' +
        '<span class="section-meta">Most recent first</span></header>' +
        '<div class="transaction-list" id="xrp-txlist">' + xrTxRows(list, true) + '</div>' +
        (hist.marker ? moreButton('xrp-more') : '') + '</section></div>';
      showDetail('xrp', html, short(addr, 12, 8));
      xrpUsd().then(function (p) { var el = $('xrp-bal-usd'); if (el && p) el.textContent = ' (' + usd(bal * p) + ')'; });
      xrpHoldings(lines, bal);
    }).catch(function (e) { setError('xrp', 'Address not found.', e.message); });
  }
  /* Tokens the account holds (positive trust-line balances), valued from
     XRPL Meta's XRP price where it has one. */
  function xrpHoldings(lines, xrpBal) {
    var held = lines.filter(function (l) { return Number(l.balance) > 0; })
      .map(function (l) { return { code: l.currency, issuer: l.account, cur: curName(l.currency), n: Number(l.balance) }; });
    if (!held.length) return;
    Promise.all([xrpUsd(), tokenMetas(held)]).then(function (r) {
      var rate = r[0], metas = r[1];
      held.forEach(function (h) { var m = metas[h.code + ':' + h.issuer] || {}; h.meta = m; h.usd = m.priceXrp && rate ? h.n * m.priceXrp * rate : null; });
      held.sort(function (a, b) { return (b.usd || 0) - (a.usd || 0) || b.n - a.n; });
      var total = held.reduce(function (s, h) { return s + (h.usd || 0); }, rate ? xrpBal * rate : 0);
      var el = $('xrp-holdings');
      if (!el) return;
      var shown = held.slice(0, 20);
      var tmp = document.createElement('div');
      tmp.innerHTML = moveSection('Portfolio', 'Token holdings',
        held.length + ' token' + (held.length === 1 ? '' : 's') + (total ? ' · ' + usd(total) + ' total incl. XRP' : ''),
        shown.map(function (h) {
          return moveRow({ logo: h.meta.icon, label: h.meta.name || h.cur,
            amount: h.n.toLocaleString('en-US', { maximumFractionDigits: h.n >= 1 ? 4 : 8 }), symbol: esc(h.cur),
            name: h.meta.name || null, parties: [['Issuer', xrAddr(h.issuer)]],
            right: '<b>' + (h.usd ? esc(usd(h.usd)) : '—') + '</b><small>value</small>' });
        }).concat(held.length > shown.length ? ['<p class="moves-more">' + (held.length - shown.length) + ' more not shown</p>'] : []));
      el.innerHTML = tmp.firstChild.innerHTML;
      el.hidden = false;
    }).catch(function () {});
  }

  var XR_ADDR = /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/;
  function xrpSearch(q) {
    if (/^\d+$/.test(q)) return Promise.resolve({ view: 'block', id: q });
    if (XR_ADDR.test(q)) return Promise.resolve({ view: 'address', id: q });
    if (/^[0-9A-Fa-f]{64}$/.test(q)) {
      return xr('tx', { transaction: q.toUpperCase() }).then(function () { return { view: 'tx', id: q.toUpperCase() }; }, function (e) {
        if (e.code !== 'txnNotFound') throw e;
        return xr('ledger', { ledger_hash: q.toUpperCase() }).then(function () { return { view: 'block', id: q.toUpperCase() }; }, function () {
          throw new Error('No transaction or ledger with this hash was found on the XRP Ledger.');
        });
      });
    }
    return Promise.reject(new Error('Enter an XRP Ledger address (starting with r), a transaction hash or a ledger number.'));
  }

  /* ═══════════════════════════ routing ══════════════════════════════ */
  var VIEWS = {
    eth: { block: ethBlock, tx: ethTx, address: ethAddress, overview: ethOverview, search: ethSearch },
    sol: { block: solBlock, tx: solTx, address: solAddress, overview: solOverview, search: solSearch },
    xrp: { block: xrpBlock, tx: xrpTx, address: xrpAddress, overview: xrpOverview, search: xrpSearch }
  };
  var CHAINS = ['btc', 'eth', 'sol', 'xrp'];
  var TITLES = { btc: 'Bitcoin Explorer', eth: 'Ethereum Explorer', sol: 'Solana Explorer', xrp: 'XRP Ledger Explorer' };
  var overviewLoaded = {};

  function setTab(chain) {
    CHAINS.forEach(function (c) {
      var on = c === chain;
      $('chain-tab-' + c).setAttribute('aria-selected', String(on));
      $('chain-tab-' + c).tabIndex = on ? 0 : -1;
      $('chain-' + c).hidden = !on;
    });
  }

  function route(chain, view, id, push) {
    if (CHAINS.indexOf(chain) < 0) chain = 'btc';
    if (push) {
      var url = chain === 'btc' ? './explorer.html'
        : './explorer.html?chain=' + chain + (view && id ? '&view=' + encodeURIComponent(view) + '&id=' + encodeURIComponent(id) : '');
      history.pushState({}, '', url);
      /* Back on Bitcoin: let explorer.js show its own overview. */
      if (chain === 'btc') window.dispatchEvent(new PopStateEvent('popstate'));
    }
    setTab(chain);
    if (chain === 'btc') return;
    $(chain + '-search-error').hidden = true;
    var v = VIEWS[chain];
    if (view && id && v[view]) return v[view](id);
    showOverviewPanel(chain);
    document.title = 'Satstreet · ' + TITLES[chain];
    if (!overviewLoaded[chain]) { overviewLoaded[chain] = true; v.overview(); }
  }

  function fromLocation() {
    var p = new URLSearchParams(location.search);
    var chain = p.get('chain');
    if (chain === 'eth' || chain === 'sol' || chain === 'xrp') route(chain, p.get('view'), p.get('id'), false);
    else setTab('btc');
  }

  /* chain tabs */
  var tabs = $('chain-tabs');
  tabs.addEventListener('click', function (e) {
    var b = e.target.closest('[data-chain]');
    if (b && b.getAttribute('aria-selected') !== 'true') route(b.getAttribute('data-chain'), null, null, true);
  });
  tabs.addEventListener('keydown', function (e) {
    var i = CHAINS.indexOf(document.activeElement.getAttribute('data-chain'));
    if (i < 0) return;
    var n = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : -1;
    if (n === -1) return;
    e.preventDefault();
    n = (n + CHAINS.length) % CHAINS.length;
    route(CHAINS[n], null, null, true); $('chain-tab-' + CHAINS[n]).focus();
  });

  /* search boxes */
  ['eth', 'sol', 'xrp'].forEach(function (chain) {
    $(chain + '-search-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var input = $(chain + '-query'), btn = $(chain + '-search-button'), err = $(chain + '-search-error');
      var q = input.value.trim();
      err.hidden = true;
      if (!q) { err.textContent = 'Enter something to search for.'; err.hidden = false; input.focus(); return; }
      btn.disabled = true; btn.textContent = 'Searching…';
      VIEWS[chain].search(q).then(function (r) { route(chain, r.view, r.id, true); })
        .catch(function (x) { err.textContent = x.message; err.hidden = false; })
        .then(function () { btn.disabled = false; btn.textContent = 'Search'; });
    });
  });

  /* in-page links, show-more, retries */
  document.addEventListener('click', function (e) {
    var a = e.target.closest('a[data-xroute]');
    if (a) {
      if (e.metaKey || e.ctrlKey || e.shiftKey) return;   // let new-tab clicks through
      e.preventDefault();
      var u = new URL(a.href);
      route(u.searchParams.get('chain'), u.searchParams.get('view'), u.searchParams.get('id'), true);
      return;
    }
    var home = e.target.closest('[data-xhome]');
    if (home) { e.preventDefault(); route(home.getAttribute('data-xhome'), null, null, true); return; }
    var row = e.target.closest('tr[data-xhref]');
    if (row && !e.target.closest('a,button')) {
      var r = new URL(row.getAttribute('data-xhref'), location.href);
      route(r.searchParams.get('chain'), r.searchParams.get('view'), r.searchParams.get('id'), true);
      return;
    }
    if (e.target.id === 'eth-more') ethMore();
    if (e.target.id === 'sol-more') solMore();
    if (e.target.id === 'xrp-more') xrpMore();
    if (e.target.id === 'retry-eth') ethOverview();
    if (e.target.id === 'retry-sol') solOverview();
    if (e.target.id === 'retry-xrp') xrpOverview();
  });
  $('eth-refresh').addEventListener('click', ethOverview);
  $('sol-refresh').addEventListener('click', solOverview);
  $('xrp-refresh').addEventListener('click', xrpOverview);

  window.addEventListener('popstate', fromLocation);
  fromLocation();
})();
