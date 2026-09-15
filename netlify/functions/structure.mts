/* ──────────────────────────────────────────────────────────────────────────
   Market structure — the derivatives tab's data.

   Funding, basis, open interest and implied volatility: the four numbers that
   tell a client what positioning looks like, rather than what price is. A
   sophisticated client opens this. Nobody else has to.

   Server-side for the same reason as the macro strip. The venue answers
   public, keyless requests but sends no CORS header, so a browser on
   satstreet.netlify.app is refused before it sees a byte.

   Everything here is derived rather than reported, so the arithmetic is the
   part worth reviewing:

     funding    quoted per 8-hour period; annualised as rate x 3 x 365
     basis      perpetual mark against the spot index, in percent
     open int.  USD notional, as the venue reports it
     implied    the venue's own 30-day volatility index

   One venue is one venue. This is a read on positioning at a single large
   options and futures exchange, not the whole market, and the page says so.
   ────────────────────────────────────────────────────────────────────────── */

const API = 'https://www.deribit.com/api/v2/public/'

/** Funding is quoted per 8h. Three periods a day, 365 days. */
const PERIODS_PER_YEAR = 3 * 365

interface Structure {
  asset: 'BTC' | 'ETH'
  /** Annualised, in percent. Positive means longs are paying shorts. */
  fundingAnnualPct: number | null
  /** Perpetual mark against the spot index, in percent. */
  basisPct: number | null
  /** USD notional. */
  openInterestUsd: number | null
  /** The venue's 30-day implied volatility index. */
  impliedVol: number | null
  volume24hUsd: number | null
  /** Annualised premium of each dated future over the index, by expiry.
      Upward sloping is contango, downward is backwardation. */
  curve: { label: string; days: number; annualPct: number }[]
  /** Recent 30-day implied volatility, oldest first. */
  volHistory: number[]
  /** Recent funding, annualised, oldest first. */
  fundingHistory: number[]
  error?: string
}

async function json(path: string): Promise<unknown> {
  const r = await fetch(API + path, { signal: AbortSignal.timeout(6000) })
  if (!r.ok) throw new Error(`http ${r.status}`)
  const body = (await r.json()) as { result?: unknown; error?: { message?: string } }
  if (body.error) throw new Error(body.error.message ?? 'venue error')
  return body.result
}

async function impliedVol(currency: string): Promise<number | null> {
  try {
    const now = Date.now()
    const r = (await json(
      `get_volatility_index_data?currency=${currency}&start_timestamp=${now - 86_400_000}` +
        `&end_timestamp=${now}&resolution=3600`,
    )) as { data?: number[][] }
    const rows = r?.data ?? []
    if (!rows.length) return null
    // Each row is [timestamp, open, high, low, close]; the last close is now.
    const close = rows[rows.length - 1]?.[4]
    return typeof close === 'number' && isFinite(close) ? close : null
  } catch {
    return null
  }
}

/* Deribit names dated futures BTC-27NOV26. The annualised premium over the
   index is what says whether the curve is in contango, and it is the only
   honest way to compare a September contract with a June one. */
const MONTHS = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC']

function expiryOf(name: string): Date | null {
  const m = /-(\d{1,2})([A-Z]{3})(\d{2})$/.exec(name)
  if (!m) return null
  const month = MONTHS.indexOf(m[2])
  if (month < 0) return null
  return new Date(Date.UTC(2000 + Number(m[3]), month, Number(m[1]), 8, 0, 0))
}

async function curveFor(currency: string, index: number | null): Promise<Structure['curve']> {
  if (!index || !isFinite(index)) return []
  try {
    const res: any = await json(`get_book_summary_by_currency?currency=${currency}&kind=future`)
    const rows: any[] = Array.isArray(res) ? res : []
    const now = Date.now()
    return rows
      .map((row) => {
        const expiry = expiryOf(String(row.instrument_name || ''))
        const mark = Number(row.mark_price)
        if (!expiry || !isFinite(mark)) return null
        const days = (expiry.getTime() - now) / 86400000
        if (days <= 0.5) return null
        return {
          label: String(row.instrument_name).replace(/^[A-Z]+-/, ''),
          days: Math.round(days),
          annualPct: (mark / index - 1) * (365 / days) * 100,
        }
      })
      .filter(Boolean)
      .sort((a: any, b: any) => a.days - b.days) as Structure['curve']
  } catch {
    return []
  }
}

/* Seven days of history, thinned to something a sparkline can draw. */
function thin(values: number[], target = 60): number[] {
  if (values.length <= target) return values
  const step = values.length / target
  const out: number[] = []
  for (let i = 0; i < target; i += 1) out.push(values[Math.floor(i * step)])
  return out
}

