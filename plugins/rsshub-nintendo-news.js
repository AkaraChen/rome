// Ported from RSSHub lib/routes/nintendo/news.ts (AGPL-3.0).
// Nintendo 香港资讯 — /nintendo/news
//
// The Hong Kong site's topics index, server-rendered. Each card is an anchor
// with `ncmn-u-linkbox`, holding the title, the date and the thumbnail, so the
// list can be read without opening a single article.
//
// RSSHub resolves each article's body from a Next.js flight payload, which
// this runtime cannot decode; `preview` asks the reader's extractor instead
// and answers `null` when there is nothing to add.

export const meta = {
  id: 'rome.rsshub-nintendo-news',
  name: 'Nintendo · 香港资讯',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: 'Nintendo 香港官网刊登的资讯',
  icon: 'https://www.nintendo.com/favicon.ico',
}

// The Hong Kong pages live under a path on the international host — the
// com.hk host only redirects there — so the cards' `/hk/...` hrefs resolve
// against this origin and not against com.hk.
const HOST = 'https://www.nintendo.com'

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

function strip(html) {
  return decode(String(html ?? '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim()
}

/// The card date is `2026.10.16`, which is Hong Kong local time.
function date(text) {
  const match = String(text || '').match(/(\d{4})\.(\d{1,2})\.(\d{1,2})/)
  if (!match) return undefined

  const parsed = Date.parse(`${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}T00:00:00+08:00`)
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : undefined
}

export async function fetch(ctx) {
  const response = await ctx.fetch(`${HOST}/hk/topics`, { headers: { accept: 'text/html' } })

  if (!response.ok) {
    throw new Error(`Nintendo 香港返回 ${response.status}`)
  }

  const html = await response.text()
  const chunks = html.match(/<a href="([^"]*\/topics\/article\/[^"]+)"[^>]*class="ncmn-u-linkbox">[\s\S]*?<\/a>/g)

  if (!Array.isArray(chunks) || chunks.length === 0) {
    throw new Error('Nintendo 香港没有返回资讯，页面结构可能已经变了')
  }

  const seen = new Set()
  const entries = []

  for (const chunk of chunks) {
    const href = chunk.match(/href="([^"]+)"/)[1]
    const title = strip(chunk.match(/class="ncmn-softUnit__name">([\s\S]*?)<\/div>/)?.[1])
    const release = chunk.match(/class="ncmn-softUnit__release">([^<]*)</)?.[1]
    const thumb = chunk.match(/background-image:url\(([^)]+)\)/)?.[1]

    // The index repeats some cards across sections; the article id is the
    // identity, so a repeat is dropped rather than emitted twice.
    const id = href.split('/').pop()
    if (!title || seen.has(id)) continue

    seen.add(id)

    const entry = {
      id: `nintendo-news:${id}`,
      title,
      url: href.startsWith('http') ? href : `${HOST}${href}`,
      author: 'Nintendo 香港',
    }

    if (thumb) entry.image = thumb

    const publishedAt = date(release)
    if (publishedAt !== undefined) entry.publishedAt = publishedAt

    entries.push(entry)
  }

  if (entries.length === 0) {
    throw new Error('Nintendo 香港没有解析出资讯，页面结构可能已经变了')
  }

  ctx.log.info(`nintendo-news: ${entries.length} 条`)

  return { entries }
}

export async function preview(ctx) {
  const content = await ctx.article(ctx.item.url)
  return content ? { content } : null
}
