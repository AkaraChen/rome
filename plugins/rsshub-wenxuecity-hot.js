// Ported from RSSHub lib/routes/wenxuecity/hot.ts (AGPL-3.0).
// 文学城最热主题 — bbs.wenxuecity.com/?cid=<版面 ID>。
//
// 和最新主题同一套页面，但列表结构不同：每条是 div.item，标题在
// div.title > a，作者在 span.user > a，时间在 span.time 里。

export const meta = {
  id: 'rome.rsshub-wenxuecity-hot',
  name: '文学城 · 最热主题',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: '文学城论坛指定版面当天最热的主题',
  icon: 'https://www.wenxuecity.com/favicon.ico',
  params: {
    fields: [
      {
        key: 'cid',
        type: 'text',
        label: '版面 ID',
        help: '版面 URL 中的 cid 数字，例如 9',
        default: '',
        required: true,
      },
    ],
  },
}

const BASE = 'https://bbs.wenxuecity.com'

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
  const match = /(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})/.exec(text)
  if (!match) return undefined
  const milliseconds = Date.parse(`${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}Z`)
  return Number.isFinite(milliseconds) ? Math.floor(milliseconds / 1000) : undefined
}

function parseList(html) {
  const entries = []

  for (const block of html.split('<div class="item">').slice(1)) {
    const anchor = /<div class="title">\s*<a href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(block)
    if (!anchor) continue

    const title = stripTags(anchor[2])
    if (!title) continue

    // 链接写作 ./tzlc/2386653.html，相对的是站点根目录而不是带查询串的当前页。
    const url = new URL(decode(anchor[1]), `${BASE}/`).href
    const id = /(\d+)\.html/.exec(url)
    const author = /<span class="user">\s*<a[^>]*>([\s\S]*?)<\/a>/.exec(block)
    const time = /<span class="time">([\s\S]*?)<\/span>/.exec(block)

    const entry = {
      id: `wenxuecity:hot:${id ? id[1] : new URL(url).pathname}`,
      title,
      url,
    }

    if (author) {
      const name = stripTags(author[1])
      if (name) entry.author = name
    }
    if (time) {
      const publishedAt = stampSeconds(stripTags(time[1]))
      if (publishedAt !== undefined) entry.publishedAt = publishedAt
    }

    entries.push(entry)
    if (entries.length >= 10) break
  }

  return entries
}

export async function fetch(ctx) {
  const cid = String(ctx.params.cid ?? '').trim()

  if (!cid) {
    throw new Error('请填写版面 ID（数字）')
  }
  if (!/^\d+$/.test(cid)) {
    throw new Error(`版面 ID ${cid} 无效，应为数字`)
  }

  const url = `${BASE}/?cid=${cid}/`

  ctx.log.debug(`wenxuecity: GET ${url}`)

  const response = await ctx.fetch(url, { headers: { accept: 'text/html' } })

  if (!response.ok) {
    throw new Error(`文学城最热主题返回 ${response.status} ${response.statusText}`)
  }

  const html = await response.text()
  const entries = parseList(html)

  if (entries.length === 0) {
    throw new Error(`文学城版面 ${cid} 没有解析到热帖，版面 ID 或页面结构可能已经改变`)
  }

  return { entries, icon: `${BASE}/favicon.ico` }
}

export async function preview(ctx) {
  if (!ctx.item?.url) return null
  const content = await ctx.article(ctx.item.url)
  return content === null ? null : { content }
}
