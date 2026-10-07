/* ──────────────────────────────────────────────────────────────────────────
   US macro backdrop, from FRED (Federal Reserve Bank of St. Louis).

   GET /api/fred  →  { asOf, source, indicators: [...] }

   Eight series chosen for what a Bitcoin client watches: the policy rate,
   inflation, jobs, the curve, real yields, money supply, the Fed's balance
   sheet and the dollar. All are US government data (Federal Reserve, BLS),
   which FRED publishes without copyright restriction; the page credits FRED
   and links each indicator to its series page.

   Data comes from FRED's official API, which needs FRED_API_KEY set in the
   Netlify environment (a free key from fredaccount.stlouisfed.org). FRED's
   keyless CSV download is not used: it times out from cloud hosts. Without
   a key every indicator reports itself unavailable and the Overview hides
   the section. Most series update daily to monthly, so the answer is cached
   at the edge for six hours.
   ────────────────────────────────────────────────────────────────────────── */

type Obs = { date: string; value: number }

interface Spec {
  id: string
  label: string
  /** How the headline number is built from the raw series. */
  transform: 'level' | 'yoy'
  unit: 'pct' | 'bps' | 'trillions' | 'index'
  /** Window the change is measured over, in observations of this frequency. */
  changeOver: number
  changeLabel: string
  frequency: string
  note: string
}

const SERIES: Spec[] = [
  { id: 'DFF', label: 'Fed funds rate', transform: 'level', unit: 'pct', changeOver: 90, changeLabel: 'vs 3 months ago', frequency: 'Daily', note: 'Effective federal funds rate' },
  { id: 'CPIAUCSL', label: 'CPI inflation', transform: 'yoy', unit: 'pct', changeOver: 1, changeLabel: 'vs prior month', frequency: 'Monthly', note: 'Consumer prices, year over year' },
  { id: 'UNRATE', label: 'Unemployment', transform: 'level', unit: 'pct', changeOver: 1, changeLabel: 'vs prior month', frequency: 'Monthly', note: 'US unemployment rate' },
  { id: 'T10Y2Y', label: '10Y – 2Y spread', transform: 'level', unit: 'bps', changeOver: 22, changeLabel: 'vs 1 month ago', frequency: 'Daily', note: 'Yield curve; negative means inverted' },
  { id: 'DFII10', label: '10Y real yield', transform: 'level', unit: 'pct', changeOver: 22, changeLabel: 'vs 1 month ago', frequency: 'Daily', note: 'Inflation-protected 10-year Treasury' },
  { id: 'M2SL', label: 'M2 money supply', transform: 'yoy', unit: 'pct', changeOver: 1, changeLabel: 'vs prior month', frequency: 'Monthly', note: 'Growth, year over year' },
  { id: 'WALCL', label: 'Fed balance sheet', transform: 'level', unit: 'trillions', changeOver: 4, changeLabel: 'vs 4 weeks ago', frequency: 'Weekly', note: 'Total assets held by the Fed' },
  { id: 'DTWEXBGS', label: 'US dollar index', transform: 'level', unit: 'index', changeOver: 22, changeLabel: 'vs 1 month ago', frequency: 'Daily', note: 'Broad trade-weighted dollar' },
]

const KEY = process.env.FRED_API_KEY?.trim()

function since(years: number): string {
  const d = new Date()
  d.setFullYear(d.getFullYear() - years)
  return d.toISOString().slice(0, 10)
}

async function observations(id: string): Promise<Obs[]> {
  const start = since(3)
  if (!KEY) throw new Error('FRED_API_KEY is not set')
  {
    const u = `https://api.stlouisfed.org/fred/series/observations?series_id=${id}&api_key=${KEY}&file_type=json&observation_start=${start}`
    const r = await fetch(u, { signal: AbortSignal.timeout(8000) })
    if (!r.ok) throw new Error(`FRED ${id} http ${r.status}`)
    const d = await r.json()
    return (d.observations || [])
      .map((o: any) => ({ date: o.date, value: Number(o.value) }))
      .filter((o: Obs) => isFinite(o.value))
  }
}

/* Year-over-year percent change, for index series such as CPI and M2. */
function yoy(obs: Obs[]): Obs[] {
  const out: Obs[] = []
  for (let i = 12; i < obs.length; i++) {
    const prev = obs[i - 12].value
    if (prev) out.push({ date: obs[i].date, value: (obs[i].value / prev - 1) * 100 })
  }
  return out
}

async function indicator(s: Spec) {
  try {
    let obs = await observations(s.id)
    if (s.transform === 'yoy') obs = yoy(obs)
    if (s.unit === 'trillions') obs = obs.map((o) => ({ date: o.date, value: o.value / 1e6 })) // millions → trillions
    if (s.unit === 'bps') obs = obs.map((o) => ({ date: o.date, value: o.value * 100 })) // percent → basis points
    if (obs.length < 2) throw new Error('not enough data')
    const last = obs[obs.length - 1]
    const before = obs[Math.max(0, obs.length - 1 - s.changeOver)]
    /* About two years of shape for the sparkline, thinned to ~60 points. */
    const window = obs.slice(-Math.min(obs.length, s.frequency === 'Daily' ? 504 : s.frequency === 'Weekly' ? 104 : 24))
    const step = Math.max(1, Math.ceil(window.length / 60))
    const spark = window.filter((_, i) => i % step === 0 || i === window.length - 1).map((o) => Number(o.value.toFixed(4)))
    return {
      id: s.id, label: s.label, unit: s.unit, frequency: s.frequency, note: s.note,
      value: last.value, date: last.date,
      change: last.value - before.value, changeLabel: s.changeLabel,
      spark, url: `https://fred.stlouisfed.org/series/${s.id}`,
    }
  } catch (e) {
    return { id: s.id, label: s.label, unit: s.unit, error: e instanceof Error ? e.message : 'unavailable', url: `https://fred.stlouisfed.org/series/${s.id}` }
  }
}

export default async () => {
  const indicators = await Promise.all(SERIES.map(indicator))
  const ok = indicators.filter((i: any) => !i.error).length
  return new Response(JSON.stringify({
    asOf: new Date().toISOString(),
    source: 'FRED, Federal Reserve Bank of St. Louis',
    indicators,
  }), {
    headers: {
      'content-type': 'application/json',
      'access-control-allow-origin': '*',
      'cache-control': 'public, max-age=900',
      /* A failed fetch is cached briefly so FRED is retried soon. */
      'netlify-cdn-cache-control': ok ? 'public, durable, s-maxage=21600, stale-while-revalidate=86400' : 'public, s-maxage=60',
    },
  })
}

export const config = { path: '/api/fred' }
