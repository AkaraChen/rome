// Ported from RSSHub lib/routes/solidot/main.ts (AGPL-3.0).
// Solidot 最新消息 — one official RSS feed per subject.
//
// The upstream route scrapes the homepage and then fetches every article for
// its body. The site also publishes `index.rss` on each subject subdomain, and
// that feed already carries the full article text in `description`, so this
// port reads the feed and saves the per-article requests entirely.
//
// `www` is the all-subjects feed, and it is the default.

export const meta = {
  id: 'rome.rsshub-solidot-main',
  name: 'Solidot · 最新消息',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: '奇客资讯网按分类发布的最新消息',
  icon: 'https://www.solidot.org/favicon.ico',
  params: {
    fields: [
      {
        key: 'type',
        type: 'select',
        label: '消息类型',
        help: '对应站点顶部的分类子域名，www 为全部。',
        default: 'www',
        options: [
          { value: 'www', label: '全部' },
          { value: 'startup', label: '创业' },
          { value: 'linux', label: 'Linux' },
          { value: 'science', label: '科学' },
          { value: 'technology', label: '科技' },
          { value: 'mobile', label: '移动' },
          { value: 'apple', label: '苹果' },
          { value: 'hardware', label: '硬件' },
          { value: 'software', label: '软件' },
          { value: 'security', label: '安全' },
          { value: 'games', label: '游戏' },
          { value: 'books', label: '书籍' },
          { value: 'ask', label: 'ask' },
          { value: 'idle', label: 'idle' },
          { value: 'blog', label: '博客' },
          { value: 'cloud', label: '云计算' },
          { value: 'story', label: '奇客故事' },
        ],
      },
    ],
  },
}

const TYPES = [
  'www', 'startup', 'linux', 'science', 'technology', 'mobile', 'apple',
  'hardware', 'software', 'security', 'games', 'books', 'ask', 'idle',
  'blog', 'cloud', 'story',
]

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
  const requested = String(ctx.params.type ?? '').trim() || 'www'
  const type = TYPES.includes(requested) ? requested : 'www'
  const url = `https://${type}.solidot.org/index.rss`

  ctx.log.debug(`solidot: GET ${url}`)

  const response = await ctx.fetch(url, { headers: { accept: 'application/rss+xml, application/xml' } })

  if (!response.ok) {
    throw new Error(`Solidot 返回 ${response.status} ${response.statusText}`)
  }

  const xml = await response.text()
  const items = [...xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)]
  const entries = []

  for (const [, item] of items) {
    const link = textTag(item, 'link')
    const title = textTag(item, 'title')
    if (!link || !title) continue

    // Story links are `https://www.solidot.org/story?sid=85643`.
    const sid = /\?sid=(\d+)/.exec(link)?.[1]
    const description = rawTag(item, 'description')

    const entry = {
      id: sid ? `solidot:${sid}` : `solidot:${link}`,
      title,
      url: link,
      content: description,
      summary: plain(description, 120),
    }

    const publishedAt = seconds(textTag(item, 'pubDate'))
    if (publishedAt !== undefined) entry.publishedAt = publishedAt

    entries.push(entry)
  }

  if (entries.length === 0) {
    throw new Error('Solidot RSS 源没有返回可解析的条目，源可能已经变了')
  }

  ctx.log.info(`solidot: ${type} ${entries.length} 条`)

  return { entries }
}
