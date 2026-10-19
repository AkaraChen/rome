// Ported from RSSHub lib/routes/cgtn/opinions.ts (AGPL-3.0).
// CGTN 评论 — the opinions page lists its articles server-rendered, newest
// first is not guaranteed, so the list is sorted by the timestamp the site
// puts on every anchor.

export const meta = {
  id: 'rome.rsshub-cgtn-opinions',
  name: '中国环球电视网 · Opinions',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: 'CGTN 评论栏目的最新文章',
  icon: 'https://www.cgtn.com/favicon.ico',
}

const PAGE = 'https://www.cgtn.com/opinions'
const LIMIT = 15

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
  ctx.log.debug(`cgtn-opinions: GET ${PAGE}`)

  const response = await ctx.fetch(PAGE, { headers: { accept: 'text/html' } })

  if (!response.ok) {
    throw new Error(`CGTN 返回 ${response.status} ${response.statusText}`)
  }

  const html = await response.text()
  const found = []

  // Every opinion card is a cg-title heading around a single anchor, and the
  // anchor carries both the news id and the publication time.
  for (const match of html.matchAll(/<div class="cg-title">\s*<h3>\s*(<a\b[^>]*>[\s\S]*?<\/a>)/g)) {
    const anchor = /^<a\b[^>]*>/.exec(match[1])?.[0]
    if (!anchor) continue

    const href = /href="([^"]+)"/.exec(anchor)?.[1]
    const stamp = /data-time="(\d+)"/.exec(anchor)?.[1]
    const newsId = /data-news-id="([^"]+)"/.exec(anchor)?.[1]
    const title = plain(/^<a\b[^>]*>([\s\S]*?)<\/a>/.exec(match[1])?.[1])

    if (!href || !title) continue

    found.push({ href, stamp: Number(stamp), newsId, title })
  }

  if (found.length === 0) {
    throw new Error('CGTN 评论页没有解析出条目，页面结构可能已经变了')
  }

  const entries = found
    .sort((first, second) => (second.stamp || 0) - (first.stamp || 0))
    .slice(0, LIMIT)
    .map((item) => {
      const entry = {
        id: `cgtn:${item.newsId || item.href}`,
        title: item.title,
        url: item.href,
      }

      if (Number.isFinite(item.stamp)) entry.publishedAt = Math.floor(item.stamp / 1000)

      return entry
    })

  ctx.log.info(`cgtn-opinions: ${entries.length} 条`)

  return { entries, icon: 'https://www.cgtn.com/favicon.ico' }
}

export async function preview(ctx) {
  const url = ctx.item?.url
  if (!url) return null

  const content = await ctx.article(url)
  return content === null ? null : { content }
}
