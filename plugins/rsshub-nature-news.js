// Ported from RSSHub lib/routes/nature/news.ts (AGPL-3.0).
// Nature — latest news.
//
// The listing is server-rendered HTML with stable class names, so it is parsed
// with string scans: every card starts with `c-article-item__content` and
// carries an `/articles/...` link, an h3 title and a date. There is no DOM in
// the plugin runtime.
//
// nature.com answers a request without a browser User-Agent with a consent
// interstitial instead of the page, so one is sent. Some clients are also given
// a thin "Client Challenge" document instead of the listing; the flagship
// journal's own RSS feed is not challenged, so it is used as a fallback. That
// feed carries the whole journal rather than the news section alone.

export const meta = {
  id: 'rome.rsshub-nature-news',
  name: 'Nature · News',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: '自然杂志最新新闻报道',
  icon: 'https://www.nature.com/favicon.ico',
}

const BASE = 'https://www.nature.com'
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'
const MONTHS = {
  JAN: 1,
  FEB: 2,
  MAR: 3,
  APR: 4,
  MAY: 5,
  JUN: 6,
  JUL: 7,
  AUG: 8,
  SEP: 9,
  OCT: 10,
  NOV: 11,
  DEC: 12,
}

function decode(text) {
  const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }
  return String(text).replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity) => {
    if (entity[0] === '#') {
      const code = entity[1] === 'x' || entity[1] === 'X'
        ? Number.parseInt(entity.slice(2), 16)
        : Number.parseInt(entity.slice(1), 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : match
    }
    return Object.prototype.hasOwnProperty.call(entities, entity) ? entities[entity] : match
  })
}

function strip(html) {
  return decode(String(html).replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim()
}

// Nature prints `16 OCT 2026`; Date.parse does not agree across engines on that
// shape, so the month table is explicit. The magazine dates are UTC.
function dateSeconds(text) {
  const match = /^(\d{1,2})\s+([A-Z]{3})\s+(\d{4})$/.exec(String(text).trim().toUpperCase())
  if (!match || !MONTHS[match[2]]) return undefined
  return Math.floor(Date.UTC(Number(match[3]), MONTHS[match[2]] - 1, Number(match[1])) / 1000)
}

function articleId(href) {
  const path = String(href).split('?')[0].replace(/\/$/, '')
  return path.slice(path.lastIndexOf('/') + 1)
}

function seconds(value) {
  const milliseconds = Date.parse(value)
  return Number.isFinite(milliseconds) ? Math.floor(milliseconds / 1000) : undefined
}

function cdata(text) {
  const value = String(text).trim()
  const wrapped = /^<!\[CDATA\[([\s\S]*?)\]\]>$/.exec(value)
  return strip(wrapped ? wrapped[1] : value)
}

// The bot-check page is served with status 200, so its title is the marker.
function challenged(html) {
  return /<title>\s*Client Challenge\s*<\/title>/i.test(html)
}

// RSS 1.0/RDF: one <item> per article, with dc:creator and dc:date; dates are
// date-only, so they land at UTC midnight.
function parseFeed(xml, prefix) {
  const entries = []

  for (const item of xml.match(/<item\b[\s\S]*?<\/item>/g) || []) {
    const title = cdata((/<title>([\s\S]*?)<\/title>/.exec(item) || [])[1] || '')
    const link = cdata((/<link>([\s\S]*?)<\/link>/.exec(item) || [])[1] || '')
    if (!title || !link) continue

    const id = articleId(link)
    if (!id) continue

    const entry = { id: `${prefix}:${id}`, title, url: link }

    const authors = []
    for (const match of item.matchAll(/<dc:creator>([\s\S]*?)<\/dc:creator>/g)) {
      const author = cdata(match[1])
      if (author) authors.push(author)
    }
    if (authors.length > 0) entry.author = authors.join(', ')

    const date = /<dc:date>([\s\S]*?)<\/dc:date>/.exec(item)
    const publishedAt = date ? seconds(cdata(date[1])) : undefined
    if (publishedAt !== undefined) entry.publishedAt = publishedAt

    entries.push(entry)
  }

  return entries
}

async function feedEntries(ctx, journal, prefix) {
  const response = await ctx.fetch(`${BASE}/${journal}.rss`, {
    headers: { accept: 'application/rss+xml', 'user-agent': UA },
  })

  if (!response.ok) {
    throw new Error(`Nature RSS 返回 ${response.status} ${response.statusText}`)
  }

  const entries = parseFeed(await response.text(), prefix)

  if (entries.length === 0) {
    throw new Error('Nature RSS 结构已变化，未找到文章')
  }

  return entries
}

export async function fetch(ctx) {
  const response = await ctx.fetch(`${BASE}/latest-news`, {
    headers: { accept: 'text/html', 'user-agent': UA },
  })

  if (!response.ok) {
    throw new Error(`Nature 返回 ${response.status} ${response.statusText}`)
  }

  const html = await response.text()

  if (challenged(html)) {
    return { entries: await feedEntries(ctx, 'nature', 'nature:news') }
  }

  const parts = html.split('<div class="c-article-item__content')
  const entries = []
  const seen = new Set()

  for (const part of parts.slice(1)) {
    const link = /<a\s+href="(\/articles\/[^"]+)"/.exec(part)
    const title = /<h3[^>]*class="c-article-item__title[^"]*"[^>]*>([\s\S]*?)<\/h3>/.exec(part)
    if (!link || !title) continue

    const id = articleId(link[1])
    if (!id || seen.has(id)) continue
    seen.add(id)

    const heading = strip(title[1])
    if (!heading) continue

    const entry = {
      id: `nature:news:${id}`,
      title: heading,
      url: new URL(link[1], BASE).href,
    }

    const date = /<span[^>]*class="c-article-item__date"[^>]*>([^<]+)<\/span>/.exec(part)
    const publishedAt = date ? dateSeconds(date[1]) : undefined
    if (publishedAt !== undefined) entry.publishedAt = publishedAt

    entries.push(entry)
  }

  if (entries.length === 0) {
    throw new Error('Nature 新闻页面结构已变化，未找到文章')
  }

  return { entries }
}

export async function preview(ctx) {
  const url = ctx.item?.url
  if (!url) return null
  const content = await ctx.article(url)
  return content === null ? null : { content }
}
