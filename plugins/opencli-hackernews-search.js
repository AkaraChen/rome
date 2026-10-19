// Ported from OpenCLI clis/hackernews/search.js (Apache-2.0).
// Hacker News search — Algolia's public index of the site. No key, no
// browser; `search_by_date` and `search` differ only in ranking.

export const meta = {
  id: 'rome.opencli-hackernews-search',
  name: 'Hacker News · 搜索',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: '通过 Algolia 接口搜索 Hacker News 故事。',
  icon: 'https://news.ycombinator.com/favicon.ico',
  params: {
    fields: [
      { key: 'query', type: 'text', label: '搜索关键词', help: '必填', default: '' },
      { key: 'limit', type: 'number', label: '每次抓取条数', help: '最多 100 条', default: 20, min: 1, max: 100 },
      {
        key: 'sort',
        type: 'select',
        label: '排序方式',
        default: 'relevance',
        options: [
          { value: 'relevance', label: '相关度' },
          { value: 'date', label: '时间' },
        ],
      },
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
  const query = String(ctx.params.query || '').trim()
  if (!query) {
    throw new Error('请填写搜索关键词。')
  }

  const limit = integer(ctx.params.limit, 20, 1, 100)
  const sort = ctx.params.sort === 'date' ? 'date' : 'relevance'
  const endpoint = sort === 'date' ? 'search_by_date' : 'search'
  const url = `https://hn.algolia.com/api/v1/${endpoint}?query=${encodeURIComponent(query)}&tags=story&hitsPerPage=${limit}`

  const response = await ctx.fetch(url, { headers: { accept: 'application/json' } })
  if (!response.ok) {
    throw new Error(`Hacker News 搜索返回 HTTP ${response.status}`)
  }

  const body = await response.json()
  const hits = Array.isArray(body.hits) ? body.hits : []
  const entries = []

  for (const hit of hits) {
    if (!hit || !hit.objectID) continue

    const title = hit.title || hit.story_title
    if (!title) continue

    entries.push({
      id: `hn:${hit.objectID}`,
      title,
      url: hit.url || `${SITE}/item?id=${hit.objectID}`,
      author: hit.author || undefined,
      // `created_at_i` is already unix seconds; `created_at` is the ISO form.
      publishedAt: Number.isFinite(hit.created_at_i) ? hit.created_at_i : undefined,
      summary: `${hit.points ?? 0} 分 · ${hit.num_comments ?? 0} 条评论`,
      params: { id: String(hit.objectID) },
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
