// Ported from RSSHub lib/routes/apple/newsroom.ts (AGPL-3.0).
// Apple Newsroom — /apple/newsroom
//
// Apple publishes an Atom feed of the newsroom, so nothing here is scraped:
// the feed is parsed by hand because the runtime has no XML parser and none is
// needed for a document this regular.
//
// The feed carries a one-line teaser per entry; the article body is fetched by
// `preview` when the entry is opened, not for all twenty on every refresh.

export const meta = {
  id: 'rome.rsshub-apple-newsroom',
  name: 'Apple · Newsroom',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: 'Apple Newsroom 的官方新闻稿',
  icon: 'https://www.apple.com/favicon.ico',
}

const FEED = 'https://www.apple.com/newsroom/rss-feed.rss'

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

function decode(value) {
  return String(value ?? '').replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity) => {
    if (entity[0] === '#') {
      const code = entity[1] === 'x' || entity[1] === 'X'
        ? Number.parseInt(entity.slice(2), 16)
        : Number.parseInt(entity.slice(1), 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : match
    }

    return Object.prototype.hasOwnProperty.call(ENTITIES, entity) ? ENTITIES[entity] : match
  })
}

/// CDATA is the only markup the feed uses inside its text fields, and a `]]>`
/// inside one would have been escaped by the publisher.
function text(source, tag) {
  const match = String(source).match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`))
  if (!match) return undefined

  const raw = match[1].replace(/^<!\[CDATA\[/, '').replace(/\]\]>$/, '')
  return decode(raw).trim() || undefined
}

export async function fetch(ctx) {
  const response = await ctx.fetch(FEED, { headers: { accept: 'application/atom+xml, application/xml, text/xml' } })

  if (!response.ok) {
    throw new Error(`Apple Newsroom 返回 ${response.status}`)
  }

  const xml = await response.text()
  const chunks = xml.match(/<entry>[\s\S]*?<\/entry>/g)

  if (!Array.isArray(chunks) || chunks.length === 0) {
    throw new Error('Apple Newsroom 没有返回条目，订阅源可能已经变了')
  }

  const entries = chunks.map((chunk) => {
    const link = chunk.match(/<link[^>]*rel="alternate"[^>]*href="([^"]+)"/) || chunk.match(/<link[^>]*href="([^"]+)"/)
    const id = text(chunk, 'id') || link?.[1]

    if (!id) {
      throw new Error('Apple Newsroom 有一条没有 id 的条目，订阅源可能已经变了')
    }

    const entry = {
      id: `apple-newsroom:${id}`,
      title: text(chunk, 'title'),
      url: decode(link?.[1] || id),
      author: text(chunk, 'name'),
      summary: text(chunk, 'content') || undefined,
    }

    const enclosure = chunk.match(/<link[^>]*rel="enclosure"[^>]*href="([^"]+)"/)
    if (enclosure) entry.image = decode(enclosure[1])

    const publishedAt = Date.parse(text(chunk, 'updated') || text(chunk, 'published') || '')
    if (Number.isFinite(publishedAt)) entry.publishedAt = Math.floor(publishedAt / 1000)

    return entry
  })

  ctx.log.info(`apple-newsroom: ${entries.length} 条`)

  return { entries }
}

export async function preview(ctx) {
  const content = await ctx.article(ctx.item.url)
  return content ? { content } : null
}
