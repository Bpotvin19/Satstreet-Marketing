/* ──────────────────────────────────────────────────────────────────────────
   Event odds, read from Polymarket's public Gamma API.

   What this endpoint is for: a client can see what a liquid market thinks the
   odds of a Fed cut are, without Satstreet having said anything about it. We
   report a third party's prices the same way we report spot or ETF flows. We
   do not interpret them, and the page that renders this carries no Satstreet
   view on any of it.

   Two things are enforced here rather than left to the page.

   Nothing routable to a venue. Polymarket is an exchange, and the upstream
   response carries everything needed to reach a specific orderbook —
   `slug`, `conditionId`, `clobTokenIds`, `marketMakerAddress`. None of it is
   copied into the response below. The browser receives a question, a label,
   a probability and a volume, and there is no identifier in the payload that
   could be assembled into a trade link. That is a property of the shape, not
   a promise about the front end.

   Only markets worth reading. Polymarket's highest-volume markets are US
   election politics, which is not what a bitcoin desk opens this for and not
   something a brokerage should be putting in front of clients. The tag list
   is fixed below and deliberately narrow.
   ────────────────────────────────────────────────────────────────────────── */

const GAMMA = 'https://gamma-api.polymarket.com'

/** The desk's categories, and the upstream tags each is assembled from. */
const CATEGORIES: { label: string; tags: string[]; limit: number }[] = [
  { label: 'Rates and the Fed', tags: ['fed'], limit: 4 },
  { label: 'Bitcoin', tags: ['bitcoin'], limit: 4 },
  { label: 'Ethereum', tags: ['ethereum'], limit: 3 },
  { label: 'Inflation and growth', tags: ['inflation', 'recession'], limit: 3 },
]

/** An outcome the market prices. `probability` is 0–1, straight from the book. */
interface Outcome {
  label: string
  probability: number | null
  volume: number | null
  changeWeek: number | null
}

/** One point on a probability line: unix seconds, and 0-1. */
interface Point {
  t: number
  p: number
}

interface EventOdds {
  question: string
  endDate: string | null
  volume: number | null
  /**
   * True when exactly one outcome can resolve Yes, so the probabilities sum
   * to roughly 100. False for a group of independent questions — "will BTC
   * touch 75k", "touch 85k" — which are priced separately and sum to whatever
   * they sum to. Upstream calls this negRisk. The page has to say which kind
   * a card is, because 380% of probability looks like a broken page to anyone
   * who assumes the first kind.
   */
  exclusive: boolean
  outcomes: Outcome[]
  /**
   * How the market settles, in the venue's own words, and the source it
   * resolves against. Shown so a reader can tell what the number is a
   * probability *of* — "Bitcoin above $100k" means nothing without knowing
   * which price, from which source, at which moment.
   */
  rules: string | null
  /**
   * The leading outcome's probability over the past week.
   *
   * Fetched server-side using the venue's token id, which is the reason this
   * lives here rather than in the page: the id is what addresses an order
   * book, and it must not reach the browser. What crosses is a list of
   * timestamps and probabilities, which addresses nothing.
   */
  history: Point[] | null
}

interface Category {
  label: string
  events: EventOdds[]
  /** False when every upstream call for this category failed. */
  available: boolean
}

/** Parse the JSON-in-a-string fields Gamma returns for outcomes and prices. */
function parseList(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map(String)
  if (typeof raw !== 'string') return []
  try {
    const v = JSON.parse(raw)
    return Array.isArray(v) ? v.map(String) : []
  } catch {
    return []
  }
}

const num = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN
  return Number.isFinite(n) ? n : null
}

/**
 * One market row's implied probability.
 *
 * Gamma returns a binary market as outcomes ["Yes","No"] with matching prices.
 * The Yes price is the implied probability, so the No side is dropped rather
 * than rendered as a second row that says the same thing backwards.
 */
function yesProbability(market: Record<string, unknown>): number | null {
  const outcomes = parseList(market.outcomes)
  const prices = parseList(market.outcomePrices)
  const i = outcomes.findIndex((o) => o.toLowerCase() === 'yes')
  if (i >= 0 && prices[i] !== undefined) return num(prices[i])
  // Not a Yes/No book. Last traded price is the next best read.
  return num(market.lastTradePrice)
}

const norm = (v: string) => v.trim().toLowerCase().replace(/[?.]+$/, '')

/**
 * The venue writes resolution rules as one long block, often repeating the
 * question and trailing into boilerplate. Keep the substance, cap the length
 * at a paragraph break so a card never shows half a sentence.
 */
function rules(raw: unknown, question: string): string | null {
  if (typeof raw !== 'string') return null
  const text = raw.replace(/\r/g, '').trim()

  // Some markets carry a "description" that is just the question again. A
  // disclosure that restates the heading is worse than none: it promises the
  // reader the settlement terms and gives them the title back. Real rules
  // name a source, a timestamp and a rounding convention, and run long.
  if (text.length < 120) return null
  if (norm(text) === norm(question)) return null
  if (text.length <= 900) return text
  const cut = text.lastIndexOf('\n\n', 900)
  return (cut > 300 ? text.slice(0, cut) : text.slice(0, text.lastIndexOf('. ', 900) + 1)).trim()
}

