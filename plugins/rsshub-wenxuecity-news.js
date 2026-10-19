// Ported from RSSHub lib/routes/wenxuecity/news.ts (AGPL-3.0).
// 文学城焦点新闻 — 首页右侧的焦点新闻列表。
//
// 列表页只给标题和链接，日期写在 URL 里（/news/2026/10/18/126808687.html），
// 所以日期取到天；正文交给 preview。

export const meta = {
  id: 'rome.rsshub-wenxuecity-news',
  name: '文学城 · 焦点新闻',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: '文学城焦点新闻列表',
  icon: 'https://www.wenxuecity.com/favicon.ico',
}

const BASE = 'https://www.wenxuecity.com'
const PAGE = `${BASE}/news/`

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

function decode(text) {
  return String(text).replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity) => {
    if (entity[0] === '#') {
      const code = entity[1] === 'x' || entity[1] === 'X'
        ? Number.parseInt(entity.slice(2), 16)
        : Number.parseInt(entity.slice(1), 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : match
    }
    return Object.prototype.hasOwnProperty.call(ENTITIES, entity) ? ENTITIES[entity] : match
  })
}

function stripTags(html) {
  return decode(String(html).replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim()
}

// 日期只精确到天；站点时区未公开，按 UTC 零点读，顺序不受影响。
function daySeconds(path) {
  const match = /\/(\d{4})\/(\d{2})\/(\d{2})\//.exec(path)
  if (!match) return undefined
  const milliseconds = Date.parse(`${match[1]}-${match[2]}-${match[3]}T00:00:00Z`)
  return Number.isFinite(milliseconds) ? Math.floor(milliseconds / 1000) : undefined
}

function parseList(html) {
  // 焦点新闻在 mainwrap 里，取到它的 wrapper 列表为止，避免匹配到页脚链接。
  const start = html.indexOf('class="mainwrap')
  if (start < 0) return []

  const entries = []

  for (const match of html.slice(start).matchAll(/<li><a href="(\/news\/[^"]+)"[^>]*>([\s\S]*?)<\/a><\/li>/g)) {
    const title = stripTags(match[2])
    if (!title) continue

    const path = decode(match[1])
    const id = /(\d+)\.html/.exec(path)

    const entry = {
      // 文章路径里的数字 ID 是永久标识。
      id: `wenxuecity:news:${id ? id[1] : path}`,
      title,
      url: new URL(path, BASE).href,
    }

    const publishedAt = daySeconds(path)
    if (publishedAt !== undefined) entry.publishedAt = publishedAt

    entries.push(entry)
    if (entries.length >= 15) break
  }

  return entries
}

export async function fetch(ctx) {
  ctx.log.debug(`wenxuecity: GET ${PAGE}`)

  const response = await ctx.fetch(PAGE, { headers: { accept: 'text/html' } })

  if (!response.ok) {
    throw new Error(`文学城返回 ${response.status} ${response.statusText}`)
  }

  const html = await response.text()
  const entries = parseList(html)

  if (entries.length === 0) {
    throw new Error('文学城焦点新闻没有解析到条目，页面结构可能已经改变')
  }

  return { entries, icon: `${BASE}/favicon.ico` }
}

export async function preview(ctx) {
  if (!ctx.item?.url) return null
  const content = await ctx.article(ctx.item.url)
  return content === null ? null : { content }
}
