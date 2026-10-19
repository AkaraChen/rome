// Ported from RSSHub lib/routes/cgtn/most.ts (AGPL-3.0).
// CGTN 最热阅读与分享榜 — the ranking page renders every time window into its
// own section, each item carrying the site's own news id and timestamp.
// The article body is read only when an entry is opened.

export const meta = {
  id: 'rome.rsshub-cgtn-most',
  name: '中国环球电视网 · Most Read & Most Share',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: 'CGTN 最热阅读与最多分享的新闻排行',
  icon: 'https://www.cgtn.com/favicon.ico',
  params: {
    fields: [
      {
        key: 'type',
        type: 'select',
        label: '榜单类型',
        help: '选择阅读榜或分享榜，默认为阅读榜',
        default: 'read',
        options: [
          { value: 'read', label: '最多阅读' },
          { value: 'share', label: '最多分享' },
        ],
      },
      {
        key: 'time',
        type: 'select',
        label: '时间范围',
        help: '选择榜单统计的时间范围，默认为全部时间',
        default: 'all',
        options: [
          { value: 'all', label: '全部时间' },
          { value: 'day', label: '今日' },
          { value: 'week', label: '本周' },
          { value: 'month', label: '本月' },
          { value: 'year', label: '本年' },
        ],
      },
    ],
  },
}

const TYPES = ['read', 'share']
const RANGES = ['all', 'day', 'week', 'month', 'year']
const LIMIT = 50

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

function plain(html) {
  return decode(String(html ?? '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim()
}

export async function fetch(ctx) {
  const type = String(ctx.params.type ?? '').trim() || 'read'
  const time = String(ctx.params.time ?? '').trim() || 'all'

  if (!TYPES.includes(type)) {
    throw new Error(`不支持的榜单类型 ${type}：可选值为 ${TYPES.join('、')}`)
  }

  if (!RANGES.includes(time)) {
    throw new Error(`不支持的时间范围 ${time}：可选值为 ${RANGES.join('、')}`)
  }

  const url = `https://www.cgtn.com/most-${type}`
  ctx.log.debug(`cgtn-most: GET ${url}`)

  const response = await ctx.fetch(url, { headers: { accept: 'text/html' } })

  if (!response.ok) {
    throw new Error(`CGTN 返回 ${response.status} ${response.statusText}`)
  }

  const html = await response.text()
  const section = new RegExp(`<div id="${time}Items"[^>]*>([\\s\\S]*?)(?=<div id="[a-z]+Items"|$)`).exec(html)?.[1]

  if (!section) {
    throw new Error('CGTN 榜单页没有找到对应的时间分区，页面结构可能已经变了')
  }

  const entries = []

  for (const block of section.split(/<div class\s*=\s*'most-read-item-box'>/).slice(1)) {
    const anchor = /<a\b[^>]*data-time="\d+"[^>]*>/.exec(block)?.[0]
    if (!anchor) continue

    const href = /href="([^"]+)"/.exec(anchor)?.[1]
    const stamp = /data-time="(\d+)"/.exec(anchor)?.[1]
    const newsId = /data-news-id="([^"]+)"/.exec(anchor)?.[1]
    const title = plain(/<a\b[^>]*data-time="\d+"[^>]*>([\s\S]*?)<\/a>/.exec(block)?.[1])

    if (!href || !title) continue

    const entry = {
      // CGTN's own news id is what the URL is built from and never changes.
      id: `cgtn:${newsId || href}`,
      title,
      url: href,
    }

    const publishedAt = Number(stamp)
    if (Number.isFinite(publishedAt)) entry.publishedAt = Math.floor(publishedAt / 1000)

    const image = /<img\b[^>]*src="([^"]+)"/.exec(block)?.[1]
    if (image && !image.startsWith('data:')) entry.image = image

    entries.push(entry)

    if (entries.length >= LIMIT) break
  }

  if (entries.length === 0) {
    throw new Error('CGTN 榜单页没有解析出条目，页面结构可能已经变了')
  }

  ctx.log.info(`cgtn-most: ${type}/${time} ${entries.length} 条`)

  return { entries, icon: 'https://www.cgtn.com/favicon.ico' }
}

export async function preview(ctx) {
  const url = ctx.item?.url
  if (!url) return null

  const content = await ctx.article(url)
  return content === null ? null : { content }
}
