/* ──────────────────────────────────────────────────────────────────────────
   Search behind the Overview's "Add to watchlist" box.

   GET /api/symbols?q=xrp   →  { results: [{ symbol, label, type, detail }] }

   Two sources, because the board quotes from two:
     crypto   Coinbase's own list of USD pairs, so anything offered here is
              something /api/market can actually quote (XRP-USD, SOL-USD…)
     other    Yahoo's symbol search: stocks, ETFs, indices, futures and FX,
              which /api/market quotes through Yahoo's chart feed

   Yahoo's search sends no CORS header, which is why this runs server-side.
   Coinbase's currency list barely changes, so it is held for an hour.
   ────────────────────────────────────────────────────────────────────────── */

interface Result { symbol: string; label: string; type: string; detail: string }

let coinCache: { at: number; list: Result[] } | null = null

async function coinbaseList(): Promise<Result[]> {
  if (coinCache && Date.now() - coinCache.at < 3600_000) return coinCache.list
  const [products, currencies] = await Promise.all([
    fetch('https://api.exchange.coinbase.com/products', { signal: AbortSignal.timeout(6000) }).then((r) => r.json()),
    fetch('https://api.exchange.coinbase.com/currencies', { signal: AbortSignal.timeout(6000) }).then((r) => r.json()).catch(() => []),
  ])
  const names = new Map<string, string>((currencies || []).map((c: any) => [c.id, c.name]))
  const list: Result[] = (products || [])
    .filter((p: any) => p.quote_currency === 'USD' && p.status === 'online' && !p.trading_disabled)
    .filter((p: any) => !/^(USDC|USDT|DAI|PYUSD|EURC|GUSD)$/.test(p.base_currency))
    .map((p: any) => ({
      symbol: `${p.base_currency}-USD`,
      label: names.get(p.base_currency) || p.base_currency,
      type: 'Crypto',
      detail: `${p.base_currency} / USD`,
    }))
  coinCache = { at: Date.now(), list }
  return list
}

const YAHOO_TYPES: Record<string, string> = {
  EQUITY: 'Stock', ETF: 'ETF', INDEX: 'Index', FUTURE: 'Futures', CURRENCY: 'FX', MUTUALFUND: 'Fund',
}

async function yahooSearch(q: string): Promise<Result[]> {
  const r = await fetch(
    `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=10&newsCount=0&listsCount=0`,
    { headers: { 'user-agent': 'Mozilla/5.0 (compatible; SatstreetDashboard/1.0)' }, signal: AbortSignal.timeout(6000) },
  )
  if (!r.ok) return []
  const d = await r.json()
  return (d.quotes || [])
    .filter((x: any) => YAHOO_TYPES[x.quoteType] && /^[\^]?[A-Z0-9.\-]{1,15}(=[XF])?$/.test(x.symbol))
    .map((x: any) => ({
      symbol: x.symbol,
      label: x.shortname || x.longname || x.symbol,
      type: YAHOO_TYPES[x.quoteType],
      detail: [x.symbol, x.exchDisp].filter(Boolean).join(' · '),
    }))
}

export default async (req: Request) => {
  const q = (new URL(req.url).searchParams.get('q') || '').trim().slice(0, 40)
  const json = (body: unknown) => new Response(JSON.stringify(body), {
    headers: {
      'content-type': 'application/json',
      'cache-control': 'public, max-age=300',
      'netlify-cdn-cache-control': 'public, durable, s-maxage=900',
    },
  })
  if (q.length < 1) return json({ results: [] })

  const needle = q.toUpperCase()
  const [coins, other] = await Promise.all([
    coinbaseList().catch(() => [] as Result[]),
    yahooSearch(q).catch(() => [] as Result[]),
  ])

  /* Exact ticker first, then tickers that start with it, then names. */
  const score = (c: Result) => {
    const base = c.symbol.replace('-USD', '')
    if (base === needle) return 0
    if (base.startsWith(needle)) return 1
    if (c.label.toUpperCase().startsWith(needle)) return 2
    if (c.label.toUpperCase().includes(needle)) return 3
    return 9
  }
  const crypto = coins.map((c) => ({ c, s: score(c) })).filter((x) => x.s < 9)
    .sort((a, b) => a.s - b.s || a.c.symbol.length - b.c.symbol.length).slice(0, 6).map((x) => x.c)

  /* Yahoo also lists crypto (XRP-USD as CRYPTOCURRENCY); those are filtered
     out above so a coin only ever appears once, quoted from Coinbase. */
  const seen = new Set(crypto.map((c) => c.symbol))
  const results = [...crypto, ...other.filter((o) => !seen.has(o.symbol))].slice(0, 12)
  return json({ results })
}

export const config = { path: '/api/symbols' }
