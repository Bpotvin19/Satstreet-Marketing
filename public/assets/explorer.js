(function () {
  'use strict';

  var S = window.SATSTREET;
  var $ = function (id) { return document.getElementById(id); };
  var esc = S.esc;
  /* Explorer has its own nav entry on this branch. It used to mount as
     'Structure' because it had no tab of its own to light up. */
  S.mountHeader('Explorer');

  function attr(value) {
    return esc(value).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function short(value, start, end) {
    value = String(value || '');
    if (value.length <= (start || 10) + (end || 8) + 3) return value;
    return value.slice(0, start || 10) + '…' + value.slice(-(end || 8));
  }

  function age(timestamp) {
    var seconds = Math.max(0, Math.floor(Date.now() / 1000 - Number(timestamp || 0)));
    if (!timestamp) return 'Unavailable';
    if (seconds < 60) return seconds + ' sec ago';
    var minutes = Math.floor(seconds / 60);
    if (minutes < 60) return minutes + ' min ago';
    var hours = Math.floor(minutes / 60);
    if (hours < 24) return hours + ' hr ago';
    var days = Math.floor(hours / 24);
    return days + ' day' + (days === 1 ? '' : 's') + ' ago';
  }

  function dateTime(timestamp) {
    if (!timestamp) return 'Unavailable';
    return new Date(Number(timestamp) * 1000).toLocaleString('en-CA', {
      year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit'
    });
  }

  function number(value) {
    return value === null || value === undefined || !isFinite(Number(value))
      ? 'Unavailable' : Number(value).toLocaleString('en-US');
  }

  function bytes(value) {
    if (value === null || value === undefined || !isFinite(Number(value))) return 'Unavailable';
    var n = Number(value);
    if (n >= 1000000) return (n / 1000000).toFixed(2) + ' MB';
    if (n >= 1000) return (n / 1000).toFixed(1) + ' kB';
    return n + ' B';
  }

  function sats(value) {
    return value === null || value === undefined || !isFinite(Number(value))
      ? 'Unavailable' : Number(value).toLocaleString('en-US') + ' sats';
  }

  function btc(value, signed) {
    if (value === null || value === undefined || !isFinite(Number(value))) return 'Unavailable';
    var n = Number(value) / 100000000;
    var prefix = signed && n > 0 ? '+' : '';
    return prefix + n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 8 }) + ' BTC';
  }

  function hashLine(value) {
    if (!value) return 'Unavailable';
    var encoded = encodeURIComponent(value);
    return '<span class="hash-line"><span class="hash-value" title="' + attr(value) + '">' +
      esc(short(value, 12, 10)) + '</span><button class="copy-button" type="button" data-copy="' + encoded +
      '" aria-label="Copy ' + attr(short(value, 8, 6)) + '">Copy</button></span>';
  }

  function routeLink(type, id, label, className) {
    return '<a class="' + (className || '') + '" data-route="' + attr(type) + '" href="./explorer.html?view=' +
      encodeURIComponent(type) + '&id=' + encodeURIComponent(id) + '">' + esc(label) + '</a>';
  }

  async function api(path) {
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, 10000);
    try {
      var response = await fetch('/api/bitcoin/' + path, { signal: controller.signal, headers: { accept: 'application/json' } });
      var data = await response.json().catch(function () { return {}; });
      if (!response.ok) throw new Error(data.error || 'Bitcoin network data temporarily unavailable.');
      return data;
    } catch (error) {
      if (error && error.name === 'AbortError') throw new Error('Bitcoin network data temporarily unavailable.');
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  function setNetworkState(ok, message) {
    $('network-pip').className = 'pip ' + (ok ? 'ok' : 'bad');
    $('network-state').textContent = message;
  }

  function metric(label, value, sub) {
    return '<div class="metric"><div class="k">' + esc(label) + '</div><div class="v">' +
      esc(value) + '</div><div class="s">' + esc(sub || '') + '</div></div>';
  }

  async function loadNetwork() {
    $('network-metrics').innerHTML = [1, 2, 3, 4].map(function () {
      return '<div class="metric">' + S.skeleton(2, 16) + '</div>';
    }).join('');
    try {
      var data = await api('network');
      var fee = data.recommendedFee === null ? 'Unavailable' : Number(data.recommendedFee).toFixed(1) + ' sat/vB';
      var mempool = data.mempool && data.mempool.transactionCount !== null
        ? number(data.mempool.transactionCount) : 'Unavailable';
      var mempoolSub = data.mempool && data.mempool.virtualSize !== null
        ? bytes(data.mempool.virtualSize) + ' virtual size' : 'Provider did not return this metric';
      $('network-metrics').innerHTML =
        metric('Current block height', number(data.height), 'Bitcoin mainnet') +
        metric('Latest block age', data.latestBlock ? age(data.latestBlock.timestamp) : 'Unavailable', data.latestBlock ? short(data.latestBlock.hash, 8, 6) : '') +
        metric('Mempool transactions', mempool, mempoolSub) +
        metric('Recommended fee', fee, data.recommendedFee === null ? 'Provider estimate unavailable' : 'Approximately 3-block target');
      $('last-updated').textContent = 'Last updated ' + S.fmt.time(data.asOf);
      setNetworkState(true, 'Network data available');
    } catch (error) {
      $('network-metrics').innerHTML = '<div class="card" style="grid-column:1/-1">' +
        S.errorState('Unable to load Bitcoin network data.', error.message, 'retry-network') + '</div>';
      setNetworkState(false, 'Network data unavailable');
    }
  }

  function blocksTable(blocks) {
    if (!blocks || !blocks.length) return S.emptyState('No recent blocks were returned.');
    return '<div class="explorer-tablewrap"><table class="explorer-table"><caption class="sr">Latest Bitcoin blocks</caption>' +
      '<thead><tr><th>Height</th><th>Age</th><th>Transactions</th><th>Size</th><th>Weight</th><th>Fees</th></tr></thead><tbody>' +
      blocks.map(function (block) {
        var href = './explorer.html?view=block&id=' + encodeURIComponent(block.id);
        return '<tr data-href="' + href + '">' +
          '<td data-label="Height">' + routeLink('block', block.id, number(block.height), 'block-height') + '</td>' +
          '<td data-label="Age">' + esc(age(block.timestamp)) + '</td>' +
          '<td data-label="Transactions">' + number(block.tx_count) + '</td>' +
          '<td data-label="Size">' + esc(bytes(block.size)) + '</td>' +
          '<td data-label="Weight">' + number(block.weight) + ' WU</td>' +
          '<td data-label="Fees">' + (block.totalFees === null ? 'Unavailable' : sats(block.totalFees)) + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  async function loadBlocks() {
    $('blocks-content').innerHTML = '<div style="padding:20px">' + S.skeleton(8, 13) + '</div>';
    try {
      var data = await api('blocks');
      $('blocks-content').innerHTML = blocksTable(data.blocks);
    } catch (error) {
      $('blocks-content').innerHTML = '<div style="padding:20px">' +
        S.errorState('Unable to load latest blocks.', error.message, 'retry-blocks') + '</div>';
    }
  }

  function setRouteLoading(message) {
    $('overview-view').hidden = true;
    $('detail-view').hidden = true;
    $('route-error').hidden = true;
    $('route-loading').hidden = false;
    $('route-loading').innerHTML = '<p class="state-title">' + esc(message) + '</p>' + S.skeleton(3, 13);
  }

  function setRouteError(title, message) {
    $('overview-view').hidden = true;
    $('detail-view').hidden = true;
    $('route-loading').hidden = true;
    $('route-error').hidden = false;
    $('route-error').innerHTML = '<p class="state-title">' + esc(title) + '</p><p>' + esc(message) +
      '</p><p style="margin-top:12px"><a class="back-link" data-home href="./explorer.html">← Return to Explorer</a></p>';
  }

  function showDetail(html) {
    $('overview-view').hidden = true;
    $('route-loading').hidden = true;
    $('route-error').hidden = true;
    $('detail-view').hidden = false;
    $('detail-view').innerHTML = html;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function field(label, value) {
    return '<div class="detail-field"><div class="k">' + esc(label) + '</div><div class="v">' + value + '</div></div>';
  }

  function txTotals(transaction) {
    var input = (transaction.vin || []).reduce(function (sum, item) { return sum + Number(item.prevout && item.prevout.value || 0); }, 0);
    var output = (transaction.vout || []).reduce(function (sum, item) { return sum + Number(item.value || 0); }, 0);
    return { input: input, output: output };
  }

  function transactionRows(transactions) {
    if (!transactions || !transactions.length) return '<div style="padding:18px">' + S.emptyState('No transactions were returned for this page.') + '</div>';
    return '<div class="transaction-list">' + transactions.map(function (tx) {
      var totals = txTotals(tx);
      return '<div class="transaction-row">' + routeLink('transaction', tx.txid, short(tx.txid, 14, 10)) +
        '<div class="tx-stat"><span>Inputs</span><b>' + number((tx.vin || []).length) + '</b></div>' +
        '<div class="tx-stat"><span>Output</span><b>' + esc(btc(totals.output)) + '</b></div>' +
        '<div class="tx-stat"><span>Fee</span><b>' + esc(sats(tx.fee)) + '</b></div></div>';
    }).join('') + '</div>';
  }

  async function loadBlock(id, offset) {
    setRouteLoading('Loading block…');
    try {
      var data = await api('block/' + encodeURIComponent(id) + '?offset=' + encodeURIComponent(offset || 0));
      var b = data.block;
      var p = data.pagination;
      var previous = b.previousblockhash
        ? routeLink('block', b.previousblockhash, '← Previous Block', 'btn ghost small') : '';
      var next = b.nextBlockHash
        ? routeLink('block', b.nextBlockHash, 'Next Block →', 'btn ghost small') : '';
      var html = '<div class="detail-shell"><div class="detail-topline">' +
        '<a class="back-link" data-home href="./explorer.html">← Explorer overview</a><div class="block-nav">' + previous + next + '</div></div>' +
        '<section class="card detail-card"><header><div><p class="eyebrow">Bitcoin block</p><h2>Block ' + number(b.height) +
        '</h2></div><span class="status-badge confirmed">' + esc(b.status) + '</span></header><div class="detail-grid">' +
        field('Block height', number(b.height)) + field('Block hash', hashLine(b.id)) +
        field('Timestamp', esc(dateTime(b.timestamp))) + field('Age', esc(age(b.timestamp))) +
        field('Confirmations', number(b.confirmations)) + field('Transactions', number(b.tx_count)) +
        field('Size', esc(bytes(b.size))) + field('Weight', number(b.weight) + ' WU') +
        field('Total fees', b.totalFees === null ? 'Unavailable' : esc(sats(b.totalFees))) +
        field('Difficulty', b.difficulty === null || b.difficulty === undefined ? 'Unavailable' : Number(b.difficulty).toExponential(5)) +
        field('Previous block', b.previousblockhash ? routeLink('block', b.previousblockhash, short(b.previousblockhash, 10, 8)) : 'Unavailable') +
        field('Next block', b.nextBlockHash ? routeLink('block', b.nextBlockHash, short(b.nextBlockHash, 10, 8)) : 'Not available') +
        '</div><details class="technical"><summary>Technical details</summary><dl>' +
        '<dt>Merkle root</dt><dd>' + esc(b.merkle_root || 'Unavailable') + '</dd>' +
        '<dt>Version</dt><dd>' + number(b.version) + '</dd><dt>Nonce</dt><dd>' + number(b.nonce) +
        '</dd><dt>Median time</dt><dd>' + esc(dateTime(b.mediantime)) + '</dd><dt>Bits</dt><dd>' + number(b.bits) +
        '</dd></dl></details></section>' +
        '<section class="card subcard"><header><div><p class="eyebrow">Included activity</p><h2>Transactions</h2></div>' +
        '<span class="section-meta">' + number(p.offset + 1) + '–' + number(Math.min(p.offset + data.transactions.length, b.tx_count)) +
        ' of ' + number(b.tx_count) + '</span></header>' + transactionRows(data.transactions) +
        '<div class="pagination"><button class="btn ghost small" type="button" data-block-page="' + Math.max(0, p.offset - p.pageSize) +
        '" data-block-id="' + attr(b.id) + '"' + (p.hasPrevious ? '' : ' disabled') + '>← Previous page</button>' +
        '<span>25 transactions per page</span><button class="btn ghost small" type="button" data-block-page="' + (p.offset + p.pageSize) +
        '" data-block-id="' + attr(b.id) + '"' + (p.hasNext ? '' : ' disabled') + '>Next page →</button></div></section></div>';
      showDetail(html);
      document.title = 'Block ' + b.height + ' · Satstreet Explorer';
    } catch (error) {
      setRouteError('Block not found.', error.message);
    }
  }

  function ioItem(item, index, output, outspend) {
    var address = output ? item.scriptpubkey_address : item.prevout && item.prevout.scriptpubkey_address;
    var value = output ? item.value : item.prevout && item.prevout.value;
    var label = item.is_coinbase ? 'Coinbase input' : address ? routeLink('address', address, short(address, 16, 10)) : 'Address unavailable';
    var copy = address ? '<button class="copy-button" type="button" data-copy="' + encodeURIComponent(address) + '" aria-label="Copy address">Copy</button>' : '';
    var state = output && outspend ? (outspend.spent ? 'Spent' : 'Unspent') : output ? 'Spend status unavailable' : 'Input ' + (index + 1);
    return '<div class="io-item"><div class="io-address">' + (typeof label === 'string' ? label : esc(label)) + copy +
      '</div><div class="io-value"><b>' + esc(btc(value)) + '</b><span>' + esc(state) + '</span></div></div>';
  }

  async function loadTransaction(id) {
    setRouteLoading('Loading transaction…');
    try {
      var data = await api('tx/' + encodeURIComponent(id));
      var tx = data.transaction;
      var confirmed = !!(tx.status && tx.status.confirmed);
      var totals = txTotals(tx);
      var vsize = Math.ceil(Number(tx.weight) / 4);
      var feeRate = vsize > 0 ? (Number(tx.fee) / vsize).toFixed(1) + ' sat/vB' : 'Unavailable';
      var statusClass = confirmed ? 'confirmed' : 'pending';
      var blockValue = confirmed && tx.status.block_hash
        ? routeLink('block', tx.status.block_hash, number(tx.status.block_height)) : 'Unconfirmed';
      var inputs = (tx.vin || []).map(function (item, index) { return ioItem(item, index, false, null); }).join('');
      var outputs = (tx.vout || []).map(function (item, index) { return ioItem(item, index, true, data.outspends[index]); }).join('');
      var education = confirmed
        ? '<h2>Transaction confirmed</h2><p>Included in block ' + number(tx.status.block_height) + ' · ' + number(data.confirmations) +
          ' confirmation' + (data.confirmations === 1 ? '' : 's') + '</p><p>This transaction has been included in the Bitcoin blockchain. Each additional block increases settlement finality.</p>'
        : '<h2>Transaction pending</h2><p>This transaction is currently waiting to be included in a Bitcoin block.</p>';
      var html = '<div class="detail-shell"><div class="detail-topline"><a class="back-link" data-home href="./explorer.html">← Explorer overview</a></div>' +
        '<section class="card detail-card"><header><div><p class="eyebrow">Bitcoin transaction</p><h2>Transaction</h2></div>' +
        '<span class="status-badge ' + statusClass + '">' + (confirmed ? 'Confirmed' : 'Unconfirmed') + '</span></header><div class="detail-grid">' +
        field('Transaction ID', hashLine(tx.txid)) + field('Status', confirmed ? 'Confirmed' : 'Unconfirmed') +
        field('Block', blockValue) + field('Confirmations', number(data.confirmations)) +
        field('Timestamp', confirmed ? esc(dateTime(tx.status.block_time)) : 'Unavailable') + field('Size', esc(bytes(tx.size))) +
        field('Virtual size', number(vsize) + ' vB') + field('Weight', number(tx.weight) + ' WU') +
        field('Fee', esc(sats(tx.fee))) + field('Fee rate', esc(feeRate)) +
        field('Total input', esc(btc(totals.input))) + field('Total output', esc(btc(totals.output))) +
        '</div><details class="technical"><summary>Technical details</summary><dl><dt>Version</dt><dd>' + number(tx.version) +
        '</dd><dt>Locktime</dt><dd>' + number(tx.locktime) + '</dd></dl></details></section>' +
        '<section class="card subcard"><header><div><p class="eyebrow">Transaction path</p><h2>Inputs → Outputs</h2></div></header>' +
        '<div class="io-grid"><div class="io-column"><header><h3>Inputs · ' + number((tx.vin || []).length) + '</h3></header>' + inputs +
        '</div><div class="io-arrow" aria-hidden="true">→</div><div class="io-column"><header><h3>Outputs · ' + number((tx.vout || []).length) +
        '</h3></header>' + outputs + '</div></div></section><section class="card education ' + (confirmed ? '' : 'pending-card') + '">' + education + '</section></div>';
      showDetail(html);
      document.title = short(tx.txid, 10, 8) + ' · Satstreet Explorer';
    } catch (error) {
      setRouteError('Transaction not found.', error.message);
    }
  }

  function addressTransactionRows(transactions) {
    if (!transactions || !transactions.length) return '<div style="padding:18px">' + S.emptyState('No recent transactions were returned for this address.') + '</div>';
    return '<div class="transaction-list">' + transactions.map(function (tx) {
      var confirmed = !!(tx.status && tx.status.confirmed);
      var cls = tx.amountChange > 0 ? 'amount-positive' : tx.amountChange < 0 ? 'amount-negative' : '';
      return '<div class="transaction-row">' + routeLink('transaction', tx.txid, short(tx.txid, 14, 10)) +
        '<div class="tx-stat"><span>Status</span><b>' + (confirmed ? 'Confirmed · ' + number(tx.confirmations) + ' conf.' : 'Pending · 0 conf.') + '</b></div>' +
        '<div class="tx-stat"><span>Date / age</span><b>' + (confirmed ? esc(age(tx.status.block_time)) : 'Pending') + '</b></div>' +
        '<div class="tx-stat"><span>Net change</span><b class="' + cls + '">' + esc(btc(tx.amountChange, true)) + '</b></div></div>';
    }).join('') + '</div>';
  }

  async function loadAddress(id) {
    setRouteLoading('Loading address…');
    try {
      var data = await api('address/' + encodeURIComponent(id));
      var html = '<div class="detail-shell"><div class="detail-topline"><a class="back-link" data-home href="./explorer.html">← Explorer overview</a></div>' +
        '<section class="card detail-card"><header><div><p class="eyebrow">Bitcoin address</p><h2>Address</h2></div></header><div class="detail-grid">' +
        field('Address', hashLine(data.address)) + field('Confirmed balance', esc(btc(data.confirmedBalance))) +
        field('Unconfirmed balance', esc(btc(data.unconfirmedBalance))) + field('Transactions', number(data.transactionCount)) +
        field('Total received', esc(btc(data.totalReceived))) + field('Total sent', esc(btc(data.totalSent))) +
        '</div></section><p class="srcnote privacy-note">Bitcoin addresses and transactions are public blockchain data. Searching an address does not identify its owner.</p>' +
        '<section class="card subcard"><header><div><p class="eyebrow">Recent activity</p><h2>Transaction history</h2></div>' +
        '<span class="section-meta">Most recent ' + number((data.transactions || []).length) + '</span></header>' + addressTransactionRows(data.transactions) + '</section></div>';
      showDetail(html);
      document.title = short(data.address, 12, 8) + ' · Satstreet Explorer';
    } catch (error) {
      setRouteError('Address not found.', error.message);
    }
  }

  function navigate(type, id, offset, push) {
    if (push !== false) {
      var params = new URLSearchParams({ view: type, id: id });
      if (offset) params.set('offset', String(offset));
      history.pushState({}, '', './explorer.html?' + params.toString());
    }
    if (type === 'block') return loadBlock(id, offset || 0);
    if (type === 'transaction') return loadTransaction(id);
    if (type === 'address') return loadAddress(id);
    showOverview(false);
  }

  function showOverview(push) {
    if (push !== false) history.pushState({}, '', './explorer.html');
    document.title = 'Satstreet · Bitcoin Explorer';
    $('route-loading').hidden = true;
    $('route-error').hidden = true;
    $('detail-view').hidden = true;
    $('overview-view').hidden = false;
  }

  async function searchQuery(query) {
    $('search-error').hidden = true;
    $('search-button').disabled = true;
    $('search-button').textContent = 'Searching…';
    try {
      var result = await api('search?query=' + encodeURIComponent(query));
      navigate(result.type, result.id, 0, true);
    } catch (error) {
      $('search-error').textContent = error.message;
      $('search-error').hidden = false;
    } finally {
      $('search-button').disabled = false;
      $('search-button').textContent = 'Search';
    }
  }

  $('explorer-search-form').addEventListener('submit', function (event) {
    event.preventDefault();
    var query = $('explorer-query').value.trim();
    if (!query) {
      $('search-error').textContent = 'Enter a block height, block hash, transaction ID or Bitcoin address.';
      $('search-error').hidden = false;
      $('explorer-query').focus();
      return;
    }
    searchQuery(query);
  });

  document.addEventListener('click', function (event) {
    var copy = event.target.closest('[data-copy]');
    if (copy) {
      var value = decodeURIComponent(copy.getAttribute('data-copy'));
      navigator.clipboard.writeText(value).then(function () {
        var original = copy.textContent;
        copy.textContent = 'Copied';
        setTimeout(function () { copy.textContent = original; }, 1400);
      });
      return;
    }
    var route = event.target.closest('[data-route]');
    if (route) {
      event.preventDefault();
      var url = new URL(route.href);
      navigate(url.searchParams.get('view'), url.searchParams.get('id'), Number(url.searchParams.get('offset') || 0), true);
      return;
    }
    var home = event.target.closest('[data-home]');
    if (home) { event.preventDefault(); showOverview(true); return; }
    var page = event.target.closest('[data-block-page]');
    if (page && !page.disabled) {
      navigate('block', page.getAttribute('data-block-id'), Number(page.getAttribute('data-block-page')), true);
      return;
    }
    var row = event.target.closest('tr[data-href]');
    if (row && !event.target.closest('a,button')) {
      var rowUrl = new URL(row.getAttribute('data-href'), location.href);
      navigate(rowUrl.searchParams.get('view'), rowUrl.searchParams.get('id'), 0, true);
      return;
    }
    if (event.target.id === 'retry-network') loadNetwork();
    if (event.target.id === 'retry-blocks') loadBlocks();
  });

  $('refresh-blocks').addEventListener('click', loadBlocks);
  window.addEventListener('popstate', routeFromLocation);

  function routeFromLocation() {
    var params = new URLSearchParams(location.search);
    var view = params.get('view');
    var id = params.get('id');
    if (view && id) navigate(view, id, Number(params.get('offset') || 0), false);
    else showOverview(false);
  }

  loadNetwork();
  loadBlocks();
  routeFromLocation();
})();
