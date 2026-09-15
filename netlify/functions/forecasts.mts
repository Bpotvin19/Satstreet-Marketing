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

/** A row's short label, never a restatement of the card it sits in. */
function label(market: Record<string, unknown>, eventTitle: string): string {
  const group = String(market.groupItemTitle || '').trim()
  if (group) return group
  const question = String(market.question || '').trim()
  if (question && norm(question) !== norm(eventTitle)) return question
  return 'Yes'
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toEvent(ev: any): EventOdds | null {
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
  return {
    question: String(ev.title || '').trim(),
    endDate: typeof ev.endDate === 'string' ? ev.endDate : null,
    volume: num(ev.volume),
    exclusive: ev.negRisk === true,
    outcomes: outcomes.slice(0, 8),
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
      const events: EventOdds[] = []
      for (const s of ok) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        for (const raw of (s as PromiseFulfilledResult<any[]>).value) {
          const ev = toEvent(raw)
          // A market tagged both `inflation` and `recession` arrives twice.
          if (!ev || seen.has(ev.question)) continue
          seen.add(ev.question)
          events.push(ev)
        }
      }
      events.sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0))
      return { label: c.label, events: events.slice(0, c.limit), available: true }
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
