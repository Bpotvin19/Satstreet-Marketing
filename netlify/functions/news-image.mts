/* Tiny image proxy.

   Publisher and filing CDNs often refuse a hotlink from the terminal origin.
   On the desk build this serves the Must-read thumbs; on this branch its only
   caller is the Treasuries page, fetching company logos.

   It cannot require a key, because an <img> cannot send custom headers. That
   makes it an open fetcher, so what it refuses is the whole of its security:
   non-image bodies, anything over 2 MB, and hosts that are not public.
*/

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Safari/537.36'

function fail(status: number, message: string): Response {
  return new Response(message, {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
  })
}

function isPublicHttp(url: string): boolean {
  try {
    const u = new URL(url)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false
    const host = u.hostname.toLowerCase()
    if (host === 'localhost' || host.endsWith('.local')) return false
    if (host === '[::1]' || host === '::1') return false
    if (host.startsWith('[fe80:') || host.startsWith('[fc') || host.startsWith('[fd')) return false
    if (/^(0|10|127)\./.test(host)) return false
    if (/^192\.168\./.test(host)) return false
    if (/^169\.254\./.test(host)) return false
    if (/^172\.(1[6-9]|2[0-9]|3[01])\./.test(host)) return false
    return true
  } catch {
    return false
  }
}

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== 'GET') return fail(405, 'Method not allowed')
  const url = new URL(request.url).searchParams.get('u') || ''
  if (!isPublicHttp(url)) return fail(400, 'Invalid image URL')

  try {
    const upstream = await fetch(url, {
      headers: { 'user-agent': UA, accept: 'image/avif,image/webp,image/*,*/*;q=0.8' },
      redirect: 'follow',
      signal: AbortSignal.timeout(5000),
    })
    if (!upstream.ok) return fail(502, 'Image unavailable')
    const type = (upstream.headers.get('content-type') || '').split(';')[0].trim()
    if (!/^image\//i.test(type)) return fail(415, 'Not an image')
    const buffer = new Uint8Array(await upstream.arrayBuffer())
    if (buffer.byteLength > 2_000_000) return fail(413, 'Image too large')
    return new Response(buffer, {
      status: 200,
      headers: {
        'content-type': type,
        'cache-control': 'private, max-age=1800',
        'x-content-type-options': 'nosniff',
      },
    })
  } catch {
    return fail(502, 'Image unavailable')
  }
}

export const config = { path: '/api/news-image' }
