import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import handler from '../netlify/functions/forecasts.mts'

const originalFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = originalFetch
})

const GET = () => new Request('https://satstreet.test/api/forecasts')

/** One upstream event, shaped the way Gamma actually returns them. */
function gammaEvent(over: Record<string, unknown> = {}) {
  return {
    id: '1',
    title: 'Fed Decision in September?',
    slug: 'fed-decision-in-september',
    endDate: '2026-09-16T00:00:00Z',
    volume: 173722956.59,
    markets: [
      {
        active: true,
        closed: false,
        groupItemTitle: '25 bps decrease',
        question: 'Will the Fed decrease rates by 25 bps?',
        outcomes: '["Yes", "No"]',
        outcomePrices: '["0.82", "0.18"]',
        volumeNum: 90000000,
        oneWeekPriceChange: 0.04,
        conditionId: '0xdeadbeef',
        clobTokenIds: '["111","222"]',
        marketMakerAddress: '0xabc',
      },
      {
        active: true,
        closed: false,
        groupItemTitle: 'No change',
        outcomes: '["Yes", "No"]',
        outcomePrices: '["0.17", "0.83"]',
        volumeNum: 40000000,
        oneWeekPriceChange: -0.04,
      },
    ],
    ...over,
  }
}

function stub(fn: (url: string) => unknown[] | Promise<unknown[]> | Error) {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input)
    const out = await fn(url)
    if (out instanceof Error) throw out
    return new Response(JSON.stringify(out), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }) as typeof fetch

}

test('normalizes a Gamma event into labelled probabilities, highest first', async () => {
  stub(() => [gammaEvent()])
  const body = await (await handler(GET())).json()

  const fed = body.categories.find((c: any) => c.label === 'Rates and the Fed')
  assert.equal(fed.available, true)
  const ev = fed.events[0]
  assert.equal(ev.question, 'Fed Decision in September?')
  assert.deepEqual(
    ev.outcomes.map((o: any) => [o.label, o.probability]),
    [
      ['25 bps decrease', 0.82],
      ['No change', 0.17],
    ],
  )
})

test('no Polymarket identifier survives into the response', async () => {
  stub(() => [gammaEvent()])
  const raw = await (await handler(GET())).text()

  // The upstream payload carries everything needed to reach an order book.
  // None of it may reach the browser, or the page is one string concatenation
  // away from being a route to a venue.
  for (const leak of ['0xdeadbeef', 'clobTokenIds', '111', '222', '0xabc', 'fed-decision-in-september', 'slug', 'conditionId']) {
    assert.equal(raw.includes(leak), false, `leaked ${leak}`)
  }
  assert.equal(raw.includes('polymarket.com'), false)
})

test('a market with no Yes side falls back to the last traded price', async () => {
  stub(() => [
    gammaEvent({
      markets: [
        {
          active: true,
          closed: false,
          groupItemTitle: 'Above $150k',
          outcomes: '["Above", "Below"]',
          outcomePrices: '["0.31", "0.69"]',
          lastTradePrice: 0.31,
        },
      ],
    }),
  ])
  const body = await (await handler(GET())).json()
  const ev = body.categories.find((c: any) => c.label === 'Rates and the Fed').events[0]
  assert.equal(ev.outcomes[0].probability, 0.31)
})

test('closed and inactive markets are dropped, not priced at zero', async () => {
  stub(() => [
    gammaEvent({
      markets: [
        { active: true, closed: false, groupItemTitle: 'Live', outcomes: '["Yes","No"]', outcomePrices: '["0.5","0.5"]' },
        { active: true, closed: true, groupItemTitle: 'Settled', outcomes: '["Yes","No"]', outcomePrices: '["1","0"]' },
        { active: false, closed: false, groupItemTitle: 'Inactive', outcomes: '["Yes","No"]', outcomePrices: '["0.9","0.1"]' },
      ],
    }),
  ])
  const body = await (await handler(GET())).json()
  const ev = body.categories.find((c: any) => c.label === 'Rates and the Fed').events[0]
  assert.deepEqual(ev.outcomes.map((o: any) => o.label), ['Live'])
})

