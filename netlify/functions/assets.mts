/* ──────────────────────────────────────────────────────────────────────────
   Largest assets by market capitalisation.

   The point of this table is one row: where Bitcoin sits against gold, silver
   and the largest listed companies. A client asking "how big is Bitcoin,
   really" is asking a comparison question, and a number with no scale beside
   it does not answer it.

   Nothing here is stored as a market cap. Every figure is recomputed on each
   request from a live price and a share or unit count:

     companies    price x shares outstanding
     metals       price x estimated above-ground stock
     crypto       taken from CoinGecko, which already multiplies circulating
                  supply by price

   Share counts are the part that cannot be fetched live. Yahoo's quote
   endpoint stopped serving market cap without authentication, and its open
   chart endpoint carries price but not share count, so the counts below are
   read out of each company's own SEC filing and pinned here with the filing
   that reported them. They move by a percent or two a year through buybacks
   and issuance, so a refresh each quarter is enough; the 'filed' date says
   how stale any row has become.

   Every count was checked against an independent market-cap reference at the
   time it was added, and six candidates were dropped for failing that check
   rather than being carried at a plausible-looking error:

     Meta            SEC publishes only a weighted-average share count, which
                     is not the same thing and came out 1% off
     Berkshire       no usable current figure; the last tagged one is 2011
     Visa            last tagged figure is 2010, out by a factor of four
     Mastercard      weighted average only, 4% off
     Eli Lilly       tagged figure disagrees with the reference by 5.6%
     Alphabet        two rows are tagged; summing them doubles the company.
                     The row that reconciles is the one used below.

   Saudi Aramco and Samsung are absent because they do not file with the SEC,
   and SpaceX because a private round is a negotiated valuation rather than a
   market price. Adding any of them means finding a primary source for the
   share count first — a missing row is cheaper than a wrong one.
   ────────────────────────────────────────────────────────────────────────── */

const YAHOO = 'https://query1.finance.yahoo.com/v8/finance/chart/'
const COINGECKO =
  'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=bitcoin,ethereum&price_change_percentage=24h'

/** One troy ounce per tonne, for pricing a metal stock quoted in tonnes. */
const OZ_PER_TONNE = 32_150.7

interface Company {
  kind: 'company'
  symbol: string
  name: string
  country: string
  shares: number
  /** The filing the share count came from, so staleness is visible. */
  filed: string
  note?: string
}

interface Metal {
  kind: 'metal'
  symbol: string
  name: string
  /** Estimated above-ground stock, in tonnes. */
  tonnes: number
  source: string
}

interface Crypto {
  kind: 'crypto'
  id: string
  symbol: string
  name: string
}

/* Share counts: dei:EntityCommonStockSharesOutstanding unless noted. */
const COMPANIES: Company[] = [
  { kind:'company', symbol:'NVDA',  name:'NVIDIA',              country:'US', shares:24_100_000_000, filed:'2026-08-26' },
  { kind:'company', symbol:'AAPL',  name:'Apple',               country:'US', shares:14_594_180_000, filed:'2026-07-31' },
  { kind:'company', symbol:'GOOGL', name:'Alphabet',            country:'US', shares:12_230_000_000, filed:'2026-07-23', note:'us-gaap:CommonStockSharesOutstanding; the tagged rows are per class and are not summed' },
  { kind:'company', symbol:'MSFT',  name:'Microsoft',           country:'US', shares:7_425_545_491,  filed:'2026-07-29' },
  { kind:'company', symbol:'AMZN',  name:'Amazon',              country:'US', shares:10_786_313_572, filed:'2026-07-31' },
  { kind:'company', symbol:'TSM',   name:'TSMC',                country:'TW', shares:5_186_504_904,  filed:'2026-04-16', note:'20-F reports 25,932,524,521 ordinary shares; one ADR is five ordinary, and the price used here is the ADR' },
  { kind:'company', symbol:'AVGO',  name:'Broadcom',            country:'US', shares:4_773_629_865,  filed:'2026-09-10' },
  { kind:'company', symbol:'TSLA',  name:'Tesla',               country:'US', shares:3_949_547_394,  filed:'2026-07-23' },
  { kind:'company', symbol:'WMT',   name:'Walmart',             country:'US', shares:7_933_746_241,  filed:'2026-08-28' },
  { kind:'company', symbol:'MU',    name:'Micron Technology',   country:'US', shares:1_129_393_151,  filed:'2026-06-25' },
  { kind:'company', symbol:'JPM',   name:'JPMorgan Chase',      country:'US', shares:2_658_186_195,  filed:'2026-08-06' },
  { kind:'company', symbol:'XOM',   name:'ExxonMobil',          country:'US', shares:4_111_911_960,  filed:'2026-08-03' },
  { kind:'company', symbol:'JNJ',   name:'Johnson & Johnson',   country:'US', shares:2_409_898_597,  filed:'2026-07-23' },
  { kind:'company', symbol:'ABBV',  name:'AbbVie',              country:'US', shares:1_767_117_285,  filed:'2026-08-03' },
  { kind:'company', symbol:'ORCL',  name:'Oracle',              country:'US', shares:3_023_736_000,  filed:'2026-09-11' },
  { kind:'company', symbol:'BAC',   name:'Bank of America',     country:'US', shares:6_992_748_365,  filed:'2026-07-31' },
  { kind:'company', symbol:'KO',    name:'Coca-Cola',           country:'US', shares:4_302_482_418,  filed:'2026-04-30' },
  { kind:'company', symbol:'COST',  name:'Costco',              country:'US', shares:443_478_804,    filed:'2026-06-03' },
  { kind:'company', symbol:'PG',    name:'Procter & Gamble',    country:'US', shares:2_324_433_060,  filed:'2026-08-04' },
  { kind:'company', symbol:'NFLX',  name:'Netflix',             country:'US', shares:4_163_939_676,  filed:'2026-07-17' },
  { kind:'company', symbol:'HD',    name:'Home Depot',          country:'US', shares:997_689_626,    filed:'2026-08-25' },
]