async function volHistoryFor(currency: string): Promise<number[]> {
  try {
    const end = Date.now()
    const res: any = await json(
      `get_volatility_index_data?currency=${currency}&start_timestamp=${end - 7 * 86400000}` +
      `&end_timestamp=${end}&resolution=3600`,
    )
    const rows: any[] = res?.data ?? []
    return thin(rows.map((r) => Number(r[4])).filter((n) => isFinite(n)))
  } catch {
    return []
  }
}

async function fundingHistoryFor(currency: string): Promise<number[]> {
  try {
    const end = Date.now()
    const res: any = await json(
      `get_funding_rate_history?instrument_name=${currency}-PERPETUAL` +
      `&start_timestamp=${end - 7 * 86400000}&end_timestamp=${end}`,
    )
    const rows: any[] = Array.isArray(res) ? res : []
    return thin(rows.map((r) => Number(r.interest_8h) * PERIODS_PER_YEAR * 100).filter((n) => isFinite(n)))
  } catch {
    return []
  }
}

async function forAsset(asset: 'BTC' | 'ETH'): Promise<Structure> {
  const base: Structure = {
    asset, fundingAnnualPct: null, basisPct: null,
    openInterestUsd: null, impliedVol: null, volume24hUsd: null,
    curve: [], volHistory: [], fundingHistory: [],
  }

  try {
    /* History and the curve are decoration around the four headline
       numbers, so each is allowed to fail on its own. */
    const [summary, vol, volHistory, fundingHistory] = await Promise.all([
      json(`get_book_summary_by_instrument?instrument_name=${asset}-PERPETUAL`) as Promise<
        Record<string, number>[]
      >,
      impliedVol(asset),
      volHistoryFor(asset),
      fundingHistoryFor(asset),
    ])

    const s = summary?.[0]
    if (!s) return { ...base, error: 'no perpetual summary' }

    const funding8h = Number(s.funding_8h)
    const mark = Number(s.mark_price)
    const index = Number(s.estimated_delivery_price)

    return {
      ...base,
      fundingAnnualPct: isFinite(funding8h) ? funding8h * PERIODS_PER_YEAR * 100 : null,
      basisPct: isFinite(mark) && isFinite(index) && index !== 0 ? ((mark - index) / index) * 100 : null,
      openInterestUsd: isFinite(Number(s.open_interest)) ? Number(s.open_interest) : null,
      volume24hUsd: isFinite(Number(s.volume_usd)) ? Number(s.volume_usd) : null,
      impliedVol: vol,
      curve: await curveFor(asset, isFinite(index) ? index : null),
      volHistory,
      fundingHistory,
    }
  } catch (e) {
    return { ...base, error: e instanceof Error ? e.message : 'failed' }
  }
}

/* ──────────────────────────────────────────────────────────────────────────
   Cross-venue perpetuals.

   The four headline numbers above describe Deribit. A client asking "what is
   funding" means the market, not one venue, and the venues disagree often
   enough that the disagreement is itself the signal: when one exchange pays
   materially more than the others, it is that venue's positioning that is
   crowded, not the market's.

   Every venue here answers public, keyless requests. Each is allowed to fail
   on its own — a venue that times out drops out of the table rather than
   taking the panel down with it.

   Funding is quoted per interval, and the interval is not the same
   everywhere, so annualising a raw rate by a fixed multiple is wrong. Bybit
   reports its interval outright; OKX gives the settlement times and the gap
   between them is the interval; Binance and Deribit run these contracts on
   eight hours. Whatever the interval, the annualisation is the same:
   rate x (8760 / intervalHours).
   ────────────────────────────────────────────────────────────────────────── */

const HOURS_PER_YEAR = 24 * 365

interface Venue {
  venue: string
  /** Annualised, in percent. Positive means longs are paying shorts. */
  fundingAnnualPct: number | null
  /** The venue's funding period, in hours. */
  intervalHours: number | null
  /** USD notional open on the venue's USD-margined BTC perpetual. */
  openInterestUsd: number | null
  error?: string
}

async function fetchJson(url: string): Promise<any> {
  const r = await fetch(url, { signal: AbortSignal.timeout(6000) })
  if (!r.ok) throw new Error(`http ${r.status}`)
  return r.json()
}

function annualise(rate: number, intervalHours: number): number {
  return rate * (HOURS_PER_YEAR / intervalHours) * 100
}

