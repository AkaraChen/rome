// Ported from OpenCLI clis/lobsters/hot.js (Apache-2.0).
// Lobsters hottest stories — the site serves the ranking as JSON, so there is
// nothing to scrape here.

export const meta = {
  id: 'rome.opencli-lobsters-hot',
  name: 'Lobsters · 热门',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: 'Lobsters 技术社区的热门故事。',
  icon: 'https://lobste.rs/favicon.ico',
  params: {
    fields: [
      { key: 'limit', type: 'number', label: '每次抓取条数', help: '最多 100 条', default: 20, min: 1, max: 100 },
    ],
  },
}

const HOTTEST = 'https://lobste.rs/hottest.json'

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

export async function fetch(ctx) {
  const limit = integer(ctx.params.limit, 20, 1, 100)

  const response = await ctx.fetch(HOTTEST, { headers: { accept: 'application/json' } })
  if (!response.ok) {
    throw new Error(`Lobsters 热门榜返回 HTTP ${response.status}`)
  }

  const stories = await response.json()
  if (!Array.isArray(stories)) {
    throw new Error('Lobsters 热门榜返回了意外的数据。')
  }

  const entries = []

  for (const story of stories.slice(0, limit)) {
    if (!story || !story.short_id || !story.title) continue

    const parts = [`${story.score ?? 0} 分`, `${story.comment_count ?? 0} 条评论`]
    if (Array.isArray(story.tags) && story.tags.length > 0) {
      parts.push(story.tags.map((tag) => `#${tag}`).join(' '))
    }

    entries.push({
      id: `lobsters:${story.short_id}`,
      title: story.title,
      // The adapter points at the discussion page rather than the submitted
      // link; the linked article is kept in params for `preview`.
      url: story.comments_url,
      author: story.submitter_user || undefined,
      publishedAt: seconds(story.created_at),
      summary: parts.join(' · '),
      params: { url: story.url || '' },
    })
  }

  return { entries }
}

export async function preview(ctx) {
  // Prefer the submitted article; text posts have no link, and then the
  // discussion page is the only content there is.
  const target = (ctx.item.params && ctx.item.params.url) || ctx.item.url
  const content = await ctx.article(target)
  return content === null ? null : { content }
}