test('an event tagged twice appears once', async () => {
  // Inflation and growth draws on both `inflation` and `recession`.
  stub(() => [gammaEvent({ title: 'How high will inflation get in 2026?' })])
  const body = await (await handler(GET())).json()
  const cat = body.categories.find((c: any) => c.label === 'Inflation and growth')
  assert.equal(cat.events.length, 1)
})

test('an upstream failure reports unavailable rather than an empty book', async () => {
  stub(() => new Error('network down'))
  const res = await handler(GET())
  const body = await res.json()

  assert.equal(res.status, 200)
  assert.equal(body.available, false)
  for (const c of body.categories) {
    assert.equal(c.available, false)
    assert.deepEqual(c.events, [])
  }
})

test('one failing category does not take down the others', async () => {
  stub((url) => (url.includes('tag_slug=fed') ? new Error('down') : [gammaEvent()]))
  const body = await (await handler(GET())).json()

  assert.equal(body.available, true)
  assert.equal(body.categories.find((c: any) => c.label === 'Rates and the Fed').available, false)
  assert.equal(body.categories.find((c: any) => c.label === 'Bitcoin').available, true)
})

test('only the desk categories are requested, and never election politics', async () => {
  const asked: string[] = []
  stub((url) => {
    asked.push(new URL(url).searchParams.get('tag_slug') || '')
    return []
  })
  await handler(GET())

  assert.deepEqual(asked.sort(), ['bitcoin', 'ethereum', 'fed', 'inflation', 'recession'])
})

test('marks a mutually exclusive group, and one that only looks like one', async () => {
  stub((url) =>
    url.includes('tag_slug=fed')
      ? [gammaEvent({ negRisk: true })]
      : [gammaEvent({ title: 'What price will Bitcoin hit in 2026?', negRisk: false })],
  )
  const body = await (await handler(GET())).json()

  const fed = body.categories.find((c: any) => c.label === 'Rates and the Fed').events[0]
  const btc = body.categories.find((c: any) => c.label === 'Bitcoin').events[0]
  assert.equal(fed.exclusive, true)
  // Independent threshold markets. Their prices sum well past 100 and the page
  // has to say so rather than let it read as an error.
  assert.equal(btc.exclusive, false)
})

test('a missing negRisk flag is treated as not exclusive', async () => {
  stub(() => [gammaEvent({ negRisk: undefined })])
  const body = await (await handler(GET())).json()
  assert.equal(body.categories.find((c: any) => c.label === 'Rates and the Fed').events[0].exclusive, false)
})

test('a lone outcome is not labelled with its own card heading', async () => {
  stub(() => [
    gammaEvent({
      title: 'Fed rate hike in 2026?',
      markets: [
        {
          active: true,
          closed: false,
          groupItemTitle: '',
          question: 'Fed rate hike in 2026?',
          outcomes: '["Yes","No"]',
          outcomePrices: '["0.94","0.06"]',
        },
      ],
    }),
  ])
  const body = await (await handler(GET())).json()
  const ev = body.categories.find((c: any) => c.label === 'Rates and the Fed').events[0]
  assert.equal(ev.question, 'Fed rate hike in 2026?')
  assert.equal(ev.outcomes[0].label, 'Yes')
})

test('a genuinely different question is kept as the label', async () => {
  stub(() => [
    gammaEvent({
      title: 'Fed Decision in September?',
      markets: [
        {
          active: true,
          closed: false,
          groupItemTitle: '',
          question: 'Will the Fed hold rates steady?',
          outcomes: '["Yes","No"]',
          outcomePrices: '["0.4","0.6"]',
        },
      ],
    }),
  ])
  const body = await (await handler(GET())).json()
  const ev = body.categories.find((c: any) => c.label === 'Rates and the Fed').events[0]
  assert.equal(ev.outcomes[0].label, 'Will the Fed hold rates steady?')
})

test('rejects a non-GET request', async () => {
  const res = await handler(new Request('https://satstreet.test/api/forecasts', { method: 'POST' }))
  assert.equal(res.status, 405)
})
