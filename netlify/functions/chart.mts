/* ──────────────────────────────────────────────────────────────────────────
   What the Chart page needs to draw any coin on the Markets board.

   GET /api/chart?id=<coingecko id>            → venue + reference price
   GET /api/chart?symbol=BTW                   → same, resolving the id first
   GET /api/chart?id=<id>&days=7               → OHLC candles (fallback chart)

   The chart itself is TradingView's widget, which needs an exchange-prefixed
   symbol such as COINBASE:BTCUSD. Assuming Coinbase left every coin Coinbase
   does not list (Bitway, LEO, Monero, OKB…) as a blank frame. Instead, this
   asks CoinGecko which exchanges actually list this exact coin — by id, so a
   ticker shared by two unrelated tokens cannot be confused — and picks the
   first one TradingView carries. A coin with no such market gets candles
   from CoinGecko instead, drawn on the page.

   CoinGecko's free API is rate-limited per caller, so these answers are
   cached at Netlify's edge: venue and price for two minutes, candles
   for ten. One lookup serves every visitor in that window.
   ────────────────────────────────────────────────────────────────────────── */

const CG = 'https://api.coingecko.com/api/v3/'

/* CoinGecko exchange id → TradingView prefix, in order of preference. */
const VENUES: [string, string][] = [
  ['gdax', 'COINBASE'],
  ['kraken', 'KRAKEN'],
  ['bitstamp', 'BITSTAMP'],
  ['binance', 'BINANCE'],
  ['okex', 'OKX'],
  ['bybit_spot', 'BYBIT'],
  ['bitfinex', 'BITFINEX'],
  ['kucoin', 'KUCOIN'],
  ['bitget', 'BITGET'],
  ['gate', 'GATEIO'],
  ['mxc', 'MEXC'],
  ['whitebit', 'WHITEBIT'],
  ['crypto_com', 'CRYPTO'],
  ['htx', 'HTX'],
]
const PREFIX = new Map(VENUES)
const RANK = new Map(VENUES.map(([id], i) => [id, i]))
/* Quote currencies TradingView charts a USD-like price against, best first. */
const QUOTES = ['USD', 'USDT', 'USDC']

const json = (body: unknown, cache: string, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      'access-control-allow-origin': '*',
      'cache-control': 'public, max-age=60',
      'netlify-cdn-cache-control': cache,
    },
  })

async function cg(path: string): Promise<any> {
  const r = await fetch(CG + path, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(8000),
  })
  if (r.status === 404) throw Object.assign(new Error('Unknown asset'), { status: 404 })
  if (!r.ok) throw Object.assign(new Error('Price source unavailable'), { status: 502 })
  return r.json()
}

/* Highest-ranked coin with exactly this ticker. */
async function idForSymbol(symbol: string): Promise<string | null> {
  const d = await cg('search?query=' + encodeURIComponent(symbol))
  const hits = (d.coins || []).filter((c: any) => String(c.symbol).toUpperCase() === symbol)
  hits.sort((a: any, b: any) => (a.market_cap_rank ?? 1e9) - (b.market_cap_rank ?? 1e9))
  return hits[0]?.id ?? null
}

async function venueFor(id: string): Promise<{ tv: string; venue: string } | null> {
  const ids = VENUES.map(([v]) => v).join(',')
  const d = await cg(`coins/${encodeURIComponent(id)}/tickers?exchange_ids=${ids}&order=volume_desc`)
  const usable = (d.tickers || [])
    .filter((t: any) => !t.is_stale && !t.is_anomaly && PREFIX.has(t.market?.identifier) && QUOTES.includes(t.target))
    .filter((t: any) => /^[A-Z0-9]+$/.test(t.base) && /^[A-Z0-9]+$/.test(t.target))
  usable.sort((a: any, b: any) =>
    (RANK.get(a.market.identifier)! - RANK.get(b.market.identifier)!) ||
    (QUOTES.indexOf(a.target) - QUOTES.indexOf(b.target)))
  const t = usable[0]
  if (!t) return null
  return { tv: `${PREFIX.get(t.market.identifier)}:${t.base}${t.target}`, venue: t.market.name }
}

export default async (req: Request) => {
  const url = new URL(req.url)
  let id = (url.searchParams.get('id') || '').toLowerCase().replace(/[^a-z0-9-]/g, '')
  const symbol = (url.searchParams.get('symbol') || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  const days = url.searchParams.get('days')

  try {
    if (!id && symbol) id = (await idForSymbol(symbol)) || ''
    if (!id) return json({ error: 'Unknown asset' }, 'public, durable, s-maxage=3600', 404)

    if (days) {
      const d = ['1', '7', '30', '90', '365'].includes(days) ? days : '7'
      const ohlc = await cg(`coins/${encodeURIComponent(id)}/ohlc?vs_currency=usd&days=${d}`)
      return json({ id, days: Number(d), candles: ohlc }, 'public, durable, s-maxage=600, stale-while-revalidate=1800')
    }

    const [coin, venue] = await Promise.all([
      cg(`coins/${encodeURIComponent(id)}?localization=false&tickers=false&community_data=false&developer_data=false`),
      venueFor(id).catch(() => null),
    ])
    const m = coin.market_data || {}
    return json({
      id,
      symbol: String(coin.symbol || symbol).toUpperCase(),
      name: coin.name,
      image: coin.image?.small || coin.image?.thumb || null,
      priceUsd: m.current_price?.usd ?? null,
      changePct24h: m.price_change_percentage_24h ?? null,
      tv: venue?.tv ?? null,
      venue: venue?.venue ?? null,
    }, 'public, durable, s-maxage=120, stale-while-revalidate=21600')
  } catch (e: any) {
    return json({ error: e.message || 'Unavailable' }, 'public, s-maxage=30', e.status || 502)
  }
}

export const config = { path: '/api/chart' }
