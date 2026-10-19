// Ported from RSSHub lib/routes/sspai/index.ts (AGPL-3.0).
// 少数派首页 — /sspai/index
//
// The list API the site's own home page calls. It answers with the ten newest
// posts and nothing else, so there is no pagination and no cursor: refreshing
// re-reads the same window and the ids keep the feed deduplicated.
//
// RSSHub fetches each post's body here. This plugin does not — the reader asks
// for one page at a time through `preview` instead of paying for ten bodies on
// every refresh.

export const meta = {
  id: 'rome.rsshub-sspai-index',
  name: '少数派 · 首页',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: '少数派首页的最新文章',
  icon: 'https://sspai.com/favicon.ico',
}

const API = 'https://sspai.com/api/v1/article/index/page/get'
const CDN = 'https://cdnfile.sspai.com/'

/// The banner is stored as a CDN-relative path; the page cannot resolve one.
function cover(value) {
  if (!value) return undefined
  return value.startsWith('http') ? value : `${CDN}${value}`
}

export async function fetch(ctx) {
  const url = new URL(API)
  url.searchParams.set('limit', '10')
  url.searchParams.set('offset', '0')
  url.searchParams.set('created_at', '0')

  const response = await ctx.fetch(url, { headers: { accept: 'application/json' } })

  if (!response.ok) {
    throw new Error(`少数派返回 ${response.status}`)
  }

  const body = await response.json()
  const list = body.data

  if (!Array.isArray(list)) {
    throw new Error('少数派没有返回文章数组，接口可能已经变了')
  }

  const entries = list.map((item) => {
    const entry = {
      id: `sspai:${item.id}`,
      title: item.title,
      url: `https://sspai.com/post/${item.id}`,
      author: item.author?.nickname,
      summary: item.summary || undefined,
    }

    const image = cover(item.banner)
    if (image) entry.image = image

    const publishedAt = Number(item.released_time)
    if (Number.isFinite(publishedAt)) entry.publishedAt = Math.floor(publishedAt)

    return entry
  })

  ctx.log.info(`sspai-index: ${entries.length} 条`)

  return { entries }
}

export async function preview(ctx) {
  const content = await ctx.article(ctx.item.url)
  return content ? { content } : null
}
