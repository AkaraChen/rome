// Ported from RSSHub lib/routes/substack/subscribe.ts (AGPL-3.0).
// Substack 订阅 — one publication's official RSS feed.
//
// Every Substack publication serves `/feed`, with the full post in
// `content:encoded` and a cover image in `enclosure`. The subdomain is the
// only parameter, so a source is one publication.
//
// The guid is the post's canonical URL. The subdomain is prefixed onto the
// entry id so two publications cannot collide on the same path.

export const meta = {
  id: 'rome.rsshub-substack-subscribe',
  name: 'Substack · 订阅',
  version: '1.0.0',
  apiVersion: '1',
  view: 'socialMedia',
  description: '某个 Substack 出版物的最新文章',
  icon: 'https://substack.com/favicon.ico',
  params: {
    fields: [
      {
        key: 'user',
        type: 'text',
        label: '出版物子域名',
        help: '例如 mangoread.substack.com 就填 mangoread',
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

/// The cover is an `<enclosure>` with a type and a url; only image types are
/// useful as an entry image.
function imageOf(block) {
  const enclosure = /<enclosure\b([^>]*)>/i.exec(block)?.[1]
  if (!enclosure) return undefined

  const type = /type\s*=\s*"([^"]*)"/i.exec(enclosure)?.[1]
  if (!type || !type.startsWith('image/')) return undefined

  const url = /url\s*=\s*"([^"]*)"/i.exec(enclosure)?.[1]
  return url ? decode(url) : undefined
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
  const user = String(ctx.params.user ?? '').trim()

  if (!user) {
    throw new Error('缺少出版物子域名：例如 mangoread.substack.com 就填 mangoread')
  }

  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(user)) {
    throw new Error('出版物子域名只能包含小写字母、数字和连字符')
  }

  const url = `https://${user}.substack.com/feed`
  ctx.log.debug(`substack: GET ${url}`)

  const response = await ctx.fetch(url, { headers: { accept: 'application/rss+xml, application/xml' } })

  if (!response.ok) {
    throw new Error(`Substack 返回 ${response.status} ${response.statusText}`)
  }

  const xml = await response.text()
  const items = [...xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)]
  const entries = []

  for (const [, item] of items) {
    const link = textTag(item, 'link')
    if (!link) continue

    const guid = textTag(item, 'guid')
    const content = rawTag(item, 'content:encoded') || rawTag(item, 'description')

    const entry = {
      // A canonical post URL is stable; namespacing it by publication keeps
      // two substacks with the same path apart.
      id: `substack:${user}:${guid || link}`,
      title: textTag(item, 'title') || 'Untitled',
      url: link,
      content,
      summary: plain(rawTag(item, 'description'), 140),
    }

    const author = textTag(item, 'dc:creator')
    if (author) entry.author = author

    const image = imageOf(item)
    if (image) entry.image = image

    const publishedAt = seconds(textTag(item, 'pubDate'))
    if (publishedAt !== undefined) entry.publishedAt = publishedAt

    entries.push(entry)
  }

  if (entries.length === 0) {
    throw new Error('Substack Feed 没有返回可解析的条目，出版物可能不存在或源已经变了')
  }

  ctx.log.info(`substack: ${user} ${entries.length} 条`)

  return { entries }
}
