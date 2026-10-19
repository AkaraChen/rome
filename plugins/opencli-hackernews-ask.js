// Ported from OpenCLI clis/hackernews/ask.js (Apache-2.0).
// Hacker News Ask HN posts — the official Firebase API. The list endpoint
// returns ids only, so each story is one more request.

export const meta = {
  id: 'rome.opencli-hackernews-ask',
  name: 'Hacker News · Ask HN',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: 'Hacker News 官方接口的 Ask HN 问答。',
  icon: 'https://news.ycombinator.com/favicon.ico',
  params: {
    fields: [
      { key: 'limit', type: 'number', label: '每次抓取条数', help: '最多 50 条', default: 20, min: 1, max: 50 },
    ],
  },
}

const API = 'https://hacker-news.firebaseio.com/v0'
const SITE = 'https://news.ycombinator.com'

function integer(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(Math.max(parsed, min), max)
}

async function loadItem(ctx, id) {
  const response = await ctx.fetch(`${API}/item/${id}.json`)
  if (!response.ok) {
    throw new Error(`Hacker News 条目 ${id} 返回 HTTP ${response.status}`)
  }
  return response.json()
}

export async function fetch(ctx) {
  const limit = integer(ctx.params.limit, 20, 1, 50)

  const response = await ctx.fetch(`${API}/askstories.json`)
  if (!response.ok) {
    throw new Error(`Hacker News 榜单返回 HTTP ${response.status}`)
  }

  const ids = await response.json()
  if (!Array.isArray(ids)) {
    throw new Error('Hacker News 榜单返回了意外的数据。')
  }

  // Upstream reads a few extra ids because deleted and dead stories are
  // filtered only after their item requests; the cap keeps one refresh from
  // turning into an unbounded fan-out.
  const wanted = ids.slice(0, Math.min(limit + 10, 50))
  const stories = await Promise.all(wanted.map((id) => loadItem(ctx, id)))
  const entries = []

  for (const story of stories) {
    if (!story || !story.title || story.deleted || story.dead) continue
    if (entries.length >= limit) break

    entries.push({
      id: `hn:${story.id}`,
      title: story.title,
      url: story.url || `${SITE}/item?id=${story.id}`,
      author: story.by,
      publishedAt: story.time,
      summary: `${story.score ?? 0} 分 · ${story.descendants ?? 0} 条评论`,
      params: { id: String(story.id) },
    })
  }

  return { entries }
}

export async function preview(ctx) {
  const id = ctx.item.params && ctx.item.params.id
  if (!id) return null

  const story = await loadItem(ctx, id)
  // Ask/Show/job posts carry their text on the item itself; link posts have
  // none, so the linked page is what there is to read.
  if (story && story.text) return { content: story.text }
  if (ctx.item.url && !ctx.item.url.startsWith(SITE)) {
    const content = await ctx.article(ctx.item.url)
    return content === null ? null : { content }
  }
  return null
}
