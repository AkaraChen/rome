// Ported from RSSHub lib/routes/36kr/index.ts (AGPL-3.0).
// 36氪最新资讯 — the official RSS feed.
//
// The site's HTML routes are behind an Aliyun WAF challenge: every path,
// including the API-looking ones, answers with the same 25 KB challenge page,
// so `window.initialState` is never in the response. The one public surface
// left is `www.36kr.com/feed`, which carries the same latest articles as the
// 资讯 channel, with the full body in `description`.
//
// That feed has no categories and no search, so this port supports the one
// shape it can serve and says so instead of returning an empty list when
// asked for something else.

export const meta = {
  id: 'rome.rsshub-36kr-index',
  name: '36kr · 资讯',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: '36氪最新资讯，来自官方 RSS 源',
  icon: 'https://36kr.com/favicon.ico',
  params: {
    fields: [
      {
        key: 'category',
        type: 'select',
        label: '分类',
        help: '官方 RSS 源只提供最新资讯。',
        default: '',
        options: [{ value: 'news', label: '最新资讯' }],
      },
      {
        key: 'subCategory',
        type: 'text',
        label: '子分类',
        help: '为兼容旧路径保留，官方 RSS 源不使用。',
        default: '',
      },
      {
        key: 'keyword',
        type: 'text',
        label: '关键词',
        help: '官方 RSS 源不支持搜索，填写后会报错。',
        default: '',
      },
    ],
  },
}

const FEED = 'https://www.36kr.com/feed'

const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  ndash: '–', mdash: '—', hellip: '…', lsquo: '‘', rsquo: '’',
  ldquo: '“', rdquo: '”', middot: '·', copy: '©', reg: '®', trade: '™',
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

/// 36kr writes `2026-10-19 14:08:32  +0800`, which is not a format `Date.parse`
/// is required to understand. Normalise it before asking.
function seconds(value) {
  const text = String(value ?? '').trim()
  if (!text) return undefined

  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})\s*([+-]\d{2}:?\d{2})$/.exec(text)
  if (!match) return undefined

  const offset = match[7].includes(':')
    ? match[7]
    : `${match[7].slice(0, 3)}:${match[7].slice(3)}`

  const milliseconds = Date.parse(`${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}${offset}`)

  return Number.isFinite(milliseconds) ? Math.floor(milliseconds / 1000) : undefined
}

export async function fetch(ctx) {
  const category = String(ctx.params.category ?? '').trim()
  const subCategory = String(ctx.params.subCategory ?? '').trim()
  const keyword = String(ctx.params.keyword ?? '').trim()

  if (!category) {
    throw new Error('缺少分类：官方 RSS 源只支持「最新资讯」')
  }

  if (category !== 'news') {
    throw new Error(`不支持的分类 ${category}：官方 RSS 源只提供最新资讯，请选择 news`)
  }

  if (keyword) {
    throw new Error('36氪官方 RSS 源不支持关键词搜索')
  }

  // `subCategory` is accepted for URL compatibility only; the feed has no
  // sub-channels to filter by.
  ctx.log.debug(`36kr-index: GET ${FEED} (subCategory=${subCategory || '-'})`)

  const response = await ctx.fetch(FEED, { headers: { accept: 'application/rss+xml, application/xml' } })

  if (!response.ok) {
    throw new Error(`36氪返回 ${response.status} ${response.statusText}`)
  }

  const xml = await response.text()
  const items = [...xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)]
  const entries = []

  for (const [, item] of items) {
    const link = textTag(item, 'link')
    const title = textTag(item, 'title')
    if (!link || !title) continue

    // The feed appends `?f=rss`; the article id is the permanent part.
    const url = link.split('?')[0]
    const idMatch = /\/p\/(\d+)/.exec(url)
    if (!idMatch) continue

    const description = rawTag(item, 'description')

    const entry = {
      id: `36kr:${idMatch[1]}`,
      title,
      url,
      content: description,
      summary: plain(description, 120),
    }

    const publishedAt = seconds(textTag(item, 'pubDate'))
    if (publishedAt !== undefined) entry.publishedAt = publishedAt

    entries.push(entry)
  }

  if (entries.length === 0) {
    throw new Error('36氪 RSS 源没有返回可解析的条目，源可能已经变了')
  }

  ctx.log.info(`36kr-index: ${entries.length} 条`)

  return { entries }
}
