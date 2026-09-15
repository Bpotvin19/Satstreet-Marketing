/* What this file is for.

   These are source assertions, not behavioural ones, so they are only worth
   writing where the property they guard is one a future edit could break
   without anyone noticing in review. Two qualify: the page must reach the real
   feed rather than a fixture, and it must not become a route to a venue.

   The previous version of this file also grepped for exact user-facing copy
   and for a hardcoded category list. Both were removed deliberately. Copy
   assertions fail on any rewording while proving nothing, and the category
   assertion actively required a list containing AI, Politics, Geopolitics,
   Oil and Commodities — categories /api/forecasts never returns — which
   pinned six permanently disabled filter chips into the UI. */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

const pub = join(process.cwd(), 'public')
const read = (p: string) => readFile(join(pub, p), 'utf8')

test('the page reads the live feed and bundles no fabricated markets', async () => {
  const js = await read('assets/event-odds.js')
  assert.match(js, /fetch\('\/api\/forecasts'/)
  assert.doesNotMatch(js, /mock|fixture|demoMarket|sampleMarket/i)
})

test('nothing on the page can route a client to a venue', async () => {
  const html = await read('event-odds.html')
  const js = await read('assets/event-odds.js')

  // The endpoint strips every venue identifier, so the page has nothing to
  // build a link from. These assertions keep it that way: an <a> added here,
  // or a hardcoded venue host, would undo the whole basis on which this page
  // is client-facing.
  assert.doesNotMatch(js, /<a\s/i, 'the renderer must not emit anchors')
  assert.doesNotMatch(js, /polymarket|kalshi|\bhttps?:\/\//i)

  const anchors = html.match(/<a\s[^>]*href="(?!\.\/)[^"]*"/gi) || []
  assert.deepEqual(anchors, [], 'no outbound links in the markup')

  // Order entry has no place here, in any spelling.
  assert.doesNotMatch(js + html, /buy yes|buy no|place (a )?bet|connect wallet|trade now/i)
})

test('the page says whose numbers these are, and that they are not the desk\'s', async () => {
  const html = await read('event-odds.html')
  assert.match(html, /not a satstreet view/i)
  assert.match(html, /does not operate/i)
  assert.match(html, /not a satstreet forecast|recommendation/i)
})

test('categories come from the feed rather than a fixed list', async () => {
  const js = await read('assets/event-odds.js')
  // Deriving the chips from what arrived is what stops the page advertising
  // sections the endpoint cannot fill.
  assert.match(js, /function renderTabs/)
  assert.match(js, /markets\.forEach/)
  for (const absent of ['Politics', 'Geopolitics', 'Commodities']) {
    assert.doesNotMatch(
      js,
      new RegExp("'" + absent + "'"),
      `${absent} is not a category /api/forecasts returns; it must not be hardcoded`,
    )
  }
})

test('search and the supported sorts are present', async () => {
  const html = await read('event-odds.html')
  assert.match(html, /id="market-search"/)
  assert.match(html, /id="market-sort"/)
  for (const v of ['volume', 'probability', 'closing']) {
    assert.match(html, new RegExp(`value="${v}"`))
  }
})

test('exclusive and independent groups are drawn differently', async () => {
  const js = await read('assets/event-odds.js')
  // One distribution gets one bar; independent questions get their own
  // tracks. Collapsing these into one treatment would assert a relationship
  // between outcomes that does not exist, and would sum past 100% doing it.
  assert.match(js, /function distHtml/)
  assert.match(js, /function tracksHtml/)
  assert.match(js, /m\.exclusive\s*\?/)
  assert.match(js, /do not sum to 100%/)
})

test('an unavailable feed shows nothing rather than something stale', async () => {
  const js = await read('assets/event-odds.js')
  assert.match(js, /temporarily unavailable/i)
  assert.match(js, /function fail/)
  assert.match(js, /Try again/)
})
