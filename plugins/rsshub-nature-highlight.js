// Ported from RSSHub lib/routes/nature/highlight.ts (AGPL-3.0).
// Nature — research highlights for one journal.
//
// Only some journals publish this section; a journal without it yields an empty
// listing, which is reported as a parse failure rather than a silent empty feed.
//
// nature.com sometimes serves a thin "Client Challenge" document instead of the
// listing to non-browser clients. The journal's own RSS feed is not challenged,
// so it is used as a fallback; it carries the whole journal rather than the
// highlights alone.

export const meta = {
  id: 'rome.rsshub-nature-highlight',
  name: 'Nature · Highlight',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: '自然杂志各期刊的研究亮点',
  icon: 'https://www.nature.com/favicon.ico',
  params: {
    fields: [
      {
        key: 'journal',
        type: 'text',
        label: '期刊简称',
        help: '例如 nature、ng、nbt，默认为 nature',
        default: 'nature',
      },
    ],
  },
}

const BASE = 'https://www.nature.com'
// nature.com answers a request without a browser User-Agent with a consent
// interstitial instead of the page, so one is sent.
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'

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

function seconds(value) {
  const milliseconds = Date.parse(value)
  return Number.isFinite(milliseconds) ? Math.floor(milliseconds / 1000) : undefined
}

function articleId(href) {
  const path = String(href).split('?')[0].replace(/\/$/, '')
  return path.slice(path.lastIndexOf('/') + 1)
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
  const journal = String(ctx.params.journal || 'nature').trim()

  if (!/^[a-z0-9]+$/.test(journal)) {
    throw new Error('期刊简称只能包含小写字母和数字')
  }

  const url = `${BASE}/${journal}/articles?type=research-highlight`
  const response = await ctx.fetch(url, { headers: { accept: 'text/html', 'user-agent': UA } })

  if (!response.ok) {
    throw new Error(`Nature 返回 ${response.status} ${response.statusText}`)
  }

  const html = await response.text()

  if (challenged(html)) {
    return { entries: await feedEntries(ctx, journal, 'nature:highlight') }
  }

  const parts = html.split('<li class="app-article-list-row__item">')
  const entries = []
  const seen = new Set()

  for (const part of parts.slice(1)) {
    const link = /<h3[^>]*class="c-card__title[^"]*"[^>]*>[\s\S]*?<a\s+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(part)
    if (!link) continue

    const id = articleId(link[1])
    if (!id || seen.has(id)) continue
    seen.add(id)

    const title = strip(link[2])
    if (!title) continue

    const entry = {
      id: `nature:highlight:${id}`,
      title,
      url: new URL(link[1], BASE).href,
    }

    const date = /<time[^>]*datetime="([^"]+)"/.exec(part)
    const publishedAt = date ? seconds(date[1]) : undefined
    if (publishedAt !== undefined) entry.publishedAt = publishedAt

    entries.push(entry)
  }

  if (entries.length === 0) {
    throw new Error('Nature 研究亮点页面结构已变化，未找到文章')
  }

  return { entries }
}

export async function preview(ctx) {
  const url = ctx.item?.url
  if (!url) return null
  const content = await ctx.article(url)
  return content === null ? null : { content }
}
