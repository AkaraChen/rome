// Ported from OpenCLI clis/bbc/news.js (Apache-2.0).
// BBC News headlines — the broadcaster's public RSS feed, no browser needed.

export const meta = {
  id: 'rome.opencli-bbc-news',
  name: 'BBC · 头条新闻',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: 'BBC 新闻头条，来自官方 RSS 源。',
  icon: 'https://www.bbc.com/favicon.ico',
  params: {
    fields: [
      { key: 'limit', type: 'number', label: '每次抓取条数', help: '最多 50 条', default: 20, min: 1, max: 50 },
    ],
  },
}

const FEED = 'https://feeds.bbci.co.uk/news/rss.xml'

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

function decode(text) {
  return String(text || '').replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity) => {
    if (entity[0] === '#') {
      const code = entity[1] === 'x' || entity[1] === 'X'
        ? Number.parseInt(entity.slice(2), 16)
        : Number.parseInt(entity.slice(1), 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : match
    }
    return Object.prototype.hasOwnProperty.call(ENTITIES, entity) ? ENTITIES[entity] : match
  })
}

function tag(block, name) {
  const pattern = new RegExp(`<${name}(?:\\s[^>]*)?>\\s*(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?\\s*</${name}>`)
  const match = pattern.exec(block)
  return match ? match[1] : ''
}

function plain(html) {
  return decode(String(html || '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim()
}

function seconds(value) {
  if (!value) return undefined
  const milliseconds = Date.parse(value)
  return Number.isFinite(milliseconds) ? Math.floor(milliseconds / 1000) : undefined
}

function integer(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(Math.max(parsed, min), max)
}

export async function fetch(ctx) {
  const limit = integer(ctx.params.limit, 20, 1, 50)

  const response = await ctx.fetch(FEED, {
    headers: {
      'user-agent': 'opencli-bbc-adapter (+https://github.com/jackwener/opencli)',
      accept: 'application/rss+xml, application/xml',
    },
  })

  if (!response.ok) {
    throw new Error(`BBC News RSS 返回 HTTP ${response.status}`)
  }

  const xml = await response.text()
  const entries = []
  const item = /<item[^>]*>([\s\S]*?)<\/item>/g
  let match

  while ((match = item.exec(xml)) !== null && entries.length < limit) {
    const block = match[1]
    const title = plain(tag(block, 'title'))
    const link = decode(tag(block, 'link')).trim()
    const guid = decode(tag(block, 'guid')).trim()
    const address = link || guid

    if (!title || !address) continue

    // guid and link are the same article URL in this feed; either one is a
    // stable identity, the title and description are not.
    entries.push({
      id: `bbc:${guid || address}`,
      title,
      url: address,
      publishedAt: seconds(decode(tag(block, 'pubDate')).trim()),
      summary: plain(tag(block, 'description')).slice(0, 200),
    })
  }

  return { entries }
}

export async function preview(ctx) {
  const content = await ctx.article(ctx.item.url)
  return content === null ? null : { content }
}
