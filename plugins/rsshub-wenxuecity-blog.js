// Ported from RSSHub lib/routes/wenxuecity/blog.ts (AGPL-3.0).
// 文学城博客 — blog.wenxuecity.com/myblog/<id>/all.html。
//
// 博主的名字在页面顶部的 <strong id="username"> 里，列表里每个 articleCell
// 带标题、链接和时间。同一博客内文章号才唯一，所以 id 用整段路径。

export const meta = {
  id: 'rome.rsshub-wenxuecity-blog',
  name: '文学城 · 博客',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: '文学城指定博客的全部文章',
  icon: 'https://www.wenxuecity.com/favicon.ico',
  params: {
    fields: [
      {
        key: 'id',
        type: 'text',
        label: '博客 ID',
        help: '博客 URL 中的数字，例如 43626',
        default: '',
        required: true,
      },
    ],
  },
}

const BASE = 'https://blog.wenxuecity.com'

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

function stampSeconds(text) {
  const match = /(\d{4})-(\d{1,2})-(\d{1,2})\s+(\d{1,2}):(\d{2}):(\d{2})/.exec(text)
  if (!match) return undefined
  const [, year, month, day, hour, minute, second] = match
  const pad = (value) => String(value).padStart(2, '0')
  const milliseconds = Date.parse(`${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:${pad(second)}Z`)
  return Number.isFinite(milliseconds) ? Math.floor(milliseconds / 1000) : undefined
}

function parseList(html, author) {
  const entries = []

  for (const block of html.split(/<div class="articleCell[^"]*">/).slice(1)) {
    const anchor = /<a href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(block)
    if (!anchor) continue

    const title = stripTags(anchor[2])
    if (!title) continue

    const url = new URL(decode(anchor[1]), BASE).href
    const date = /<span class="atc_tm[^"]*">([\s\S]*?)<\/span>/.exec(block)

    const entry = {
      // 文章号只在博主内唯一，所以 id 用完整路径。
      id: `wenxuecity:blog:${new URL(url).pathname}`,
      title,
      url,
    }

    if (author) entry.author = author
    if (date) {
      const publishedAt = stampSeconds(stripTags(date[1]))
      if (publishedAt !== undefined) entry.publishedAt = publishedAt
    }

    entries.push(entry)
  }

  return entries
}

export async function fetch(ctx) {
  const id = String(ctx.params.id ?? '').trim()

  if (!id) {
    throw new Error('请填写博客 ID（数字）')
  }
  if (!/^\d+$/.test(id)) {
    throw new Error(`博客 ID ${id} 无效，应为数字`)
  }

  const url = `${BASE}/myblog/${id}/all.html`

  ctx.log.debug(`wenxuecity: GET ${url}`)

  const response = await ctx.fetch(url, { headers: { accept: 'text/html' } })

  if (!response.ok) {
    throw new Error(`文学城博客返回 ${response.status} ${response.statusText}`)
  }

  const html = await response.text()
  const name = /<strong id="username">([\s\S]*?)<\/strong>/.exec(html)
  const author = name ? stripTags(name[1]) : undefined
  const entries = parseList(html, author)

  if (entries.length === 0) {
    throw new Error(`文学城博客 ${id} 没有解析到文章，博客 ID 或页面结构可能已经改变`)
  }

  return { entries, icon: `${BASE}/favicon.ico` }
}

export async function preview(ctx) {
  if (!ctx.item?.url) return null
  const content = await ctx.article(ctx.item.url)
  return content === null ? null : { content }
}
