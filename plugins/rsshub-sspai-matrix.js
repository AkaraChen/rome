// Ported from RSSHub lib/routes/sspai/matrix.ts (AGPL-3.0).
// 少数派 Matrix — /sspai/matrix
//
// Matrix is the community section, and the only difference from the home feed
// is the `is_matrix=1` filter and sorting by `matrix_at` rather than release
// time.

export const meta = {
  id: 'rome.rsshub-sspai-matrix',
  name: '少数派 · Matrix',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: '少数派 Matrix 社区的最新文章',
  icon: 'https://sspai.com/favicon.ico',
}

const API = 'https://sspai.com/api/v1/articles'
const CDN = 'https://cdnfile.sspai.com/'

function cover(value) {
  if (!value) return undefined
  return value.startsWith('http') ? value : `${CDN}${value}`
}

export async function fetch(ctx) {
  const url = new URL(API)
  url.searchParams.set('offset', '0')
  url.searchParams.set('limit', '20')
  url.searchParams.set('is_matrix', '1')
  url.searchParams.set('sort', 'matrix_at')
  url.searchParams.set('include_total', 'false')

  const response = await ctx.fetch(url, { headers: { accept: 'application/json' } })

  if (!response.ok) {
    throw new Error(`少数派返回 ${response.status}`)
  }

  const body = await response.json()

  if (!Array.isArray(body.list)) {
    throw new Error('少数派没有返回文章列表，接口可能已经变了')
  }

  const entries = body.list.map((item) => {
    const entry = {
      id: `sspai:${item.id}`,
      title: item.title,
      url: `https://sspai.com/post/${item.id}`,
      author: item.author?.nickname,
      summary: item.summary || undefined,
    }

    const image = cover(item.banner)
    if (image) entry.image = image

    const publishedAt = Number(item.released_at)
    if (Number.isFinite(publishedAt)) entry.publishedAt = Math.floor(publishedAt)

    return entry
  })

  ctx.log.info(`sspai-matrix: ${entries.length} 条`)

  return { entries }
}

export async function preview(ctx) {
  const content = await ctx.article(ctx.item.url)
  return content ? { content } : null
}
