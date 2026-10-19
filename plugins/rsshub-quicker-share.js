// Ported from RSSHub lib/routes/quicker/share.ts (AGPL-3.0).
// Quicker 动作分享 — 动作库的排行榜。
//
// 页面用的是没有 tbody 的表格（浏览器会补，但字符串扫描不会），所以直接按
// <tr> 切块；表头行含 <th>，跳过即可。更新时间的元素是 title="最后更新"，
// 里面写的是「23 分钟前」这种相对时间。

export const meta = {
  id: 'rome.rsshub-quicker-share',
  name: 'Quicker · 动作分享',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: 'Quicker 动作库的最新、最热与最新动作',
  icon: 'https://getquicker.net/favicon.ico',
  params: {
    fields: [
      {
        key: 'category',
        type: 'select',
        label: '分类',
        help: '动作库的排序或类型',
        default: 'Recent',
        required: false,
        options: [
          { value: 'Recent', label: '动作库最新更新' },
          { value: 'Recommended', label: '动作库最多赞' },
          { value: 'NewActions', label: '动作库新动作' },
          { value: 'RecentLiked', label: '动作库最近赞' },
          { value: 'SubPrograms', label: '子程序' },
          { value: 'PowerKeys', label: '扩展热键' },
          { value: 'TextCommands', label: '文本指令' },
        ],
      },
    ],
  },
}

const BASE = 'https://getquicker.net'
const CATEGORIES = new Set(['Recent', 'Recommended', 'NewActions', 'RecentLiked', 'SubPrograms', 'PowerKeys', 'TextCommands'])

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

function relativeSeconds(text) {
  const now = Math.floor(Date.now() / 1000)
  let match

  if (!text) return undefined
  if ((match = /(\d+)\s*秒前/.exec(text))) return now - Number(match[1])
  if ((match = /(\d+)\s*分钟前/.exec(text))) return now - Number(match[1]) * 60
  if ((match = /(\d+)\s*小时前/.exec(text))) return now - Number(match[1]) * 3600
  if ((match = /(\d+)\s*天前/.exec(text))) return now - Number(match[1]) * 86400
  if (/昨天/.test(text)) return now - 86400
  if (/前天/.test(text)) return now - 172800
  return undefined
}

function parseRows(html) {
  const entries = []

  for (const match of html.matchAll(/<tr[\s\S]*?<\/tr>/g)) {
    const row = match[0]
    if (/<th[\s>]/.test(row)) continue

    const anchor = /<a\b([^>]*)>([\s\S]*?)<\/a>/.exec(row)
    if (!anchor) continue

    const href = /\bhref="([^"]+)"/.exec(anchor[1])
    const title = stripTags(anchor[2])
    if (!href || !title) continue

    const url = new URL(decode(href[1]), BASE).href
    const date = /<div[^>]*title="最后更新"[^>]*>([\s\S]*?)<\/div>/.exec(row)
    const author = /<a class="user-link[^"]*"[^>]*>([\s\S]*?)<\/a>/.exec(row)

    const code = new URL(url).searchParams.get('code')
    const entry = {
      // 动作的 code 是永久标识；没有 code 时退回路径。
      id: `quicker:action:${code || new URL(url).pathname}`,
      title,
      url,
    }

    if (author) {
      const name = stripTags(author[1])
      if (name) entry.author = name
    }
    if (date) {
      const publishedAt = relativeSeconds(stripTags(date[1]))
      if (publishedAt !== undefined) entry.publishedAt = publishedAt
    }

    entries.push(entry)
    if (entries.length >= 25) break
  }

  return entries
}

export async function fetch(ctx) {
  const category = String(ctx.params.category ?? 'Recent').trim() || 'Recent'

  if (!CATEGORIES.has(category)) {
    throw new Error(`不支持的动作分类 ${category}`)
  }

  const url = `${BASE}/Share/${category}`

  ctx.log.debug(`quicker: GET ${url}`)

  const response = await ctx.fetch(url, { headers: { accept: 'text/html' } })

  if (!response.ok) {
    throw new Error(`Quicker 动作分享返回 ${response.status} ${response.statusText}`)
  }

  const html = await response.text()
  const entries = parseRows(html)

  if (entries.length === 0) {
    throw new Error('Quicker 动作分享页没有解析到动作，页面结构可能已经改变')
  }

  return { entries, icon: `${BASE}/favicon.ico` }
}

export async function preview(ctx) {
  if (!ctx.item?.url) return null
  const content = await ctx.article(ctx.item.url)
  return content === null ? null : { content }
}
