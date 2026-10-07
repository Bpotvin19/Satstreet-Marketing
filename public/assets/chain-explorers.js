/* Ethereum and Solana on the Explorer page.

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

  function tokenAmount(t) {
    if (!t.total) return '—';
    if (t.total.value === undefined) return t.total.token_id ? '#' + short(t.total.token_id, 8, 4) : '—';
    var v = units(t.total.value, t.total.decimals || (t.token && t.token.decimals) || 0, 6);
    return (v === null ? '—' : v) + ' ' + ((t.token && t.token.symbol) || '');
  }

  function ethTx(hash) {
    setLoading('eth', 'Loading transaction…');
    bs('transactions/' + encodeURIComponent(hash)).then(function (t) {
      var ok = t.result === 'success' || t.status === 'ok';
      var pending = t.result === 'pending' || !t.block_number;
      var gasPct = t.gas_limit && t.gas_used ? ' (' + (Number(t.gas_used) / Number(t.gas_limit) * 100).toFixed(1) + '%)' : '';
      var transfers = t.token_transfers || [];
      var tt = transfers.length
        ? '<section class="card subcard"><header><div><p class="eyebrow">Tokens moved</p><h2>Token transfers</h2></div>' +
          '<span class="section-meta">' + num(transfers.length) + (t.token_transfers_overflow ? '+' : '') + '</span></header><div class="transaction-list">' +
          transfers.map(function (x) {
            return '<div class="transaction-row token-row"><div class="tx-stat"><span>Token</span><b>' +
              (x.token ? link('eth', 'address', x.token.address_hash || x.token.address, x.token.name || x.token.symbol || short(x.token.address_hash, 8, 6)) : '—') + '</b></div>' +
              '<div class="tx-stat"><span>From</span><b>' + ethAddr(x.from) + '</b></div>' +
              '<div class="tx-stat"><span>To</span><b>' + ethAddr(x.to) + '</b></div>' +
              '<div class="tx-stat"><span>Amount</span><b>' + esc(tokenAmount(x)) + '</b></div></div>';
          }).join('') + '</div></section>'
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
        '<section class="card detail-card"><header><div><p class="eyebrow">Ethereum ' + esc(kind.toLowerCase()) + '</p><h2>' +
          esc(a.ens_domain_name || a.name || 'Address') + '</h2></div>' +
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
      el.innerHTML = '<header><div><p class="eyebrow">Holdings</p><h2>Tokens</h2></div><span class="section-meta">Largest ' + rows.length + ' by value</span></header>' +
        '<div class="transaction-list">' + rows.map(function (x) {
          return '<div class="transaction-row token-row"><div class="tx-stat"><span>Token</span><b>' +
            link('eth', 'address', x.t.address_hash || x.t.address, x.t.name || x.t.symbol || 'Token') + '</b></div>' +
            '<div class="tx-stat"><span>Symbol</span><b>' + esc(x.t.symbol || '—') + '</b></div>' +
            '<div class="tx-stat"><span>Balance</span><b>' + esc(x.amt) + '</b></div>' +
            '<div class="tx-stat"><span>Value</span><b>' + (x.usd === null ? '—' : esc(S.fmt.money(x.usd, 'USD', 2))) + '</b></div></div>';
        }).join('') + '</div>';
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
    'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s': 'Metaplex Token Metadata'
  };
  function programName(id) { return PROGRAMS[id] || null; }
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
          return call(i, 'getBlock', [s, { transactionDetails: 'signatures', rewards: true, maxSupportedTransactionVersion: 0, commitment: 'finalized' }]);
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
      call(0, 'getBlock', [slot, { transactionDetails: 'signatures', rewards: true, maxSupportedTransactionVersion: 0, commitment: 'finalized' }]),
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

  function solTx(sig) {
    setLoading('sol', 'Loading transaction…');
    rpc(call(1, 'getTransaction', [sig, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0, commitment: 'confirmed' }])).then(function (t) {
      if (!t) throw new Error('No transaction with that signature was found.');
      var meta = t.meta || {}, msg = t.transaction.message, keys = msg.accountKeys || [];
      var ok = !meta.err;
      var signers = keys.filter(function (k) { return k.signer; }).map(function (k) { return k.pubkey; });

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

      var ixs = (msg.instructions || []).map(function (ix) {
        var name = programName(ix.programId) || ix.program || short(ix.programId, 6, 6);
        return '<div class="transaction-row ix-row"><div class="tx-stat"><span>Program</span><b>' + solAddr(ix.programId).replace(/>[^<]*</, '>' + esc(name) + '<') + '</b></div>' +
          '<div class="tx-stat"><span>Instruction</span><b>' + esc(ix.parsed && ix.parsed.type ? ix.parsed.type : 'Program call') + '</b></div></div>';
      }).join('');

      var html = '<div class="detail-shell"><div class="detail-topline">' + backLink('sol') + '</div>' +
        '<section class="card detail-card"><header><div><p class="eyebrow">Solana transaction</p><h2>Transaction</h2></div>' +
        badge(ok, ok ? 'Success' : 'Failed') + '</header><div class="detail-grid">' +
        field('Signature', hashLine(sig)) + field('Status', ok ? 'Success' : 'Failed') +
        field('Slot', link('sol', 'block', t.slot, num(t.slot))) + field('Timestamp', esc(when(t.blockTime))) +
        field('Age', esc(age(t.blockTime))) + field('Fee', esc(sol(meta.fee))) +
        field('Fee payer', solAddr(keys[0] && keys[0].pubkey)) + field('Signers', num(signers.length)) +
        field('Compute units', num(meta.computeUnitsConsumed)) + field('Version', esc(String(t.version))) +
        field('Instructions', num((msg.instructions || []).length)) + field('Accounts', num(keys.length)) +
        '</div><details class="technical"><summary>Technical details</summary><dl>' +
        '<dt>Recent blockhash</dt><dd>' + esc(msg.recentBlockhash || '—') + '</dd>' +
        (meta.err ? '<dt>Error</dt><dd>' + esc(JSON.stringify(meta.err)) + '</dd>' : '') +
        '<dt>Log messages</dt><dd class="logs">' + ((meta.logMessages || []).slice(0, 40).map(esc).join('<br>') || '—') + '</dd>' +
        '</dl></details></section>' +
        (solChanges.length ? '<section class="card subcard"><header><div><p class="eyebrow">Balance changes</p><h2>SOL moved</h2></div></header><div class="transaction-list">' +
          solChanges.map(function (x) {
            return '<div class="transaction-row change-row"><div class="tx-stat"><span>Account</span><b>' + solAddr(x.pk) + '</b></div>' +
              '<div class="tx-stat"><span>Change</span><b class="' + (x.d > 0 ? 'amount-positive' : 'amount-negative') + '">' + esc(sol(x.d, true)) + '</b></div></div>';
          }).join('') + '</div></section>' : '') +
        (tokChanges.length ? '<section class="card subcard"><header><div><p class="eyebrow">Balance changes</p><h2>Tokens moved</h2></div></header><div class="transaction-list">' +
          tokChanges.map(function (x) {
            var d = x.post - x.pre, v = units(d.toString(), x.dec, 6);
            return '<div class="transaction-row token-row"><div class="tx-stat"><span>Owner</span><b>' + solAddr(x.owner) + '</b></div>' +
              '<div class="tx-stat"><span>Token mint</span><b>' + solAddr(x.mint) + '</b></div>' +
              '<div class="tx-stat"><span>Change</span><b class="' + (d > 0 ? 'amount-positive' : 'amount-negative') + '">' + (d > 0 ? '+' : '') + esc(v) + '</b></div>' +
              '<div class="tx-stat"><span>Balance after</span><b>' + esc(units(x.post.toString(), x.dec, 6)) + '</b></div></div>';
          }).join('') + '</div></section>' : '') +
        '<section class="card subcard"><header><div><p class="eyebrow">What it did</p><h2>Instructions</h2></div></header><div class="transaction-list">' +
          (ixs || '<div style="padding:18px">' + S.emptyState('No instructions.') + '</div>') + '</div></section>' +
        '<section class="card education ' + (ok ? '' : 'pending-card') + '">' +
        (ok ? '<h2>Transaction confirmed</h2><p>Included in slot ' + num(t.slot) + '. Solana produces a block roughly every 400 milliseconds, and a block is finalized once a supermajority of stake has voted on it, usually within seconds.</p>'
            : '<h2>Transaction failed</h2><p>This transaction was included in slot ' + num(t.slot) + ' but did not execute successfully. The fee was still charged.</p>') +
        '</section></div>';
      showDetail('sol', html, short(sig, 10, 8));
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
        '<section class="card detail-card"><header><div><p class="eyebrow">Solana ' + esc(kind.toLowerCase()) + '</p><h2>' +
          esc(programName(pk) || 'Address') + '</h2></div></header><div class="detail-grid">' +
        field('Address', hashLine(pk)) + field('Type', esc(kind)) +
        field('SOL balance', esc(sol(info ? info.lamports : 0))) +
        field('Owner program', info ? solAddr(info.owner) : '—') +
        field('Data size', info ? num(info.space !== undefined ? info.space : 0) + ' bytes' : '—') +
        field('Executable', info ? (info.executable ? 'Yes' : 'No') : '—') + extra +
        '</div></section><p class="srcnote privacy-note">Solana addresses and transactions are public blockchain data. Searching an address does not identify its owner.</p>' +
        '<section class="card subcard"><header><div><p class="eyebrow">Recent activity</p><h2>Transaction history</h2></div>' +
        '<span class="section-meta">Most recent first</span></header>' +
        '<div class="transaction-list" id="sol-txlist">' + solSigRows(sigs) + '</div>' +
        (sigs.length === 25 ? moreButton('sol-more') : '') + '</section></div>';
      showDetail('sol', html, short(pk, 12, 8));
    }).catch(function (e) { setError('sol', 'Address not found.', e.message); });
  }

  var B58 = /^[1-9A-HJ-NP-Za-km-z]+$/;
  function solSearch(q) {
    if (/^\d+$/.test(q)) return Promise.resolve({ view: 'block', id: q });
    if (B58.test(q) && q.length >= 32 && q.length <= 44) return Promise.resolve({ view: 'address', id: q });
    if (B58.test(q) && q.length >= 64 && q.length <= 90) return Promise.resolve({ view: 'tx', id: q });
    return Promise.reject(new Error('Enter a Solana address, transaction signature or slot number.'));
  }

  /* ═══════════════════════════ routing ══════════════════════════════ */
  var VIEWS = {
    eth: { block: ethBlock, tx: ethTx, address: ethAddress, overview: ethOverview, search: ethSearch },
    sol: { block: solBlock, tx: solTx, address: solAddress, overview: solOverview, search: solSearch }
  };
  var CHAINS = ['btc', 'eth', 'sol'];
  var TITLES = { btc: 'Bitcoin Explorer', eth: 'Ethereum Explorer', sol: 'Solana Explorer' };
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
    var v = VIEWS[chain];
    if (view && id && v[view]) return v[view](id);
    showOverviewPanel(chain);
    document.title = 'Satstreet · ' + TITLES[chain];
    if (!overviewLoaded[chain]) { overviewLoaded[chain] = true; v.overview(); }
  }

  function fromLocation() {
    var p = new URLSearchParams(location.search);
    var chain = p.get('chain');
    if (chain === 'eth' || chain === 'sol') route(chain, p.get('view'), p.get('id'), false);
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
  ['eth', 'sol'].forEach(function (chain) {
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
    if (e.target.id === 'retry-eth') ethOverview();
    if (e.target.id === 'retry-sol') solOverview();
  });
  $('eth-refresh').addEventListener('click', ethOverview);
  $('sol-refresh').addEventListener('click', solOverview);

  window.addEventListener('popstate', fromLocation);
  fromLocation();
})();
