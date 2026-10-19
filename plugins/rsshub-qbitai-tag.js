// Ported from RSSHub lib/routes/qbitai/tag.ts (AGPL-3.0).
// 量子位标签 — the same WordPress feed shape as a category, keyed by tag.
//
// `/tag/<tag>/feed` is public for any tag the site has used, so the tag is a
// free-text parameter rather than a closed list. Everything else — id, date,
// author, one-line summary — is identical to the category route.

export const meta = {
  id: 'rome.rsshub-qbitai-tag',
  name: '量子位 · 标签',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: '量子位某个标签下的最新文章',
  icon: 'https://www.qbitai.com/favicon.ico',
  params: {
    fields: [
      {
        key: 'tag',
        type: 'text',
        label: '标签',
        help: '标签名，可在量子位标签页 URL 中找到，例如 大语言模型',
        default: '',
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
  const tag = String(ctx.params.tag ?? '').trim()

  if (!tag) {
    throw new Error('缺少标签：请填写量子位标签页 URL 中的标签名，例如 大语言模型')
  }

  const url = `https://www.qbitai.com/tag/${encodeURIComponent(tag)}/feed`
  ctx.log.debug(`qbitai-tag: GET ${url}`)

  const response = await ctx.fetch(url, { headers: { accept: 'application/rss+xml, application/xml' } })

  if (!response.ok) {
    throw new Error(`量子位标签返回 ${response.status} ${response.statusText}`)
  }

  const xml = await response.text()
  const items = [...xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)]
  const entries = []

  for (const [, item] of items) {
    const link = textTag(item, 'link')
    const title = textTag(item, 'title')
    if (!link || !title) continue

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
    throw new Error('量子位标签 RSS 源没有返回可解析的条目，源可能已经变了')
  }

  ctx.log.info(`qbitai-tag: ${tag} ${entries.length} 条`)

  return { entries }
}

export async function preview(ctx) {
  const url = ctx.item?.url
  if (!url) return null

  const content = await ctx.article(url)

  return content === null ? null : { content }
}
