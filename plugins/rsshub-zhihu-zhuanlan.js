// Ported from RSSHub lib/routes/zhihu/zhuanlan.ts (AGPL-3.0).
// 知乎专栏 — the column's item listing as JSON.
//
// The column metadata endpoint now asks for a login, but the two listing
// endpoints this feed needs do not: the newest items and the pinned ones are
// both public. They are merged and deduplicated by id, and only the item types
// that carry their own title and link are used.
//
// Content is left to preview. The listing embeds an article body, but a column
// can mix articles, answers and videos, and the page is the honest thing to
// open for all three.

export const meta = {
  id: 'rome.rsshub-zhihu-zhuanlan',
  name: '知乎 · 专栏',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: '知乎专栏的最新文章与置顶内容',
  icon: 'https://www.zhihu.com/favicon.ico',
  params: {
    fields: [
      {
        key: 'id',
        type: 'text',
        label: '专栏 id',
        help: '在专栏主页 URL 中找到，例如 googledevelopers',
        default: '',
      },
    ],
  },
}

const BASE = 'https://zhuanlan.zhihu.com/api/columns/'

function decode(text) {
  return String(text).replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (match, entity) => {
    if (entity[0] === '#') {
      const code = entity[1] === 'x' || entity[1] === 'X'
        ? Number.parseInt(entity.slice(2), 16)
        : Number.parseInt(entity.slice(1), 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : match
    }
    return match
  })
}

function plain(html, limit) {
  const text = decode(String(html ?? '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim()
  if (!limit || text.length <= limit) return text
  return `${text.slice(0, limit).replace(/\s+$/, '')}…`
}

function seconds(value) {
  const number = Number(value)
  if (!Number.isFinite(number) || number <= 0) return undefined
  return Math.floor(number > 1e12 ? number / 1000 : number)
}

/// One item, in the shape the column page shows it. Returns null for the item
/// types this feed does not know how to link.
function toEntry(item) {
  if (!item?.id) return null

  if (item.type === 'article') {
    if (!item.title) return null
    const entry = {
      id: `zhihu:zhuanlan:article:${item.id}`,
      title: plain(item.title),
      url: item.url || `https://zhuanlan.zhihu.com/p/${item.id}`,
      summary: plain(item.excerpt, 160),
    }
    if (item.author?.name) entry.author = item.author.name
    if (item.title_image) entry.image = item.title_image
    const publishedAt = seconds(item.created)
    if (publishedAt !== undefined) entry.publishedAt = publishedAt
    return entry
  }

  if (item.type === 'answer') {
    const question = item.question ?? {}
    if (!question.id || !question.title) return null
    const entry = {
      id: `zhihu:zhuanlan:answer:${item.id}`,
      title: plain(question.title),
      url: `https://www.zhihu.com/question/${question.id}/answer/${item.id}`,
      summary: plain(item.excerpt, 160),
    }
    const author = question.author?.name || item.author?.name
    if (author) entry.author = author
    const publishedAt = seconds(item.created_time ?? item.created)
    if (publishedAt !== undefined) entry.publishedAt = publishedAt
    return entry
  }

  if (item.type === 'zvideo') {
    if (!item.title) return null
    const entry = {
      id: `zhihu:zhuanlan:zvideo:${item.id}`,
      title: plain(item.title),
      url: `https://www.zhihu.com/zvideo/${item.id}`,
      summary: plain(item.description, 160),
    }
    if (item.author?.name) entry.author = item.author.name
    if (item.title_image) entry.image = item.title_image
    const publishedAt = seconds(item.created_at ?? item.created)
    if (publishedAt !== undefined) entry.publishedAt = publishedAt
    return entry
  }

  return null
}

export async function fetch(ctx) {
  const id = String(ctx.params.id ?? '').trim()

  if (!id) {
    throw new Error('缺少专栏 id：请在专栏主页 URL 中找到它，例如 googledevelopers')
  }

  const base = `${BASE}${encodeURIComponent(id)}`
  const headers = { accept: 'application/json', referer: `https://zhuanlan.zhihu.com/${id}` }

  ctx.log.debug(`zhihu-zhuanlan: GET ${base}/items`)

  const [itemsResponse, pinnedResponse] = await Promise.all([
    ctx.fetch(`${base}/items`, { headers }),
    // Pinned items are optional. A block on this endpoint should not take the
    // whole column down, so a failure here is logged and ignored.
    ctx.fetch(`${base}/pinned-items/v2`, { headers }).catch((error) => {
      ctx.log.warn(`zhihu-zhuanlan: 置顶内容读取失败：${error.message}`)
      return null
    }),
  ])

  if (!itemsResponse.ok) {
    throw new Error(`知乎专栏返回 ${itemsResponse.status} ${itemsResponse.statusText}`)
  }

  const listing = await itemsResponse.json()

  if (!Array.isArray(listing.data)) {
    throw new Error('知乎专栏没有返回 data 数组，接口可能已经变了')
  }

  const pinned = []
  if (pinnedResponse?.ok) {
    const body = await pinnedResponse.json()
    if (Array.isArray(body.data)) pinned.push(...body.data)
  }

  const seen = new Set()
  const entries = []

  for (const item of [...listing.data, ...pinned]) {
    const entry = toEntry(item)
    if (!entry || seen.has(entry.id)) continue
    seen.add(entry.id)
    entries.push(entry)
  }

  if (entries.length === 0) {
    throw new Error('知乎专栏返回了 0 条可解析的内容，页面结构可能已经变了')
  }

  ctx.log.info(`zhihu-zhuanlan: ${entries.length} 条`)

  return { entries }
}

export async function preview(ctx) {
  const url = ctx.item?.url
  if (!url) return null

  const content = await ctx.article(url)

  return content === null ? null : { content }
}
