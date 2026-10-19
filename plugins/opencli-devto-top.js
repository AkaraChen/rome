// Ported from OpenCLI clis/devto/top.js (Apache-2.0).
// DEV Community top articles — the public `/api/articles?top=1` endpoint,
// which is the site's daily most-reacted list.

export const meta = {
  id: 'rome.opencli-devto-top',
  name: 'DEV Community · 热门',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: 'DEV Community 当日热门文章。',
  icon: 'https://dev.to/favicon.ico',
  params: {
    fields: [
      { key: 'limit', type: 'number', label: '每次抓取条数', help: '1 到 100 篇', default: 20, min: 1, max: 100 },
    ],
  },
}

const API = 'https://dev.to/api/articles'

function integer(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(Math.max(parsed, min), max)
}

function seconds(value) {
  if (!value) return undefined
  const milliseconds = Date.parse(value)
  return Number.isFinite(milliseconds) ? Math.floor(milliseconds / 1000) : undefined
}

function toEntry(article) {
  if (!article || article.id == null || !article.title) return null

  const url = article.url || (article.path ? `https://dev.to${article.path}` : '')
  if (!url) return null

  const parts = []

  // `tag_list` is an array in this endpoint; older responses used a string.
  const tags = Array.isArray(article.tag_list)
    ? article.tag_list
    : String(article.tag_list || '').split(',').map((tag) => tag.trim()).filter(Boolean)

  if (tags.length > 0) {
    parts.push(tags.map((tag) => `#${tag}`).join(' '))
  }
  if (article.public_reactions_count != null) {
    parts.push(`${article.public_reactions_count} 赞`)
  }
  if (article.comments_count != null) {
    parts.push(`${article.comments_count} 条评论`)
  }
  if (article.reading_time_minutes != null) {
    parts.push(`${article.reading_time_minutes} 分钟阅读`)
  }

  const entry = {
    id: `devto:${article.id}`,
    title: String(article.title),
    url,
    author: String(article.user?.username || ''),
    publishedAt: seconds(article.published_at),
  }

  if (parts.length > 0) entry.summary = parts.join(' · ')
  if (article.cover_image || article.social_image) {
    entry.image = article.cover_image || article.social_image
  }

  return entry
}

export async function fetch(ctx) {
  const limit = integer(ctx.params.limit, 20, 1, 100)

  const response = await ctx.fetch(`${API}?top=1&per_page=${limit}`, {
    headers: { accept: 'application/json' },
  })

  if (!response.ok) {
    throw new Error(`dev.to 返回 HTTP ${response.status}`)
  }

  const body = await response.json()
  const list = Array.isArray(body) ? body : []

  if (list.length === 0) {
    throw new Error('dev.to 热门榜没有返回文章。')
  }

  return { entries: list.map(toEntry).filter(Boolean) }
}

export async function preview(ctx) {
  const content = await ctx.article(ctx.item.url)
  return content === null ? null : { content }
}
