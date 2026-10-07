/* Normalized chart history for the Overview focus panel.

   The browser asks for one approved instrument and range. Crypto is sourced
   from Coinbase; the cross-asset references use the same Yahoo chart feed as
   /api/market. Every response includes source and timestamp so the UI never
   presents an anonymous line as real-time market data. */

type Point = { t: number; v: number }
type RangeKey = '1D' | '1W' | '1M' | '3M' | '1Y' | '5Y' | 'ALL'

const RANGE: Record<RangeKey, { days: number; yahooRange: string; yahooInterval: string; coinbase: number }> = {
  '1D': { days: 1, yahooRange: '1d', yahooInterval: '5m', coinbase: 300 },
  '1W': { days: 7, yahooRange: '5d', yahooInterval: '30m', coinbase: 3600 },
  '1M': { days: 30, yahooRange: '1mo', yahooInterval: '1h', coinbase: 21600 },
  '3M': { days: 90, yahooRange: '3mo', yahooInterval: '1d', coinbase: 86400 },
  '1Y': { days: 365, yahooRange: '1y', yahooInterval: '1d', coinbase: 86400 },
  '5Y': { days: 365 * 5, yahooRange: '5y', yahooInterval: '1wk', coinbase: 86400 },
  'ALL': { days: 365 * 30, yahooRange: 'max', yahooInterval: '1mo', coinbase: 86400 },
}

const INSTRUMENTS: Record<string, { provider: 'coinbase' | 'yahoo'; symbol: string; source: string }> = {
  'BTC-USD': { provider: 'coinbase', symbol: 'BTC-USD', source: 'Digital asset venue' },
  'ETH-USD': { provider: 'coinbase', symbol: 'ETH-USD', source: 'Digital asset venue' },
  'GC=F': { provider: 'yahoo', symbol: 'GC=F', source: 'Yahoo Finance' },
  'CL=F': { provider: 'yahoo', symbol: 'CL=F', source: 'Yahoo Finance' },
  'CAD=X': { provider: 'yahoo', symbol: 'CAD=X', source: 'Yahoo Finance' },
  '^TNX': { provider: 'yahoo', symbol: '^TNX', source: 'Yahoo Finance' },
  '^IXIC': { provider: 'yahoo', symbol: '^IXIC', source: 'Yahoo Finance' },
  '^GSPC': { provider: 'yahoo', symbol: '^GSPC', source: 'Yahoo Finance' },
}

async function yahoo(symbol: string, range: RangeKey): Promise<Point[]> {
  const config = RANGE[range]
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${config.yahooRange}&interval=${config.yahooInterval}&events=history`
  const response = await fetch(url, {
    headers: { 'user-agent': 'Mozilla/5.0 (compatible; SatstreetDashboard/1.0)' },
    signal: AbortSignal.timeout(7000),
  })
  if (!response.ok) throw new Error(`upstream http ${response.status}`)
  const result = (await response.json())?.chart?.result?.[0]
  const times: unknown[] = result?.timestamp ?? []
  const closes: unknown[] = result?.indicators?.quote?.[0]?.close ?? []
  return times.flatMap((time, index) => {
    const value = Number(closes[index])
    return typeof time === 'number' && isFinite(value) ? [{ t: time * 1000, v: value }] : []
  })
}

async function coinbase(symbol: string, range: RangeKey): Promise<Point[]> {
  const granularity = RANGE[range].coinbase
  const end = Math.floor(Date.now() / 1000)
  const start = end - RANGE[range].days * 86400
  const chunkSeconds = granularity * 295
  const chunks: Array<{ start: number; end: number }> = []
  for (let cursor = start; cursor < end; cursor += chunkSeconds) {
    chunks.push({ start: cursor, end: Math.min(end, cursor + chunkSeconds) })
  }
  const rows = await Promise.all(chunks.map(async (chunk) => {
    const url = `https://api.exchange.coinbase.com/products/${symbol}/candles?granularity=${granularity}&start=${new Date(chunk.start * 1000).toISOString()}&end=${new Date(chunk.end * 1000).toISOString()}`
    const response = await fetch(url, { signal: AbortSignal.timeout(7000) })
    if (!response.ok) throw new Error(`upstream http ${response.status}`)
    return await response.json() as number[][]
  }))
  const byTime = new Map<number, number>()
  rows.flat().forEach((row) => {
    if (Array.isArray(row) && isFinite(row[0]) && isFinite(row[4])) byTime.set(row[0] * 1000, row[4])
  })
  return [...byTime].sort((a, b) => a[0] - b[0]).map(([t, v]) => ({ t, v }))
}

export default async function handler(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const symbol = url.searchParams.get('symbol') || 'BTC-USD'
  const requestedRange = url.searchParams.get('range') || '1W'
  const range = (requestedRange in RANGE ? requestedRange : '1W') as RangeKey
  /* Beyond the default board, any instrument a client added to their own
     watchlist: a Coinbase pair or a well-formed Yahoo symbol. */
  const instrument = INSTRUMENTS[symbol] ||
    (/^[A-Z0-9]{1,12}-USD$/.test(symbol) ? { provider: 'coinbase' as const, symbol, source: 'Digital asset venue' }
      : /^[\^]?[A-Z0-9.\-]{1,15}(=[XF])?$/.test(symbol) ? { provider: 'yahoo' as const, symbol, source: 'Yahoo Finance' }
      : null)
  if (!instrument) return json({ error: 'unsupported instrument' }, 400)

  try {
    /* Coinbase's candle API is intentionally used for the detailed shorter
       windows. Its 300-candle paging becomes wasteful for multi-year history,
       so 5Y and All use Yahoo's weekly/monthly series for every supported
       ticker, including crypto. */
    const longRange = range === '5Y' || range === 'ALL'
    const points = instrument.provider === 'coinbase' && !longRange
      ? await coinbase(instrument.symbol, range)
      : await yahoo(instrument.symbol, range)
    if (points.length < 2) throw new Error('not enough data returned')
    return json({ symbol, range, source: longRange ? 'Yahoo Finance' : instrument.source, asOf: new Date().toISOString(), points })
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'history unavailable', symbol, range }, 502)
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      'access-control-allow-origin': '*',
      'cache-control': status === 200 ? 'public, max-age=45, stale-while-revalidate=120' : 'no-store',
    },
  })
}

export const config = { path: '/api/history' }