async function bybitVenue(): Promise<Venue> {
  const base: Venue = { venue: 'Bybit', fundingAnnualPct: null, intervalHours: null, openInterestUsd: null }
  try {
    const d = await fetchJson('https://api.bybit.com/v5/market/tickers?category=linear&symbol=BTCUSDT')
    const t = d?.result?.list?.[0]
    if (!t) throw new Error('no ticker')
    const hours = Number(t.fundingIntervalHour) || 8
    const rate = Number(t.fundingRate)
    const oi = Number(t.openInterestValue)
    return {
      ...base,
      intervalHours: hours,
      fundingAnnualPct: isFinite(rate) ? annualise(rate, hours) : null,
      openInterestUsd: isFinite(oi) ? oi : null,
    }
  } catch (e) {
    return { ...base, error: e instanceof Error ? e.message : 'failed' }
  }
}

async function okxVenue(): Promise<Venue> {
  const base: Venue = { venue: 'OKX', fundingAnnualPct: null, intervalHours: null, openInterestUsd: null }
  try {
    const [f, o] = await Promise.all([
      fetchJson('https://www.okx.com/api/v5/public/funding-rate?instId=BTC-USDT-SWAP'),
      fetchJson('https://www.okx.com/api/v5/public/open-interest?instType=SWAP&instId=BTC-USDT-SWAP')
        .catch(() => null),
    ])
    const row = f?.data?.[0]
    if (!row) throw new Error('no funding row')
    /* The gap between this settlement and the next is the period. OKX has
       run BTC-USDT-SWAP on both four and eight hours, so it is read rather
       than assumed. */
    const span = (Number(row.nextFundingTime) - Number(row.fundingTime)) / 3_600_000
    const hours = isFinite(span) && span > 0 ? Math.round(span) : 8
    const rate = Number(row.fundingRate)
    const oi = Number(o?.data?.[0]?.oiUsd)
    return {
      ...base,
      intervalHours: hours,
      fundingAnnualPct: isFinite(rate) ? annualise(rate, hours) : null,
      openInterestUsd: isFinite(oi) ? oi : null,
    }
  } catch (e) {
    return { ...base, error: e instanceof Error ? e.message : 'failed' }
  }
}

async function binanceVenue(): Promise<Venue> {
  const base: Venue = { venue: 'Binance', fundingAnnualPct: null, intervalHours: 8, openInterestUsd: null }
  try {
    /* Binance reports open interest in coin, not notional, so it is marked
       at the same mark price the funding call already returns. */
    const [p, o] = await Promise.all([
      fetchJson('https://fapi.binance.com/fapi/v1/premiumIndex?symbol=BTCUSDT'),
      fetchJson('https://fapi.binance.com/fapi/v1/openInterest?symbol=BTCUSDT').catch(() => null),
    ])
    const rate = Number(p?.lastFundingRate)
    const mark = Number(p?.markPrice)
    const coin = Number(o?.openInterest)
    return {
      ...base,
      fundingAnnualPct: isFinite(rate) ? annualise(rate, 8) : null,
      openInterestUsd: isFinite(coin) && isFinite(mark) ? coin * mark : null,
    }
  } catch (e) {
    return { ...base, error: e instanceof Error ? e.message : 'failed' }
  }
}

/* ──────────────────────────────────────────────────────────────────────────
   Options: skew and term structure.

   Both come out of one call. get_book_summary_by_currency returns every
   listed option with its mark implied volatility and, usefully, the forward
   for its own expiry — so each expiry can be measured against its own
   forward rather than against spot.

   Delta is not in that response, so it is computed. These are European
   options on a forward with no carry left to model, which is Black-76:

     d1    = ( ln(F/K) + sigma^2 T / 2 ) / ( sigma sqrt(T) )
     call  = N(d1)
     put   = N(d1) - 1

   Risk reversal is then IV(25-delta call) minus IV(25-delta put), in
   volatility points. Negative means the market is paying up for downside
   protection; positive means it is paying up for upside. It is the cleanest
   one-number read on which tail the options market is worried about, and it
   is what a client is really asking for when they ask how options are
   positioned.

   No listed strike sits exactly on 25 delta, so the two strikes either side
   of it are interpolated.
   ────────────────────────────────────────────────────────────────────────── */

interface OptionsView {
  /** Expiry the risk reversal is measured on — the listed expiry nearest 30 days. */
  skewLabel: string | null
  skewDays: number | null
  /** IV(25d call) - IV(25d put), in vol points. Negative means puts are bid. */
  riskReversal25d: number | null
  call25dIv: number | null
  put25dIv: number | null
  /** At-the-money implied volatility on that same expiry. */
  atmIv: number | null
  /** At-the-money implied volatility by expiry, near to far. */
  term: { label: string; days: number; atmIv: number }[]
  error?: string
}

