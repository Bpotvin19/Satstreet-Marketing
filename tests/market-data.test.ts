import test from 'node:test'
import assert from 'node:assert/strict'
import handler from '../netlify/functions/market.mts'

// Synthetic upstream responses are confined to tests, never the shipped UI.
async function quote(meta: Record<string, unknown>, values: Record<string, unknown> = {}) {
  const original = globalThis.fetch
  globalThis.fetch = async () => Response.json({chart:{result:[{meta,indicators:{quote:[values]}}]}})
  try { return (await (await handler(new Request('https://example.test/api/market?symbols=TEST'))).json()).quotes[0] }
  finally { globalThis.fetch = original }
}
test('missing source price stays unavailable rather than becoming zero', async () => {
  const q = await quote({regularMarketPrice:null})
  assert.equal(q.price,null);assert.ok(q.error)
})
test('null prior close and OHLC values do not become reported zeroes', async () => {
  const q = await quote({regularMarketPrice:100,previousClose:null,chartPreviousClose:null}, {close:[null],open:[null],high:[null],low:[null]})
  assert.equal(q.changeAbs,null);assert.equal(q.changePct,null);assert.equal(q.open,null);assert.equal(q.sessionHigh,null);assert.equal(q.sessionLow,null)
})
test('trading hours and currency come directly from reported metadata', async () => {
  const q = await quote({regularMarketPrice:100,previousClose:90,currency:'CAD',exchangeTimezoneName:'America/Toronto',currentTradingPeriod:{regular:{start:1700000000,end:1700003600}}})
  assert.equal(q.changeBasis,'prevClose');assert.equal(q.currency,'CAD');assert.equal(q.exchangeTimezone,'America/Toronto')
  assert.deepEqual(q.tradingPeriod,{start:new Date(1700000000000).toISOString(),end:new Date(1700003600000).toISOString()})
})
test('missing or malformed trading windows remain unreported', async () => {
  for(const regular of [undefined,{start:null,end:1700003600},{start:'1700000000',end:1700003600},{start:1700003600,end:1700000000},{start:1e20,end:2e20}]){
    assert.equal((await quote({regularMarketPrice:100,currentTradingPeriod:{regular}})).tradingPeriod,null)
  }
})
test('missing market timestamp remains unknown', async()=>{
  assert.equal((await quote({regularMarketPrice:100,regularMarketTime:null})).asOf,null)
})
