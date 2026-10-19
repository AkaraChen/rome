// Ported from RSSHub lib/routes/anthropic/news.ts (AGPL-3.0).
// Anthropic 新闻 — RSSHub 的 /anthropic/news 路由。
//
// 新闻页是服务端渲染的：每条新闻是一个 <a class="…__listItem">，里面有
// <time>、分类和标题。列表里已经有标题和日期，正文留给 preview，所以
// fetch 只发一个请求。
//
// 日期写作「Oct 16, 2026」，不是 ISO，所以自己按月份表换算，不赌
// Date.parse 认不认这种格式。

export const meta = {
  id: 'rome.rsshub-anthropic-news',
  name: 'Anthropic · 新闻',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: 'Anthropic 官方新闻与公告',
  icon: 'https://www.anthropic.com/favicon.ico',
}

const BASE = 'https://www.anthropic.com'
const LINK = `${BASE}/news`

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

const MONTHS = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
}

function decode(text) {
  return String(text ?? '').replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity) => {
    if (entity[0] === '#') {
      const code = entity[1] === 'x' || entity[1] === 'X'
        ? Number.parseInt(entity.slice(2), 16)
        : Number.parseInt(entity.slice(1), 10)

      return Number.isFinite(code) ? String.fromCodePoint(code) : match
    }

    return Object.prototype.hasOwnProperty.call(ENTITIES, entity) ? ENTITIES[entity] : match
  })
}

function text(html) {
  return decode(String(html ?? '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim()
}

/// 「Oct 16, 2026」→ 秒。认不出来就返回 undefined，宁可没有时间也不要错的时间。
function seconds(input) {
  const match = /([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),\s*(\d{4})/.exec(String(input ?? ''))

  if (!match) return undefined

  const month = MONTHS[match[1].toLowerCase()]

  if (!month) return undefined

  return Math.floor(Date.UTC(Number(match[3]), month - 1, Number(match[2])) / 1000)
}

/// 把 <ul class="…__list"> 里的每个 <a class="…__listItem"> 切出来。
function parseList(html) {
  const entries = []

  for (const list of html.matchAll(/<ul class="PublicationList-module-scss-module__[^"]*__list">([\s\S]*?)<\/ul>/g)) {
    for (const chunk of list[1].split(/<li\b/).slice(1)) {
      const anchor = /<a\b[^>]*\bhref="([^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(chunk)

      if (!anchor) continue

      const title = /__title[^"]*"[^>]*>([\s\S]*?)<\/span>/.exec(anchor[2])

      if (!title) continue

      const heading = text(title[1])

      if (!heading) continue

      const href = decode(anchor[1])
      const url = href.startsWith('http') ? href : `${BASE}${href}`

      const entry = {
        id: `anthropic:${new URL(url).pathname}`,
        title: heading,
        url,
      }

      const date = /<time[^>]*>([\s\S]*?)<\/time>/.exec(anchor[2])
      const publishedAt = seconds(text(date?.[1]))

      if (publishedAt !== undefined) entry.publishedAt = publishedAt

      const category = /__subject[^"]*"[^>]*>([\s\S]*?)<\/span>/.exec(anchor[2])

      if (category) {
        const subject = text(category[1])
        if (subject) entry.summary = subject
      }

      entries.push(entry)
    }
  }

  return entries
}

export async function fetch(ctx) {
  ctx.log.debug(`anthropic: GET ${LINK}`)

  const response = await ctx.fetch(LINK, { headers: { accept: 'text/html' } })

  if (!response.ok) {
    throw new Error(`Anthropic 返回 ${response.status} ${response.statusText}`)
  }

  const entries = parseList(await response.text())

  if (entries.length === 0) {
    throw new Error('Anthropic 新闻页里没有读到任何条目，页面结构可能已经变了')
  }

  ctx.log.info(`anthropic: 新闻 ${entries.length} 条`)

  return { entries }
}

export async function preview(ctx) {
  const url = ctx.item?.url

  if (!url) return null

  const content = await ctx.article(url)

  return content === null ? null : { content }
}
