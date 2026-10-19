// Ported from RSSHub lib/routes/wenxuecity/bbs.ts (AGPL-3.0).
// 文学城论坛最新主题 — bbs.wenxuecity.com/<版面>/。
//
// 帖子按 odd/even 交替着色，所以两块都要取。作者在 span.b 里，时间在
// <small> 里写作 MM/DD/YYYY HH:MM:SS；站点时钟的时区没有公开，按 UTC 读。

export const meta = {
  id: 'rome.rsshub-wenxuecity-bbs',
  name: '文学城 · 论坛最新主题',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: '文学城论坛指定版面的最新主题',
  icon: 'https://www.wenxuecity.com/favicon.ico',
  params: {
    fields: [
      {
        key: 'cat',
        type: 'text',
        label: '版面名',
        help: '版面 URL 中的名字，例如 tzlc',
        default: '',
        required: true,
      },
      {
        key: 'elite',
        type: 'select',
        label: '精华区',
        help: '只看精华帖时选 1',
        default: '0',
        required: false,
        options: [
          { value: '0', label: '全部' },
          { value: '1', label: '精华区' },
        ],
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
  const match = /(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})/.exec(text)
  if (!match) return undefined
  const [, month, day, year, hour, minute, second] = match
  const pad = (value) => String(value).padStart(2, '0')
  const milliseconds = Date.parse(`${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:${pad(second)}Z`)
  return Number.isFinite(milliseconds) ? Math.floor(milliseconds / 1000) : undefined
}

function parseList(html, base) {
  const entries = []

  for (const block of html.split(/<div class="(?:odd|even)">/).slice(1)) {
    const anchor = /<a\b([^>]*\bclass="post"[^>]*)>([\s\S]*?)<\/a>/.exec(block)
    if (!anchor) continue

    const href = /\bhref="([^"]+)"/.exec(anchor[1])
    const title = stripTags(anchor[2])
    if (!href || !title) continue

    // 帖子链接是 ./2386956.html，相对的是版面页而不是站点根目录。
    const url = new URL(decode(href[1]), base).href
    const id = /(\d+)\.html/.exec(url)
    const author = /<a class="b"[^>]*>([\s\S]*?)<\/a>/.exec(block)
    const small = /<small>([\s\S]*?)<\/small>/.exec(block)

    const entry = {
      // 帖子文件名就是帖子 ID。
      id: `wenxuecity:bbs:${id ? id[1] : new URL(url).pathname}`,
      title,
      url,
    }

    if (author) {
      const name = stripTags(author[1])
      if (name) entry.author = name
    }
    if (small) {
      const publishedAt = stampSeconds(stripTags(small[1]))
      if (publishedAt !== undefined) entry.publishedAt = publishedAt
    }

    entries.push(entry)
    if (entries.length >= 10) break
  }

  return entries
}

export async function fetch(ctx) {
  const cat = String(ctx.params.cat ?? '').trim()

  if (!cat) {
    throw new Error('请填写版面名，例如 tzlc')
  }
  if (/[/?#]/.test(cat)) {
    throw new Error(`版面名 ${cat} 无效，不能包含 / ? #`)
  }

  const elite = String(ctx.params.elite ?? '0').trim() || '0'
  if (elite !== '0' && elite !== '1') {
    throw new Error(`精华区参数 ${elite} 无效，只能是 0 或 1`)
  }

  const url = `${BASE}/${encodeURIComponent(cat)}/?elite=${elite}`

  ctx.log.debug(`wenxuecity: GET ${url}`)

  const response = await ctx.fetch(url, { headers: { accept: 'text/html' } })

  if (!response.ok) {
    throw new Error(`文学城论坛返回 ${response.status} ${response.statusText}`)
  }

  const html = await response.text()
  const entries = parseList(html, url)

  if (entries.length === 0) {
    throw new Error(`文学城版面 ${cat} 没有解析到主题，版面名或页面结构可能已经改变`)
  }

  return { entries, icon: `${BASE}/favicon.ico` }
}

export async function preview(ctx) {
  if (!ctx.item?.url) return null
  const content = await ctx.article(ctx.item.url)
  return content === null ? null : { content }
}
