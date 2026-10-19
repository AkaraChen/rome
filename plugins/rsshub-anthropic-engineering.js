// Ported from RSSHub lib/routes/anthropic/engineering.ts (AGPL-3.0).
// Anthropic 工程博客 — RSSHub 的 /anthropic/engineering 路由。
//
// 每篇文章是一个 <a class="…__cardLink">，里面有 <h2>/<h3> 标题、
// <p class="…__summary"> 摘要、<time dateTime="YYYY-MM-DD"> 日期。
// 首页那篇精选文章没有 <time>，就不带时间。
//
// 配图都是 .svg 插图，Rome 的图片解码器不保证认得，所以这里只收栅格图。

export const meta = {
  id: 'rome.rsshub-anthropic-engineering',
  name: 'Anthropic · 工程博客',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: 'Anthropic 工程团队发布的技术文章',
  icon: 'https://www.anthropic.com/favicon.ico',
}

const BASE = 'https://www.anthropic.com'
const LINK = `${BASE}/engineering`

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

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

export async function fetch(ctx) {
  ctx.log.debug(`anthropic: GET ${LINK}`)

  const response = await ctx.fetch(LINK, { headers: { accept: 'text/html' } })

  if (!response.ok) {
    throw new Error(`Anthropic 返回 ${response.status} ${response.statusText}`)
  }

  const html = await response.text()
  const entries = []

  for (const match of html.matchAll(/<a\b[^>]*class="ArticleList-module-scss-module__[^"]*__cardLink"[^>]*>([\s\S]*?)<\/a>/g)) {
    const body = match[1]
    const heading = /<h[23][^>]*>([\s\S]*?)<\/h[23]>/.exec(body)

    if (!heading) continue

    const title = text(heading[1])

    if (!title) continue

    const href = /\bhref="([^"]+)"/.exec(match[0])

    if (!href) continue

    const raw = decode(href[1])
    const url = raw.startsWith('http') ? raw : `${BASE}${raw}`

    const entry = {
      id: `anthropic:${new URL(url).pathname}`,
      title,
      url,
    }

    const summary = /<p\b[^>]*__summary[^>]*>([\s\S]*?)<\/p>/.exec(body)

    if (summary) {
      const excerpt = text(summary[1])
      if (excerpt) entry.summary = excerpt
    }

    const date = /<time\b[^>]*\bdatetime="([^"]+)"/i.exec(body)

    if (date) {
      const milliseconds = Date.parse(`${date[1].slice(0, 10)}T00:00:00Z`)

      if (Number.isFinite(milliseconds)) entry.publishedAt = Math.floor(milliseconds / 1000)
    }

    const image = /<img\b[^>]*\bsrc="([^"]+)"/.exec(body)

    if (image && !/\.svg(?:$|\?)/i.test(image[1])) entry.image = decode(image[1])

    entries.push(entry)
  }

  if (entries.length === 0) {
    throw new Error('Anthropic 工程博客页里没有读到任何条目，页面结构可能已经变了')
  }

  ctx.log.info(`anthropic: 工程 ${entries.length} 条`)

  return { entries }
}

export async function preview(ctx) {
  const url = ctx.item?.url

  if (!url) return null

  const content = await ctx.article(url)

  return content === null ? null : { content }
}