/* Metals are priced off the front-month future, which tracks spot closely
   enough for a ranking and needs no key. The stock estimates are the figures
   the industry bodies publish; silver's is the softer of the two, since much
   of the above-ground stock is in jewellery and industrial use that no one
   counts precisely. */
const METALS: Metal[] = [
  { kind:'metal', symbol:'GC=F', name:'Gold',   tonnes:216_265,   source:'World Gold Council, above-ground stock' },
  { kind:'metal', symbol:'SI=F', name:'Silver', tonnes:1_750_000, source:'Silver Institute, above-ground stock (estimate)' },
]

const CRYPTO: Crypto[] = [
  { kind:'crypto', id:'bitcoin',  symbol:'BTC', name:'Bitcoin' },
  { kind:'crypto', id:'ethereum', symbol:'ETH', name:'Ethereum' },
]

interface AssetRow {
  rank: number
  kind: 'company' | 'metal' | 'crypto'
  symbol: string
  name: string
  country: string | null
  marketCapUsd: number
  priceUsd: number
  changePct: number | null
  /** How the market cap was arrived at, shown to the reader on hover. */
  basis: string
}

async function yahoo(symbol: string): Promise<{ price: number; changePct: number | null } | null> {
  try {
    const r = await fetch(`${YAHOO}${encodeURIComponent(symbol)}?interval=1d&range=1d`, {
      signal: AbortSignal.timeout(7000),
      headers: { accept: 'application/json' },
    })
    if (!r.ok) return null
    const m = (await r.json())?.chart?.result?.[0]?.meta
    const price = Number(m?.regularMarketPrice)
    if (!isFinite(price) || price <= 0) return null
    const chg = Number(m?.regularMarketChangePercent)
    return { price, changePct: isFinite(chg) ? chg : null }
  } catch {
    return null
  }
}

export default async function handler(): Promise<Response> {
  const json = (body: unknown) =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'access-control-allow-origin': '*',
        'cache-control': 'public, max-age=120, stale-while-revalidate=600',
      },
    })

  /* Every quote is independent: one symbol that fails drops its own row and
     leaves the ranking intact. A table missing Costco still answers the
     question it exists to answer. */
  const [equityQuotes, metalQuotes, coins] = await Promise.all([
    Promise.all(COMPANIES.map((c) => yahoo(c.symbol))),
    Promise.all(METALS.map((m) => yahoo(m.symbol))),
    fetch(COINGECKO, { signal: AbortSignal.timeout(7000) })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null),
  ])

  const rows: Omit<AssetRow, 'rank'>[] = []

  COMPANIES.forEach((c, i) => {
    const q = equityQuotes[i]
    if (!q) return
    rows.push({
      kind: 'company', symbol: c.symbol, name: c.name, country: c.country,
      marketCapUsd: q.price * c.shares, priceUsd: q.price, changePct: q.changePct,
      basis: `${c.shares.toLocaleString('en-US')} shares outstanding, as filed ${c.filed}`,
    })
  })

  METALS.forEach((m, i) => {
    const q = metalQuotes[i]
    if (!q) return
    const ounces = m.tonnes * OZ_PER_TONNE
    rows.push({
      kind: 'metal', symbol: m.name.toUpperCase(), name: m.name, country: null,
      marketCapUsd: q.price * ounces, priceUsd: q.price, changePct: q.changePct,
      basis: `${m.tonnes.toLocaleString('en-US')} tonnes above ground — ${m.source}`,
    })
  })

  if (Array.isArray(coins)) {
    CRYPTO.forEach((c) => {
      const hit = coins.find((x: any) => x?.id === c.id)
      const cap = Number(hit?.market_cap)
      const px = Number(hit?.current_price)
      if (!isFinite(cap) || !isFinite(px)) return
      const chg = Number(hit?.price_change_percentage_24h)
      rows.push({
        kind: 'crypto', symbol: c.symbol, name: c.name, country: null,
        marketCapUsd: cap, priceUsd: px, changePct: isFinite(chg) ? chg : null,
        basis: 'circulating supply x price, as reported by CoinGecko',
      })
    })
  }

  rows.sort((a, b) => b.marketCapUsd - a.marketCapUsd)
  const ranked: AssetRow[] = rows.map((r, i) => ({ rank: i + 1, ...r }))

  return json({
    asOf: new Date().toISOString(),
    assets: ranked,
    total: ranked.length,
    expected: COMPANIES.length + METALS.length + CRYPTO.length,
    bitcoinRank: ranked.find((r) => r.symbol === 'BTC')?.rank ?? null,
    note:
      'Market capitalisation is computed from a live price and a share or unit count, not quoted. ' +
      'Company share counts come from SEC filings and are refreshed quarterly. This is a selected ' +
      'list, not every listed company.',
  })
}

export const config = { path: '/api/assets' }
