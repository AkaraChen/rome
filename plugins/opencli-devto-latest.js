// Ported from OpenCLI clis/devto/latest.js (Apache-2.0).
// DEV Community latest articles — the public `/api/articles/latest` endpoint,
// which is the firehose of brand-new posts across every tag.

export const meta = {
  id: 'rome.opencli-devto-latest',
  name: 'DEV Community · 最新',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: 'DEV Community 最新发布的文章，覆盖全部标签。',
  icon: 'https://dev.to/favicon.ico',
  params: {
    fields: [
      { key: 'limit', type: 'number', label: '每页文章数', help: '1 到 100 篇', default: 20, min: 1, max: 100 },
      { key: 'page', type: 'number', label: '页码', help: '从第 1 页开始', default: 1, min: 1, max: 1000 },
    ],
  },
}

const API = 'https://dev.to/api/articles/latest'

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
  const page = integer(ctx.params.page, 1, 1, 1000)

  const response = await ctx.fetch(`${API}?per_page=${limit}&page=${page}`, {
    headers: { accept: 'application/json' },
  })

  if (!response.ok) {
    throw new Error(`dev.to 返回 HTTP ${response.status}`)
  }

  const body = await response.json()
  const list = Array.isArray(body) ? body : []

  if (list.length === 0) {
    // An empty page usually means the page number went past the end or the
    // endpoint changed shape; either way, silence would hide it.
    throw new Error(`dev.to 第 ${page} 页没有返回文章。`)
  }

  return { entries: list.map(toEntry).filter(Boolean) }
}

export async function preview(ctx) {
  const content = await ctx.article(ctx.item.url)
  return content === null ? null : { content }
}