/** Abramowitz & Stegun 26.2.17. Max absolute error 7.5e-8 — far finer than
    the strike spacing this feeds. */
function normCdf(x: number): number {
  const b = [0.319381530, -0.356563782, 1.781477937, -1.821255978, 1.330274429]
  const p = 0.2316419
  const a = Math.abs(x)
  const t = 1 / (1 + p * a)
  const poly = t * (b[0] + t * (b[1] + t * (b[2] + t * (b[3] + t * b[4]))))
  const nd = 0.3989422804014327 * Math.exp((-a * a) / 2) * poly
  return x >= 0 ? 1 - nd : nd
}

interface Leg {
  strike: number
  isCall: boolean
  iv: number
  forward: number
  days: number
  label: string
  expiryMs: number
}

const OPT_RE = /^[A-Z]+-(\d{1,2})([A-Z]{3})(\d{2})-([\d.]+)-([CP])$/

function parseLeg(row: any, now: number): Leg | null {
  const m = OPT_RE.exec(String(row?.instrument_name ?? ''))
  if (!m) return null
  const month = MONTHS.indexOf(m[2])
  if (month < 0) return null
  const expiryMs = Date.UTC(2000 + Number(m[3]), month, Number(m[1]), 8, 0, 0)
  const days = (expiryMs - now) / 86_400_000
  const iv = Number(row.mark_iv)
  const forward = Number(row.underlying_price)
  const strike = Number(m[4])
  /* Under a day the delta surface is degenerate and the at-the-money point
     is dominated by the clock rather than by vol. */
  if (!(days > 1) || !isFinite(iv) || iv <= 0 || iv > 500) return null
  if (!isFinite(forward) || forward <= 0 || !isFinite(strike) || strike <= 0) return null
  return {
    strike, isCall: m[5] === 'C', iv, forward, days,
    label: `${m[1]}${m[2]}${m[3]}`, expiryMs,
  }
}

function deltaOf(leg: Leg): number {
  const T = leg.days / 365
  const s = leg.iv / 100
  const d1 = (Math.log(leg.forward / leg.strike) + (s * s * T) / 2) / (s * Math.sqrt(T))
  const nd1 = normCdf(d1)
  return leg.isCall ? nd1 : nd1 - 1
}

/** Interpolate implied vol at a target delta across the listed strikes. */
function ivAtDelta(legs: Leg[], target: number): number | null {
  const pts = legs
    .map((l) => ({ d: deltaOf(l), iv: l.iv }))
    .filter((p) => isFinite(p.d) && Math.abs(p.d) > 0.01 && Math.abs(p.d) < 0.99)
    .sort((a, b) => a.d - b.d)
  if (pts.length < 2) return null
  if (target <= pts[0].d) return pts[0].iv
  if (target >= pts[pts.length - 1].d) return pts[pts.length - 1].iv
  for (let i = 0; i < pts.length - 1; i += 1) {
    const lo = pts[i], hi = pts[i + 1]
    if (target >= lo.d && target <= hi.d) {
      const span = hi.d - lo.d
      if (span === 0) return lo.iv
      return lo.iv + ((target - lo.d) / span) * (hi.iv - lo.iv)
    }
  }
  return null
}

/** At-the-money vol for one expiry: the listed strike nearest that expiry's
    own forward, averaging the call and the put where both are listed. */
function atmOf(legs: Leg[]): number | null {
  if (!legs.length) return null
  const f = legs[0].forward
  let best = Infinity
  for (const l of legs) best = Math.min(best, Math.abs(l.strike - f))
  const at = legs.filter((l) => Math.abs(Math.abs(l.strike - f) - best) < 1e-9)
  if (!at.length) return null
  return at.reduce((s, l) => s + l.iv, 0) / at.length
}

