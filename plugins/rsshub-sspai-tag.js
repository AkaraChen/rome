// Ported from RSSHub lib/routes/sspai/tag.ts (AGPL-3.0).
// 少数派标签 — /sspai/tag/:keyword
//
// The tag API filters by an exact tag name, and the route builds its referer
// from the beta tag page — the API is behind the same origin check as the site
// and rejects a request that arrives without it.
//
// `decodeURIComponent` runs first in RSSHub so an already-encoded keyword is
// not double-encoded; a malformed escape sequence would throw there, so this
// plugin only encodes and lets a bad keyword search for itself.

export const meta = {
  id: 'rome.rsshub-sspai-tag',
  name: '少数派 · 标签',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: '少数派指定标签下的文章',
  icon: 'https://sspai.com/favicon.ico',
  params: {
    fields: [
      {
        key: 'keyword',
        type: 'text',
        label: '标签',
        help: '标签名称，可在标签页 URL 中找到，例如 数码',
        placeholder: '数码',
        default: '',
      },
    ],
  },
}

const API = 'https://sspai.com/api/v1/articles'
const CDN = 'https://cdnfile.sspai.com/'

function cover(value) {
  if (!value) return undefined
  return value.startsWith('http') ? value : `${CDN}${value}`
}

export async function fetch(ctx) {
  const keyword = String(ctx.params.keyword || '').trim()

  if (!keyword) {
    throw new Error('请填写标签名称')
  }

  const encoded = encodeURIComponent(keyword)
  const referer = `https://beta.sspai.com/tag/${encoded}`

  const url = new URL(API)
  url.searchParams.set('offset', '0')
  url.searchParams.set('limit', '50')
  url.searchParams.set('has_tag', '1')
  url.searchParams.set('tag', keyword)
  url.searchParams.set('include_total', 'false')

  const response = await ctx.fetch(url, { headers: { accept: 'application/json', referer } })

  if (!response.ok) {
    throw new Error(`少数派返回 ${response.status}（标签 ${keyword}）`)
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

  ctx.log.info(`sspai-tag: ${entries.length} 条（${keyword}）`)

  return { entries }
}

export async function preview(ctx) {
  const content = await ctx.article(ctx.item.url)
  return content ? { content } : null
}
