// Ported from RSSHub lib/routes/medium/feed.ts (AGPL-3.0).
// Medium 用户 Feed — the official per-user RSS feed.
//
// `medium.com/feed/@user` is the public feed behind a writer's profile. It
// carries the full post in `content:encoded`, so no article page is fetched:
// the listing is the article. Titles are trimmed because Medium sometimes
// leaves a leading space in the CDATA.
//
// The guid is `https://medium.com/p/<post id>`, which survives a title change
// and a publication move, so it is the entry id.

export const meta = {
  id: 'rome.rsshub-medium-feed',
  name: 'Medium · 用户 Feed',
  version: '1.0.0',
  apiVersion: '1',
  view: 'socialMedia',
  description: 'Medium 某位作者的最新文章',
  icon: 'https://medium.com/favicon.ico',
  params: {
    fields: [
      {
        key: 'user',
        type: 'text',
        label: '用户名',
        help: 'Medium 个人主页 @ 后面的名字，例如 zhgchgli',
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
  const user = String(ctx.params.user ?? '').trim().replace(/^@/, '')

  if (!user) {
    throw new Error('缺少用户名：请填写 Medium 个人主页 @ 后面的名字')
  }

  const url = `https://medium.com/feed/@${encodeURIComponent(user)}`
  ctx.log.debug(`medium-feed: GET ${url}`)

  const response = await ctx.fetch(url, { headers: { accept: 'application/rss+xml, application/xml' } })

  if (!response.ok) {
    throw new Error(`Medium 返回 ${response.status} ${response.statusText}`)
  }

  const xml = await response.text()
  const items = [...xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)]
  const entries = []

  for (const [, item] of items) {
    const link = textTag(item, 'link')
    if (!link) continue

    const guid = textTag(item, 'guid')
    const content = rawTag(item, 'content:encoded') || rawTag(item, 'content')

    const entry = {
      id: `medium:${guid || link}`,
      title: textTag(item, 'title') || 'Untitled',
      url: link,
      content,
      summary: plain(content, 140),
    }

    const author = textTag(item, 'dc:creator')
    if (author) entry.author = author

    const publishedAt = seconds(textTag(item, 'pubDate'))
    if (publishedAt !== undefined) entry.publishedAt = publishedAt

    entries.push(entry)
  }

  if (entries.length === 0) {
    throw new Error('Medium Feed 没有返回可解析的条目，用户可能不存在或源已经变了')
  }

  ctx.log.info(`medium-feed: ${user} ${entries.length} 条`)

  return { entries }
}
