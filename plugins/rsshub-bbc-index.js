// Ported from RSSHub lib/routes/bbc/index.ts (AGPL-3.0).
// BBC News — the official RSS feeds, with optional channel and Chinese variants.
//
// The feed itself is XML, so it is parsed by splitting on <item> and scanning
// the four tags each entry carries. The article body is left to preview.

export const meta = {
  id: 'rome.rsshub-bbc-index',
  name: 'BBC · News',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: 'BBC 新闻官方 RSS 源，可指定栏目与中文简繁版本',
  icon: 'https://www.bbc.com/favicon.ico',
  params: {
    fields: [
      {
        key: 'site',
        type: 'text',
        label: '语言或栏目',
        help: '留空为英文头条；chinese 或 traditionalchinese 为中文简繁；其余按栏目填写，如 world-asia、business',
        default: ''
      },
      {
        key: 'channel',
        type: 'text',
        label: '子栏目',
        help: '仅中文网使用，如 world、china，留空为全部',
        default: ''
      }
    ]
  }
}

const FEEDS = 'https://feeds.bbci.co.uk'
const WEB = 'https://www.bbc.co.uk'
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

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

function unwrap(value) {
  return decode(String(value).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1'))
}

function strip(html) {
  return decode(String(html).replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim()
}

function seconds(value) {
  const milliseconds = Date.parse(String(value).trim())
  return Number.isFinite(milliseconds) ? Math.floor(milliseconds / 1000) : undefined
}

function tag(block, name) {
  const match = new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`).exec(block)
  return match ? match[1] : undefined
}

export async function fetch(ctx) {
  const site = String(ctx.params.site || '').trim().toLowerCase()
  const channel = String(ctx.params.channel || '').trim()

  let feedUrl
  let chinese = false

  if (site === 'chinese') {
    chinese = true
    feedUrl = channel
      ? `${WEB}/zhongwen/simp/${channel}/index.xml`
      : `${WEB}/zhongwen/simp/index.xml`
  } else if (site === 'traditionalchinese') {
    feedUrl = channel
      ? `${WEB}/zhongwen/trad/${channel}/index.xml`
      : `${WEB}/zhongwen/trad/index.xml`
  } else if (site) {
    // A channel contains sub-directories: world/asia becomes world-asia.
    feedUrl = `${FEEDS}/news/${site.split('-').join('/')}/rss.xml`
  } else {
    feedUrl = `${FEEDS}/news/rss.xml`
  }

  const response = await ctx.fetch(feedUrl, { headers: { accept: 'application/rss+xml, application/xml' } })

  if (!response.ok) {
    throw new Error(`BBC 返回 ${response.status} ${response.statusText}`)
  }

  const xml = await response.text()
  const entries = []
  const seen = new Set()

  for (const part of xml.split('<item>').slice(1)) {
    const block = part.split('</item>')[0]
    const rawLink = tag(block, 'link')
    const rawTitle = tag(block, 'title')

    if (!rawLink || !rawTitle) {
      continue
    }

    let link = unwrap(rawLink).trim().split('?')[0]

    // The Chinese index.xml serves traditional links regardless of the language
    // parameter, which has to be corrected by hand.
    if (chinese) {
      link = link.replace('/trad', '/simp')
    }

    if (!link || seen.has(link)) {
      continue
    }

    seen.add(link)

    const entry = {
      id: `bbc:${link}`,
      title: strip(unwrap(rawTitle)) || link,
      url: link
    }

    const description = tag(block, 'description')
    const summary = description ? strip(unwrap(description)) : ''

    if (summary) {
      entry.summary = summary
    }

    const pubDate = tag(block, 'pubDate')
    const publishedAt = pubDate ? seconds(unwrap(pubDate)) : undefined

    if (publishedAt !== undefined) {
      entry.publishedAt = publishedAt
    }

    const thumbnail = /<media:thumbnail[^>]*url="([^"]+)"/.exec(block)

    if (thumbnail) {
      entry.image = decode(thumbnail[1])
    }

    entries.push(entry)
  }

  if (entries.length === 0) {
    throw new Error(`BBC 源 ${feedUrl} 没有返回任何条目`)
  }

  return { entries }
}

export async function preview(ctx) {
  const url = ctx.item?.url
  if (!url) return null
  const content = await ctx.article(url)
  return content === null ? null : { content }
}
