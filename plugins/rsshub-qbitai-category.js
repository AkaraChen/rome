// Ported from RSSHub lib/routes/qbitai/category.ts (AGPL-3.0).
// 量子位分类 — the site's own category RSS feed.
//
// WordPress publishes `/category/<name>/feed`, so there is no HTML to parse:
// the listing gives a title, a link, an author, a date and a one-line
// summary. The article body lives on the post page and is read by preview.
//
// The feed is per category and the category names are Chinese; they are
// encoded into the path rather than sent as a query.

export const meta = {
  id: 'rome.rsshub-qbitai-category',
  name: '量子位 · 分类',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: '量子位资讯、数码、智能车、智库与活动分类的最新文章',
  icon: 'https://www.qbitai.com/favicon.ico',
  params: {
    fields: [
      {
        key: 'category',
        type: 'select',
        label: '分类',
        help: '选择要订阅的量子位分类。',
        default: '',
        options: [
          { value: '资讯', label: '资讯' },
          { value: '数码', label: '数码' },
          { value: '智能车', label: '智能车' },
          { value: '智库', label: '智库' },
          { value: '活动', label: '活动' },
        ],
      },
    ],
  },
}

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

function seconds(value) {
  const text = String(value ?? '').trim().replace(/\s*\([^)]*\)\s*$/, '')
  if (!text) return undefined

  // RFC 2822, which is what WordPress emits.
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
  const category = String(ctx.params.category ?? '').trim()
  const allowed = ['资讯', '数码', '智能车', '智库', '活动']

  if (!category) {
    throw new Error('缺少分类：请选择资讯、数码、智能车、智库或活动')
  }

  if (!allowed.includes(category)) {
    throw new Error(`不支持的分类 ${category}：可选值为 ${allowed.join('、')}`)
  }

  const url = `https://www.qbitai.com/category/${encodeURIComponent(category)}/feed`
  ctx.log.debug(`qbitai-category: GET ${url}`)

  const response = await ctx.fetch(url, { headers: { accept: 'application/rss+xml, application/xml' } })

  if (!response.ok) {
    throw new Error(`量子位返回 ${response.status} ${response.statusText}`)
  }

  const xml = await response.text()
  const items = [...xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)]
  const entries = []

  for (const [, item] of items) {
    const link = textTag(item, 'link')
    const title = textTag(item, 'title')
    if (!link || !title) continue

    // The guid is `https://www.qbitai.com/?p=<id>`; the numeric id is what the
    // post keeps for its whole life.
    const guid = textTag(item, 'guid')
    const postId = /\?p=(\d+)/.exec(guid)?.[1]

    const entry = {
      id: postId ? `qbitai:${postId}` : `qbitai:${link}`,
      title,
      url: link,
      summary: plain(rawTag(item, 'description'), 160),
    }

    const author = textTag(item, 'dc:creator')
    if (author) entry.author = author

    const publishedAt = seconds(textTag(item, 'pubDate'))
    if (publishedAt !== undefined) entry.publishedAt = publishedAt

    entries.push(entry)
  }

  if (entries.length === 0) {
    throw new Error('量子位 RSS 源没有返回可解析的条目，源可能已经变了')
  }

  ctx.log.info(`qbitai-category: ${category} ${entries.length} 条`)

  return { entries }
}

export async function preview(ctx) {
  const url = ctx.item?.url
  if (!url) return null

  const content = await ctx.article(url)

  return content === null ? null : { content }
}
