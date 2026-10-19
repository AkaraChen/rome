// Ported from RSSHub lib/routes/v2ex/xna.ts (AGPL-3.0).
// V2EX XNA — www.v2ex.com/xna。
//
// XNA 是 V2EX 自己的博客聚合：条目指向别人的站点，所以正文不在这里取，
// 也没有 preview。列表里的时间是中文相对时间（5 小时 1 分钟前）。

export const meta = {
  id: 'rome.rsshub-v2ex-xna',
  name: 'V2EX · XNA',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: 'V2EX 的 XNA 博客聚合',
  icon: 'https://www.v2ex.com/favicon.ico',
}

const BASE = 'https://www.v2ex.com'
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
const LIMIT = 50

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

// 「5 小时 1 分钟前」「3 天前」「刚刚」——只有相对时间，按当前时间倒推。
function relativeSeconds(text, now) {
  const flat = text.replace(/\s+/g, '')
  if (!flat) return undefined
  if (/刚刚|现在|秒前$/.test(flat) && !/\d/.test(flat)) return now

  const units = [
    [/(\d+)秒前/, 1],
    [/(\d+)分钟前/, 60],
    [/(\d+)小时前/, 3600],
    [/(\d+)天前/, 86400],
    [/(\d+)周前/, 604800],
    [/(\d+)个月前/, 2592000],
    [/(\d+)年前/, 31536000],
  ]

  let total = 0
  let found = false

  for (const [pattern, scale] of units) {
    const match = pattern.exec(flat)
    if (match) {
      total += Number(match[1]) * scale
      found = true
    }
  }

  if (!found) return undefined
  return now - total
}

export async function fetch(ctx) {
  const page = `${BASE}/xna`

  ctx.log.debug(`v2ex: GET ${page}`)

  const response = await ctx.fetch(page, { headers: { accept: 'text/html', 'user-agent': UA } })

  if (!response.ok) {
    throw new Error(`V2EX XNA 返回 ${response.status} ${response.statusText}`)
  }

  const html = await response.text()
  const now = Math.floor(Date.now() / 1000)
  const entries = []

  for (const block of html.split('<div class="xna-entry-main-container">').slice(1)) {
    if (entries.length >= LIMIT) break

    const anchor = /<div class="xna-entry-title">[\s\S]*?<a\b([^>]*)>([\s\S]*?)<\/a>/.exec(block)
    if (!anchor) continue

    const href = /\bhref="([^"]+)"/.exec(anchor[1])
    const title = stripTags(anchor[2])
    if (!href || !title) continue

    const link = new URL(decode(href[1]), page)
    const author = /<span class="xna-source-author"><a[^>]*>([\s\S]*?)<\/a>/.exec(block)
    const source = /<span class="xna-entry-source">[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/.exec(block)
    const date = /<span class="xna-entry-date">([\s\S]*?)<\/span>/.exec(block)

    const entry = {
      // 条目指向外部博客，地址本身就是它的标识。
      id: `v2ex:xna:${link.href}`,
      title,
      url: link.href,
    }

    if (author) entry.author = stripTags(author[1])
    if (source) entry.summary = stripTags(source[1])

    if (date) {
      const publishedAt = relativeSeconds(stripTags(date[1]), now)
      if (publishedAt !== undefined) entry.publishedAt = publishedAt
    }

    entries.push(entry)
  }

  if (entries.length === 0) {
    throw new Error('V2EX XNA 没有解析到条目，页面结构可能已经改变')
  }

  return { entries, icon: `${BASE}/favicon.ico` }
}
