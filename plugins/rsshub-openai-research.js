// Ported from RSSHub lib/routes/openai/research.ts (AGPL-3.0).
// OpenAI Research — the same feed, filtered to the Research category.
//
// The news feed tags every item with one or more categories, and the research
// index is exactly the subset tagged `Research`. Reading the feed and filtering
// it is cheaper and steadier than scraping the index page, which is why this
// port shares the news feed rather than fetching `research/index`.
//
// If the feed ever stops carrying category tags, the filter produces nothing —
// that is a shape change, so it throws instead of looking like an empty source.

export const meta = {
  id: 'rome.rsshub-openai-research',
  name: 'OpenAI · Research',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: 'OpenAI 研究分类的最新论文与文章',
  icon: 'https://openai.com/favicon.ico',
}

const FEED = 'https://openai.com/news/rss.xml'

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

function plain(html, limit) {
  const text = decode(String(html ?? '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim()
  if (!limit || text.length <= limit) return text
  return `${text.slice(0, limit).replace(/\s+$/, '')}…`
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

function tags(block, name) {
  const pattern = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'gi')
  const values = []

  for (const match of block.matchAll(pattern)) {
    const cdata = /<!\[CDATA\[([\s\S]*?)\]\]>/.exec(match[1])
    values.push(decode(cdata ? cdata[1] : match[1]).trim())
  }

  return values
}

const MONTHS = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
}

function zone(value) {
  if (!value || value === 'Z' || /^(UTC|GMT)$/i.test(value)) return 0
  const match = /^([+-])(\d{2}):?(\d{2})$/.exec(value)
  if (!match) return 0

  const minutes = Number(match[2]) * 60 + Number(match[3])
  return (match[1] === '-' ? -minutes : minutes) * 60
}

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
  ctx.log.debug(`openai-research: GET ${FEED}`)

  const response = await ctx.fetch(FEED, { headers: { accept: 'application/rss+xml, application/xml' } })

  if (!response.ok) {
    throw new Error(`OpenAI 返回 ${response.status} ${response.statusText}`)
  }

  const xml = await response.text()
  const items = [...xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)]
  const entries = []
  let tagged = 0

  for (const [, item] of items) {
    const categories = tags(item, 'category')
    if (categories.length > 0) tagged += 1
    if (!categories.includes('Research')) continue

    const link = textTag(item, 'link')
    const title = textTag(item, 'title')
    if (!link || !title) continue

    const guid = textTag(item, 'guid')
    const entry = {
      id: `openai:research:${guid || link}`,
      title,
      url: link,
      summary: plain(rawTag(item, 'description'), 160),
    }

    const publishedAt = seconds(textTag(item, 'pubDate'))
    if (publishedAt !== undefined) entry.publishedAt = publishedAt

    entries.push(entry)
  }

  // An empty result is only honest if the feed really had no Research items.
  // If nothing was tagged at all, the category field disappeared and the
  // filter is no longer doing what it claims.
  if (entries.length === 0 && tagged === 0) {
    throw new Error('OpenAI RSS 源不再包含 category 字段，无法筛选 Research')
  }

  if (entries.length === 0) {
    throw new Error('OpenAI RSS 源里没有 Research 分类的条目，源可能已经变了')
  }

  ctx.log.info(`openai-research: ${entries.length} 条`)

  return { entries }
}

export async function preview(ctx) {
  const url = ctx.item?.url
  if (!url) return null

  const content = await ctx.article(url)

  return content === null ? null : { content }
}