/** The first CLOB token id on a market, which is the Yes side's book. */
function yesToken(market: Record<string, unknown>): string | null {
  const ids = parseList(market.clobTokenIds)
  return ids[0] || null
}

/**
 * A week of the Yes side's price, from the venue's CLOB.
 *
 * Every call here is one more thing that can be slow, so failures are
 * swallowed: a card without a line is worth more than a page that waits.
 */
async function history(token: string): Promise<Point[] | null> {
  try {
    const r = await fetch(
      `https://clob.polymarket.com/prices-history?market=${encodeURIComponent(token)}` +
        '&interval=1w&fidelity=180',
      { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(5000) },
    )
    if (!r.ok) return null
    const body = await r.json()
    const raw: unknown[] = Array.isArray(body?.history) ? body.history : []
    const points = raw
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((x: any) => ({ t: Number(x?.t), p: Number(x?.p) }))
      .filter((x) => Number.isFinite(x.t) && Number.isFinite(x.p))
    return points.length >= 4 ? points : null
  } catch {
    return null
  }
}

/** A row's short label, never a restatement of the card it sits in. */
function label(market: Record<string, unknown>, eventTitle: string): string {
  const group = String(market.groupItemTitle || '').trim()
  if (group) return group
  const question = String(market.question || '').trim()
  if (question && norm(question) !== norm(eventTitle)) return question
  return 'Yes'
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toEvent(ev: any): { event: EventOdds; leadToken: string | null } | null {
  const markets: any[] = Array.isArray(ev?.markets) ? ev.markets : []
  const outcomes: Outcome[] = markets
    .filter((m) => m?.active && !m?.closed)
    .map((m) => ({
      // groupItemTitle is the short label ("25 bps decrease"). A single-market
      // event often has none, and its question is just the event title again —
      // which would render a card whose one row repeats its own heading. That
      // row is the Yes side, so say so.
      label: label(m, String(ev?.title || '')),
      probability: yesProbability(m),
      volume: num(m.volumeNum),
      changeWeek: num(m.oneWeekPriceChange),
    }))
    .filter((o) => o.label && o.probability !== null)
    .sort((a, b) => (b.probability ?? 0) - (a.probability ?? 0))

  if (!outcomes.length) return null

  // The leading outcome's book is the one worth drawing. Its token is kept
  // out of the returned object and handed straight to the history fetch.
  const lead = markets
    .filter((m) => m?.active && !m?.closed)
    .map((m) => ({ m, p: yesProbability(m) }))
    .filter((x) => x.p !== null)
    .sort((a, b) => (b.p ?? 0) - (a.p ?? 0))[0]

  return {
    event: {
      question: String(ev.title || '').trim(),
      endDate: typeof ev.endDate === 'string' ? ev.endDate : null,
      volume: num(ev.volume),
      exclusive: ev.negRisk === true,
      outcomes: outcomes.slice(0, 8),
      rules: rules(ev.description, String(ev.title || '')),
      history: null,
    },
    leadToken: lead ? yesToken(lead.m) : null,
  }
}

async function fetchTag(tag: string, limit: number): Promise<unknown[]> {
  const url =
    `${GAMMA}/events?limit=${limit}&closed=false&archived=false` +
    `&order=volume&ascending=false&tag_slug=${encodeURIComponent(tag)}`
  const r = await fetch(url, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(6000),
  })
  if (!r.ok) throw new Error(`gamma ${r.status}`)
  const body = await r.json()
  return Array.isArray(body) ? body : []
}

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== 'GET') {
    return new Response('Method not allowed', { status: 405 })
  }

  const categories: Category[] = await Promise.all(
    CATEGORIES.map(async (c) => {
      const settled = await Promise.allSettled(c.tags.map((t) => fetchTag(t, c.limit)))
      const ok = settled.filter((s) => s.status === 'fulfilled')
      // Every tag for this category failed: say unavailable rather than empty.
      if (!ok.length) return { label: c.label, events: [], available: false }

      const seen = new Set<string>()
      const rows: { event: EventOdds; leadToken: string | null }[] = []
      for (const s of ok) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        for (const raw of (s as PromiseFulfilledResult<any[]>).value) {
          const row = toEvent(raw)
          // A market tagged both `inflation` and `recession` arrives twice.
          if (!row || seen.has(row.event.question)) continue
          seen.add(row.event.question)
          rows.push(row)
        }
      }
      rows.sort((a, b) => (b.event.volume ?? 0) - (a.event.volume ?? 0))
      const kept = rows.slice(0, c.limit)

      // One line per market, all at once. A line that does not arrive leaves
      // history null and the card simply renders without it.
      await Promise.all(
        kept.map(async (row) => {
          if (!row.leadToken) return
          row.event.history = await history(row.leadToken)
        }),
      )

      return { label: c.label, events: kept.map((r) => r.event), available: true }
    }),
  )

  const anyData = categories.some((c) => c.available && c.events.length)

  return new Response(
    JSON.stringify({
      source: 'Polymarket',
      asOf: new Date().toISOString(),
      available: anyData,
      categories,
    }),
    {
      status: 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        // Odds move, but not fast enough to justify hitting Gamma per visitor.
        'cache-control': 'public, max-age=120, stale-while-revalidate=600',
        'x-content-type-options': 'nosniff',
      },
    },
  )
}

export const config = { path: '/api/forecasts' }
