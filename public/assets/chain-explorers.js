/* Ethereum and Solana on the Explorer page.

   Bitcoin has a full in-page explorer (explorer.js). Ethereum and Solana get
   a network snapshot and a recent-blocks table read straight from public RPC
   nodes, and a search box that hands the lookup to the chain's own explorer:
   Etherscan for Ethereum, explorer.solana.com for Solana. Both open in a new
   tab, so the reader keeps their place here.

   Nothing loads until its tab is opened. */
(function () {
  'use strict';

  var S = window.SATSTREET;
  var $ = function (id) { return document.getElementById(id); };
  var esc = S.esc;

  var ETH_RPC = 'https://ethereum-rpc.publicnode.com';
  var SOL_RPC = 'https://solana-rpc.publicnode.com';
  var ETHERSCAN = 'https://etherscan.io/';
  var SOLSCAN = 'https://explorer.solana.com/';

  function attr(v) { return esc(v).replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
  function short(v, a, b) {
    v = String(v || '');
    return v.length <= a + b + 3 ? v : v.slice(0, a) + '…' + v.slice(-b);
  }
  function num(v) {
    return v === null || v === undefined || !isFinite(Number(v)) ? '—' : Number(v).toLocaleString('en-US');
  }
  function age(sec) {
    if (!sec) return '—';
    var s = Math.max(0, Math.floor(Date.now() / 1000 - sec));
    if (s < 60) return s + ' sec ago';
    var m = Math.floor(s / 60);
    if (m < 60) return m + ' min ago';
    var h = Math.floor(m / 60);
    return h < 24 ? h + ' hr ago' : Math.floor(h / 24) + ' days ago';
  }
  function out(href, label, cls) {
    return '<a class="' + (cls || '') + '" href="' + attr(href) + '" target="_blank" rel="noopener noreferrer">' + esc(label) + '</a>';
  }
  function metric(k, v, s) {
    return '<div class="metric"><div class="k">' + esc(k) + '</div><div class="v">' + esc(v) +
      '</div><div class="s">' + esc(s || '') + '</div></div>';
  }
  function skeletonMetrics(id) {
    $(id).innerHTML = [1, 2, 3, 4].map(function () { return '<div class="metric">' + S.skeleton(2, 16) + '</div>'; }).join('');
  }

  /* JSON-RPC over fetch, single call or batch, with a timeout. */
  function rpc(url, body) {
    var ctl = new AbortController();
    var timer = setTimeout(function () { ctl.abort(); }, 12000);
    return fetch(url, {
      method: 'POST', signal: ctl.signal,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (r) {
      if (!r.ok) throw new Error('Network data temporarily unavailable.');
      return r.json();
    }).then(function (j) {
      if (Array.isArray(j)) return j.sort(function (a, b) { return a.id - b.id; }).map(function (x) { return x.result; });
      if (j.error) throw new Error(j.error.message || 'Network data temporarily unavailable.');
      return j.result;
    }).catch(function (e) {
      throw new Error(e && e.name === 'AbortError' ? 'Network data temporarily unavailable.' : e.message);
    }).finally(function () { clearTimeout(timer); });
  }
  function call(id, method, params) { return { jsonrpc: '2.0', id: id, method: method, params: params || [] }; }

  /* ── Ethereum ─────────────────────────────────────────────────────── */
  var hex = function (h) { return h ? parseInt(h, 16) : null; };

  function loadEth() {
    skeletonMetrics('eth-metrics');
    $('eth-blocks').innerHTML = '<div style="padding:20px">' + S.skeleton(8, 13) + '</div>';
    Promise.all([rpc(ETH_RPC, call(1, 'eth_blockNumber')), rpc(ETH_RPC, call(2, 'eth_gasPrice'))])
      .then(function (r) {
        var tip = hex(r[0]), gas = hex(r[1]);
        var batch = [];
        for (var i = 0; i < 8; i++) batch.push(call(i, 'eth_getBlockByNumber', ['0x' + (tip - i).toString(16), false]));
        return rpc(ETH_RPC, batch).then(function (blocks) { return { blocks: blocks.filter(Boolean), gas: gas }; });
      })
      .then(function (d) {
        var b = d.blocks;
        if (!b.length) throw new Error('No recent blocks were returned.');
        var txs = b.reduce(function (s, x) { return s + x.transactions.length; }, 0) / b.length;
        var span = hex(b[0].timestamp) - hex(b[b.length - 1].timestamp);
        $('eth-metrics').innerHTML =
          metric('Latest block', num(hex(b[0].number)), 'Ethereum mainnet') +
          metric('Latest block age', age(hex(b[0].timestamp)), b.length > 1 ? 'about ' + Math.round(span / (b.length - 1)) + ' sec between blocks' : '') +
          metric('Gas price', d.gas === null ? '—' : (d.gas / 1e9).toFixed(d.gas < 1e10 ? 2 : 1) + ' gwei', 'network estimate') +
          metric('Transactions per block', Math.round(txs).toLocaleString('en-US'), 'average of the last ' + b.length);
        $('eth-blocks').innerHTML = '<div class="explorer-tablewrap"><table class="explorer-table"><caption class="sr">Latest Ethereum blocks</caption>' +
          '<thead><tr><th>Block</th><th>Age</th><th>Transactions</th><th>Gas used</th><th>Base fee</th><th>Fee recipient</th></tr></thead><tbody>' +
          b.map(function (x) {
            var n = hex(x.number), used = hex(x.gasUsed), limit = hex(x.gasLimit);
            return '<tr>' +
              '<td data-label="Block">' + out(ETHERSCAN + 'block/' + n, num(n), 'block-height') + '</td>' +
              '<td data-label="Age">' + esc(age(hex(x.timestamp))) + '</td>' +
              '<td data-label="Transactions">' + num(x.transactions.length) + '</td>' +
              '<td data-label="Gas used">' + (limit ? (used / limit * 100).toFixed(1) + '%' : '—') + '</td>' +
              '<td data-label="Base fee">' + (x.baseFeePerGas ? (hex(x.baseFeePerGas) / 1e9).toFixed(3) + ' gwei' : '—') + '</td>' +
              '<td data-label="Fee recipient">' + out(ETHERSCAN + 'address/' + x.miner, short(x.miner, 6, 4), 'chain-addr') + '</td>' +
              '</tr>';
          }).join('') + '</tbody></table></div>';
      })
      .catch(function (e) {
        $('eth-metrics').innerHTML = '<div class="card" style="grid-column:1/-1">' +
          S.errorState('Unable to load Ethereum network data.', e.message, 'retry-eth') + '</div>';
        $('eth-blocks').innerHTML = '';
      });
  }

  function ethTarget(q) {
    if (/^0x[0-9a-f]{40}$/i.test(q)) return ETHERSCAN + 'address/' + q;
    if (/^0x[0-9a-f]{64}$/i.test(q)) return ETHERSCAN + 'tx/' + q;
    if (/^\d+$/.test(q)) return ETHERSCAN + 'block/' + q;
    if (/^[a-z0-9-]+(\.[a-z0-9-]+)*\.eth$/i.test(q)) return ETHERSCAN + 'name-lookup-search?id=' + encodeURIComponent(q.toLowerCase());
    return null;
  }

  /* ── Solana ───────────────────────────────────────────────────────── */
  function loadSol() {
    skeletonMetrics('sol-metrics');
    $('sol-blocks').innerHTML = '<div style="padding:20px">' + S.skeleton(6, 13) + '</div>';
    rpc(SOL_RPC, [
      call(0, 'getEpochInfo', [{ commitment: 'finalized' }]),
      call(1, 'getRecentPerformanceSamples', [5])
    ]).then(function (r) {
      var ep = r[0], perf = r[1] || [];
      if (!ep) throw new Error('Network data temporarily unavailable.');
      var tps = 0, nonVote = 0, secs = 0;
      perf.forEach(function (p) { tps += p.numTransactions; nonVote += p.numNonVoteTransactions || 0; secs += p.samplePeriodSecs; });
      $('sol-metrics').innerHTML =
        metric('Current slot', num(ep.absoluteSlot), 'finalized') +
        metric('Block height', num(ep.blockHeight), 'Solana mainnet') +
        metric('Throughput', secs ? Math.round(tps / secs).toLocaleString('en-US') + ' TPS' : '—',
          secs ? Math.round(nonVote / secs).toLocaleString('en-US') + ' TPS excluding votes' : '') +
        metric('Epoch', num(ep.epoch), (ep.slotIndex / ep.slotsInEpoch * 100).toFixed(1) + '% complete');
      return rpc(SOL_RPC, call(2, 'getBlocks', [ep.absoluteSlot - 14, ep.absoluteSlot, { commitment: 'finalized' }]));
    }).then(function (slots) {
      slots = (slots || []).slice(-6).reverse();
      if (!slots.length) throw new Error('No recent blocks were returned.');
      return rpc(SOL_RPC, slots.map(function (s, i) {
        return call(i, 'getBlock', [s, { transactionDetails: 'signatures', rewards: true, maxSupportedTransactionVersion: 0, commitment: 'finalized' }]);
      })).then(function (blocks) { return { slots: slots, blocks: blocks }; });
    }).then(function (d) {
      $('sol-blocks').innerHTML = '<div class="explorer-tablewrap"><table class="explorer-table"><caption class="sr">Latest Solana blocks</caption>' +
        '<thead><tr><th>Slot</th><th>Age</th><th>Transactions</th><th>Leader</th><th>Block hash</th></tr></thead><tbody>' +
        d.blocks.map(function (b, i) {
          if (!b) return '';
          var slot = d.slots[i];
          var leader = (b.rewards || []).filter(function (x) { return x.rewardType === 'Fee'; })[0];
          return '<tr>' +
            '<td data-label="Slot">' + out(SOLSCAN + 'block/' + slot, num(slot), 'block-height') + '</td>' +
            '<td data-label="Age">' + esc(age(b.blockTime)) + '</td>' +
            '<td data-label="Transactions">' + num((b.signatures || []).length) + '</td>' +
            '<td data-label="Leader">' + (leader ? out(SOLSCAN + 'address/' + leader.pubkey, short(leader.pubkey, 5, 4), 'chain-addr') : '—') + '</td>' +
            '<td data-label="Block hash"><span class="chain-hash">' + esc(short(b.blockhash, 6, 6)) + '</span></td>' +
            '</tr>';
        }).join('') + '</tbody></table></div>';
    }).catch(function (e) {
      if (!$('sol-metrics').querySelector('.metric .v')) {
        $('sol-metrics').innerHTML = '<div class="card" style="grid-column:1/-1">' +
          S.errorState('Unable to load Solana network data.', e.message, 'retry-sol') + '</div>';
        $('sol-blocks').innerHTML = '';
      } else {
        $('sol-blocks').innerHTML = '<div style="padding:20px">' + S.errorState('Unable to load latest blocks.', e.message, 'retry-sol') + '</div>';
      }
    });
  }

  var B58 = /^[1-9A-HJ-NP-Za-km-z]+$/;
  function solTarget(q) {
    if (/^\d+$/.test(q)) return SOLSCAN + 'block/' + q;
    if (!B58.test(q)) return null;
    if (q.length >= 32 && q.length <= 44) return SOLSCAN + 'address/' + q;
    if (q.length >= 64 && q.length <= 90) return SOLSCAN + 'tx/' + q;
    return null;
  }

  /* ── search boxes ─────────────────────────────────────────────────── */
  function wireSearch(prefix, target, hint) {
    $(prefix + '-search-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var q = $(prefix + '-query').value.trim(), err = $(prefix + '-search-error');
      err.hidden = true;
      var url = q && target(q);
      if (!url) {
        err.textContent = q ? hint : 'Enter something to search for.';
        err.hidden = false;
        $(prefix + '-query').focus();
        return;
      }
      window.open(url, '_blank', 'noopener');
    });
  }
  wireSearch('eth', ethTarget, 'That does not look like an Ethereum address, transaction hash, block number or ENS name.');
  wireSearch('sol', solTarget, 'That does not look like a Solana address, transaction signature or slot number.');

  /* ── chain switcher ───────────────────────────────────────────────── */
  var CHAINS = ['btc', 'eth', 'sol'];
  var LOAD = { eth: loadEth, sol: loadSol };
  var loaded = {};
  var TITLES = { btc: 'Bitcoin Explorer', eth: 'Ethereum Explorer', sol: 'Solana Explorer' };

  function select(chain, push) {
    if (CHAINS.indexOf(chain) < 0) chain = 'btc';
    CHAINS.forEach(function (c) {
      var on = c === chain;
      $('chain-tab-' + c).setAttribute('aria-selected', String(on));
      $('chain-tab-' + c).tabIndex = on ? 0 : -1;
      $('chain-' + c).hidden = !on;
    });
    document.title = 'Satstreet · ' + TITLES[chain];
    if (push) {
      var url = chain === 'btc' ? './explorer.html' : './explorer.html?chain=' + chain;
      history.pushState({}, '', url);
      /* Back on Bitcoin from a deep link: let explorer.js show its overview. */
      if (chain === 'btc') window.dispatchEvent(new PopStateEvent('popstate'));
    }
    if (LOAD[chain] && !loaded[chain]) { loaded[chain] = true; LOAD[chain](); }
  }

  var tabs = $('chain-tabs');
  tabs.addEventListener('click', function (e) {
    var b = e.target.closest('[data-chain]');
    if (b && b.getAttribute('aria-selected') !== 'true') select(b.getAttribute('data-chain'), true);
  });
  tabs.addEventListener('keydown', function (e) {
    var i = CHAINS.indexOf(document.activeElement.getAttribute('data-chain'));
    if (i < 0) return;
    var n = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : -1;
    if (n === -1) return;
    e.preventDefault();
    n = (n + CHAINS.length) % CHAINS.length;
    select(CHAINS[n], true); $('chain-tab-' + CHAINS[n]).focus();
  });

  document.addEventListener('click', function (e) {
    if (e.target.id === 'retry-eth') loadEth();
    if (e.target.id === 'retry-sol') loadSol();
  });
  $('eth-refresh').addEventListener('click', loadEth);
  $('sol-refresh').addEventListener('click', loadSol);

  function fromLocation() {
    var p = new URLSearchParams(location.search);
    select(p.get('view') ? 'btc' : (p.get('chain') || 'btc'), false);
  }
  window.addEventListener('popstate', fromLocation);
  fromLocation();
})();
