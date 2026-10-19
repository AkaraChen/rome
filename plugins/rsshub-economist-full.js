// Ported from RSSHub lib/routes/economist/full.ts (AGPL-3.0).
// The Economist 分类 — the magazine publishes an official RSS feed per
// section, so the listing needs no scraping. The article body is read by
// preview, because the pages are metered and not every entry will open.

export const meta = {
  id: 'rome.rsshub-economist-full',
  name: 'The Economist · Category',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: '经济学人各分类的官方 RSS 源',
  icon: 'https://www.economist.com/favicon.ico',
  params: {
    fields: [
      {
        key: 'endpoint',
        type: 'text',
        label: '分类名',
        help: '可在官方 RSS 页面找到，例如 latest 或 china，对应 https://www.economist.com/<分类>/rss.xml',
        default: '',
      },
    ],
  },
}

const LIMIT = 30

const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  ndash: '–', mdash: '—', hellip: '…', lsquo: '‘', rsquo: '’',
  ldquo: '“', rdquo: '”', middot: '·',
}

function decode(text) {
  return String(text).replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (match, entity) => {
    if (entity[0] === '#') {
      const code = entity[1] === 'x' || entity[1] === 'X'
        ? Number.parseInt(entity.slice(2), 16)
        : Number.parseInt(entity.slice(1), 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : match
    }
    return Object.prototype.hasOwnProperty.call(ENTITIES, entity) ? ENTITIES[entity] : match
  })
}

function rawTag(block, name) {
  const match = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i').exec(block)
  if (!match) return ''

  const cdata = /<!\[CDATA\[([\s\S]*?)\]\]>/.exec(match[1])
  return cdata ? cdata[1] : match[1]
}

function textTag(block, name) {
  return decode(rawTag(block, name)).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
}

const MONTHS = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
}

function zone(value) {
  if (!value || value === 'Z' || value === 'UTC' || value === 'GMT') return 0

  const match = /^([+-])(\d{2}):?(\d{2})$/.exec(value)
  if (!match) return 0

  const minutes = Number(match[2]) * 60 + Number(match[3])
  return (match[1] === '-' ? -minutes : minutes) * 60
}

// The feed is RFC 2822, which Date.parse handles inconsistently across
// engines, so the fields are read directly.
function seconds(value) {
  const text = String(value ?? '').trim().replace(/\s*\([^)]*\)\s*$/, '')
  if (!text) return undefined

  const match = /^(?:[A-Za-z]{3},?\s+)?(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([A-Za-z]{3}|[+-]\d{2}:?\d{2})?$/.exec(text)
  if (!match) return undefined

  const month = MONTHS[match[2].toLowerCase()]
  if (month === undefined) return undefined

  const milliseconds = Date.UTC(
    Number(match[3]), month, Number(match[1]),
    Number(match[4]), Number(match[5]), Number(match[6] || 0),
  ) - zone(match[7]) * 1000

  return Number.isFinite(milliseconds) ? Math.floor(milliseconds / 1000) : undefined
}

export async function fetch(ctx) {
  const endpoint = String(ctx.params.endpoint ?? '').trim()

  if (!endpoint) {
    throw new Error('缺少分类名：可在官方 RSS 页面找到，例如 latest 或 china')
  }

  const url = `https://www.economist.com/${encodeURIComponent(endpoint)}/rss.xml`
  ctx.log.debug(`economist-full: GET ${url}`)

  const response = await ctx.fetch(url, { headers: { accept: 'application/rss+xml, application/xml' } })

  if (!response.ok) {
    throw new Error(`经济学人返回 ${response.status} ${response.statusText}`)
  }

  const xml = await response.text()
  const entries = []

  for (const [, item] of xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)) {
    const link = textTag(item, 'link')
    const title = textTag(item, 'title')
    if (!link || !title) continue

    const guid = textTag(item, 'guid')
    const entry = {
      // The feed's guid is a stable UUID; the link is the fallback.
      id: `economist:${guid || link}`,
      title,
      url: link,
      summary: textTag(item, 'description'),
    }

    const publishedAt = seconds(textTag(item, 'pubDate'))
    if (publishedAt !== undefined) entry.publishedAt = publishedAt

    entries.push(entry)

    if (entries.length >= LIMIT) break
  }

  if (entries.length === 0) {
    throw new Error('经济学人 RSS 源没有返回可解析的条目，源可能已经变了')
  }

  ctx.log.info(`economist-full: ${endpoint} ${entries.length} 篇`)

  return { entries, icon: 'https://www.economist.com/favicon.ico' }
}

export async function preview(ctx) {
  const url = ctx.item?.url
  if (!url) return null

  const content = await ctx.article(url)
  return content === null ? null : { content }
}
