// Ported from RSSHub lib/routes/zhihu/hot.ts (AGPL-3.0).
// 知乎热榜 — a JSON API fetcher.
//
// The hot list is served by api.zhihu.com as a plain JSON array; no cookie is
// needed for the ranking itself. Each entry points at a question, and the same
// endpoint is re-read every refresh because the ranking churns: Rome works out
// what is new by comparing the stable question ids.
//
// Preview asks the host's article extractor for the question page. The API's
// excerpt is only the first paragraph, and the page is where the answers are.

export const meta = {
  id: 'rome.rsshub-zhihu-hot',
  name: '知乎 · 热榜',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: '知乎热榜当前的前十个问题，打开后可读问题页面',
  icon: 'https://www.zhihu.com/favicon.ico',
}

const API = 'https://api.zhihu.com/topstory/hot-lists/total?limit=10&reverse_order=0'

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

/// Zhihu's own timestamps are unix seconds, but a value that looks like
/// milliseconds still arrives from some endpoints, so accept both.
function seconds(value) {
  const number = Number(value)
  if (!Number.isFinite(number) || number <= 0) return undefined
  return Math.floor(number > 1e12 ? number / 1000 : number)
}

export async function fetch(ctx) {
  ctx.log.debug(`zhihu-hot: GET ${API}`)

  const response = await ctx.fetch(API, {
    headers: { accept: 'application/json', referer: 'https://www.zhihu.com/hot' },
  })

  if (!response.ok) {
    throw new Error(`知乎热榜返回 ${response.status} ${response.statusText}`)
  }

  const body = await response.json()

  if (!Array.isArray(body.data)) {
    throw new Error('知乎热榜没有返回 data 数组，接口可能已经变了')
  }

  const entries = []

  for (const item of body.data) {
    const target = item?.target
    if (!target?.title) continue

    // `target.url` is `https://api.zhihu.com/questions/<id>`; the last segment
    // is the question id the public page uses.
    const questionId = String(target.url ?? '').split('/').pop() || String(target.id ?? '')
    if (!questionId) continue

    const entry = {
      // A question id never changes, so the entry is stable across refreshes.
      id: `zhihu:hot:${questionId}`,
      title: plain(target.title),
      url: `https://www.zhihu.com/question/${questionId}`,
      summary: plain(target.excerpt, 160),
      // What preview needs to ask for the question rather than the list.
      params: { questionId },
    }

    if (target.author?.name) entry.author = target.author.name

    const publishedAt = seconds(target.created)
    if (publishedAt !== undefined) entry.publishedAt = publishedAt

    entries.push(entry)
  }

  if (entries.length === 0) {
    throw new Error('知乎热榜返回了 0 条可解析的问题，页面结构可能已经变了')
  }

  ctx.log.info(`zhihu-hot: ${entries.length} 条`)

  return { entries }
}

export async function preview(ctx) {
  const questionId = ctx.item?.params?.questionId
    || String(ctx.item?.id ?? '').replace(/^zhihu:hot:/, '')

  if (!questionId) return null

  const content = await ctx.article(`https://www.zhihu.com/question/${questionId}`)

  return content === null ? null : { content }
}
