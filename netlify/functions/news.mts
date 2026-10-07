/* ──────────────────────────────────────────────────────────────────────────
   Latest crypto news, from Decrypt's public RSS feed.

   Decrypt is used because its articles open freely, where the previous
   source asked readers to sign up first. Clients should not have to create
   an account with a third party to read the news on this site.

   Server-side for the ordinary reason: the feed sends no CORS header, so a
   browser is refused before it sees a byte. The endpoint fetches it, parses
   it and hands the page clean JSON.

   What is shown is what a feed is published for: headline, the feed's own
   one-line summary, the section Decrypt filed it under, and a link to the
   article on decrypt.co. The article body is never fetched or copied. The
   page opens Decrypt's own article page in a reader panel, so the reader is
   on Decrypt's page, under Decrypt's name.

   No sentiment. A directional label on a news item would make Satstreet the
   author of a market judgment it did not make, so the badge slot carries
   the section the publisher filed the piece under instead.

   There is no XML parser in this project's dependencies and one publisher's
   feed does not justify adding one, so the parsing below is deliberately
   narrow: it reads the handful of fields this page renders and ignores the
   rest. Anything it cannot parse is skipped rather than guessed at.
   ────────────────────────────────────────────────────────────────────────── */

const FEED = process.env.NEWS_FEED_URL?.trim() || 'https://decrypt.co/feed'

/** Links are rendered on a client-facing page, so only the publisher's own
    host is allowed through. A feed that started serving links somewhere else
    would be a compromised feed, and the page should not carry it. */
const ALLOWED_HOST = /(^|\.)decrypt\.co$/i

const MAX_ITEMS = 40

/* Sections left off a client-facing market page.

   Decrypt also covers health and wellness, which is not market news. Matched
   case-insensitively as a substring. Override with NEWS_EXCLUDED_SECTIONS, a
   comma list; set it empty to carry everything. */
const EXCLUDED_SECTIONS = (process.env.NEWS_EXCLUDED_SECTIONS ?? 'Health')
  .split(',')
  .map((x) => x.trim().toLowerCase())
  .filter(Boolean)

function isExcludedSection(section: string): boolean {
  if (!section) return false
  const s = section.toLowerCase()
  return EXCLUDED_SECTIONS.some((x) => s.includes(x))
}

interface Item {
  title: string
  link: string
  summary: string
  /** The section Decrypt filed it under — Markets, Business, Technology… */
  section: string
  author: string
  image: string
  /** ISO 8601. The page formats it; the endpoint does not guess a timezone. */
  publishedAt: string
}

/** Unwrap CDATA, decode the entities a feed actually uses, drop any stray
    markup, and collapse whitespace. Ampersand is decoded last so that a
    double-escaped sequence does not unwrap one level too far. */
function decode(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;|&#x27;/gi, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#8217;|&rsquo;/gi, '’')
    .replace(/&#8216;|&lsquo;/gi, '‘')
    .replace(/&#8220;|&ldquo;/gi, '“')
    .replace(/&#8221;|&rdquo;/gi, '”')
    .replace(/&#8212;|&mdash;/gi, '—')
    .replace(/&#8211;|&ndash;/gi, '–')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
}

function tagOf(chunk: string, name: string): string {
  const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i').exec(chunk)
  return m ? decode(m[1]) : ''
}

/** Attribute values are escaped too, and an image URL carries query
    parameters — leaving &amp; in place hands the CDN a broken request. This
    unescapes without decode()'s markup stripping, which a URL must not get. */
function unescapeAttr(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/gi, "'")
    .replace(/&amp;/g, '&')
    .trim()
}

/* Decrypt lists the section first (Markets, Business, Technology…), then
   lowercase coin tags such as "zcash". The first capitalised, non-empty
   category is the section. */
function sectionOf(chunk: string): string {
  const re = /<category(?:\s[^>]*)?>([\s\S]*?)<\/category>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(chunk)) !== null) {
    const name = decode(m[1])
    if (name && /^[A-Z]/.test(name) && name.toLowerCase() !== 'news') return name
  }
  return ''
}

function safeLink(raw: string): string {
  try {
    const u = new URL(raw)
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return ''
    if (!ALLOWED_HOST.test(u.hostname)) return ''
    return u.toString()
  } catch {
    return ''
  }
}

function parse(xml: string): Item[] {
  const out: Item[] = []
  const chunks = xml.split(/<item(?:\s[^>]*)?>/i).slice(1)

  for (const raw of chunks) {
    const chunk = raw.split(/<\/item>/i)[0]
    const title = tagOf(chunk, 'title')
    const link = safeLink(tagOf(chunk, 'link'))
    /* A headline with no article behind it is not worth a row. */
    if (!title || !link) continue

    const section = sectionOf(chunk)
    if (isExcludedSection(section)) continue

    const pub = tagOf(chunk, 'pubDate')
    const when = pub ? new Date(pub) : null
    /* The enclosure is Decrypt's own 1024×512 crop, the right size for a
       card; the full-size thumbnail is the fallback. */
    const rawImg = /<enclosure[^>]*\surl="([^"]+)"/i.exec(chunk)?.[1] ??
      /<media:(?:thumbnail|content)[^>]*\surl="([^"]+)"/i.exec(chunk)?.[1] ?? ''
    const img = rawImg ? unescapeAttr(rawImg) : ''

    out.push({
      title,
      link,
      summary: tagOf(chunk, 'description'),
      section,
      author: tagOf(chunk, 'dc:creator'),
      image: img && /^https:\/\//i.test(img) ? img : '',
      publishedAt: when && !isNaN(when.getTime()) ? when.toISOString() : '',
    })
    if (out.length >= MAX_ITEMS) break
  }
  return out
}

export default async function handler(req: Request): Promise<Response> {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: {
        'content-type': 'application/json',
        'access-control-allow-origin': '*',
        /* The feed declares a five-minute TTL and rebuilds hourly. Two
           minutes of shared cache keeps a busy morning off Decrypt's
           origin without the page ever feeling stale. */
        'cache-control': 'public, max-age=120, stale-while-revalidate=600',
      },
    })

  try {
    const limit = Math.min(
      MAX_ITEMS,
      Math.max(1, Number(new URL(req.url).searchParams.get('limit')) || MAX_ITEMS),
    )

    const r = await fetch(FEED, {
      signal: AbortSignal.timeout(8000),
      headers: { accept: 'application/rss+xml, application/xml, text/xml' },
    })
    if (!r.ok) throw new Error(`feed responded ${r.status}`)

    const items = parse(await r.text())
    if (!items.length) throw new Error('no readable items in the feed')

    return json({
      asOf: new Date().toISOString(),
      source: 'Decrypt',
      sourceUrl: 'https://decrypt.co/news',
      items: items.slice(0, limit),
      error: null,
    })
  } catch (e) {
    /* The page decides what an empty list looks like. The endpoint says
       plainly that it could not read the feed and returns 200 so a news
       outage never renders as a broken terminal. */
    return json({
      asOf: new Date().toISOString(),
      source: 'Decrypt',
      sourceUrl: 'https://decrypt.co/news',
      items: [],
      error: e instanceof Error ? e.message : 'feed unavailable',
    })
  }
}

export const config = { path: '/api/news' }