async function optionsFor(currency: string): Promise<OptionsView> {
  const base: OptionsView = {
    skewLabel: null, skewDays: null, riskReversal25d: null,
    call25dIv: null, put25dIv: null, atmIv: null, term: [],
  }
  try {
    const res: any = await json(`get_book_summary_by_currency?currency=${currency}&kind=option`)
    const rows: any[] = Array.isArray(res) ? res : []
    const now = Date.now()

    const byExpiry = new Map<number, Leg[]>()
    for (const row of rows) {
      const leg = parseLeg(row, now)
      if (!leg) continue
      const bucket = byExpiry.get(leg.expiryMs)
      if (bucket) bucket.push(leg)
      else byExpiry.set(leg.expiryMs, [leg])
    }
    if (!byExpiry.size) return { ...base, error: 'no options listed' }

    /* An expiry with only a handful of strikes cannot carry a 25-delta
       reading, and its at-the-money point is noise. Six is the floor. */
    const expiries = [...byExpiry.entries()]
      .map(([ms, legs]) => ({ ms, legs, days: legs[0].days, label: legs[0].label }))
      .filter((e) => e.legs.length >= 6)
      .sort((a, b) => a.days - b.days)
    if (!expiries.length) return { ...base, error: 'no expiry with enough strikes' }

    const term = expiries
      .map((e) => {
        const atmIv = atmOf(e.legs)
        return atmIv === null ? null : { label: e.label, days: Math.round(e.days), atmIv }
      })
      .filter(Boolean) as OptionsView['term']

    /* Thirty days is the convention for a headline skew — long enough to be
       about positioning rather than the next print, short enough to still be
       the expiry people are actually trading. */
    let target = expiries[0]
    for (const e of expiries) {
      if (Math.abs(e.days - 30) < Math.abs(target.days - 30)) target = e
    }
    const calls = target.legs.filter((l) => l.isCall)
    const puts = target.legs.filter((l) => !l.isCall)
    const call25 = ivAtDelta(calls, 0.25)
    const put25 = ivAtDelta(puts, -0.25)

    return {
      ...base,
      skewLabel: target.label,
      skewDays: Math.round(target.days),
      call25dIv: call25,
      put25dIv: put25,
      riskReversal25d: call25 !== null && put25 !== null ? call25 - put25 : null,
      atmIv: atmOf(target.legs),
      term,
    }
  } catch (e) {
    return { ...base, error: e instanceof Error ? e.message : 'failed' }
  }
}

export default async function handler(): Promise<Response> {
  /* The two perpetual cards, the cross-venue table and the options view are
     independent reads. None of them should be able to take the others down,
     so they are gathered together and each failure stays local. */
  const [assets, bybit, okx, binance, options] = await Promise.all([
    Promise.all([forAsset('BTC'), forAsset('ETH')]),
    bybitVenue(),
    okxVenue(),
    binanceVenue(),
    optionsFor('BTC'),
  ])

  const btc = assets[0]

  /* Deribit's row is already paid for above. Its BTC perpetual is the
     inverse contract, which the venue reports in USD notional, so it lands
     in the same units as the three linear books beside it. */
  const deribit: Venue = {
    venue: 'Deribit',
    fundingAnnualPct: btc.fundingAnnualPct,
    intervalHours: 8,
    openInterestUsd: btc.openInterestUsd,
    ...(btc.error ? { error: btc.error } : {}),
  }

  const venues: Venue[] = [binance, bybit, okx, deribit]
  const reporting = venues.filter((v) => v.openInterestUsd !== null)
  const funded = venues.filter((v) => v.fundingAnnualPct !== null)

  return new Response(
    JSON.stringify({
      asOf: new Date().toISOString(),
      venue: 'Deribit',
      assets,
      venues,
      /* Only the venues that answered. A sum that quietly drops an exchange
         is worse than a sum that says how many it covers. */
      aggregate: {
        openInterestUsd: reporting.length
          ? reporting.reduce((s, v) => s + (v.openInterestUsd ?? 0), 0)
          : null,
        venuesReporting: reporting.length,
        venuesTotal: venues.length,
        /* Open-interest weighted, so a thin venue paying 40% does not drag
           the headline. Falls back to a plain mean if no venue reported size. */
        fundingAnnualPct: funded.length
          ? (() => {
              const w = funded.filter((v) => v.openInterestUsd)
              if (!w.length) {
                return funded.reduce((s, v) => s + (v.fundingAnnualPct ?? 0), 0) / funded.length
              }
              const total = w.reduce((s, v) => s + (v.openInterestUsd ?? 0), 0)
              return w.reduce((s, v) => s + (v.fundingAnnualPct ?? 0) * (v.openInterestUsd ?? 0), 0) / total
            })()
          : null,
      },
      options,
      degraded: [
        ...assets.filter((a) => a.error).map((a) => a.asset),
        ...venues.filter((v) => v.error).map((v) => v.venue),
        ...(options.error ? ['options'] : []),
      ],
      note:
        'Positioning at a single venue, not the whole market. Funding is annualised from the ' +
        '8-hour rate; basis is the perpetual mark against the spot index.',
    }),
    {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'access-control-allow-origin': '*',
        'cache-control': 'public, max-age=60, stale-while-revalidate=180',
      },
    },
  )
}

export const config = { path: '/api/structure' }
