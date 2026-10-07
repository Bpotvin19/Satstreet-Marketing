import {
  BitcoinServiceError,
  getAddress,
  getBlock,
  getLatestBlocks,
  getNetworkOverview,
  getTransaction,
  search,
} from '../lib/bitcoin-service.mts'

function json(body: unknown, status = 200, cache = 'no-store'): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': '*',
      'cache-control': cache,
      'x-content-type-options': 'nosniff',
    },
  })
}

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== 'GET') return json({ error: 'Use GET.' }, 405)

  const url = new URL(request.url)
  const prefix = '/api/bitcoin/'
  const path = url.pathname.startsWith(prefix) ? url.pathname.slice(prefix.length) : ''

  try {
    const parts = path.split('/').filter(Boolean).map((part) => decodeURIComponent(part))
    if (parts[0] === 'network' && parts.length === 1) {
      return json(await getNetworkOverview(), 200, 'public, max-age=15, stale-while-revalidate=45')
    }
    if (parts[0] === 'blocks' && parts.length === 1) {
      return json(await getLatestBlocks(), 200, 'public, max-age=15, stale-while-revalidate=45')
    }
    if (parts[0] === 'block' && parts[1] && parts.length === 2) {
      return json(await getBlock(parts[1], url.searchParams.get('offset')), 200, 'public, max-age=30, stale-while-revalidate=120')
    }
    if (parts[0] === 'tx' && parts[1] && parts.length === 2) {
      return json(await getTransaction(parts[1]), 200, 'public, max-age=30, stale-while-revalidate=120')
    }
    if (parts[0] === 'address' && parts[1] && parts.length === 2) {
      return json(await getAddress(parts[1]), 200, 'public, max-age=20, stale-while-revalidate=60')
    }
    if (parts[0] === 'search' && parts.length === 1) {
      return json(await search(url.searchParams.get('query') || ''), 200, 'no-store')
    }
    return json({ error: 'Bitcoin endpoint not found.' }, 404)
  } catch (error) {
    if (error instanceof URIError) return json({ error: 'Invalid Bitcoin endpoint.' }, 400)
    if (error instanceof BitcoinServiceError) return json({ error: error.message }, error.status)
    return json({ error: 'Bitcoin network data temporarily unavailable.' }, 502)
  }
}

export const config = { path: '/api/bitcoin/*' }
