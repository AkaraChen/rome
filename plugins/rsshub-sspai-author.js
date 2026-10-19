// Ported from RSSHub lib/routes/sspai/author.ts (AGPL-3.0).
// 少数派作者 — /sspai/author/:id
//
// `id` is the author's slug as it appears in the profile URL, but the article
// API only filters by numeric author id, so a slug is resolved first through
// the site's slug endpoint. A numeric id skips that request.
//
// The list response carries the nickname and slug, and the RSSHub route reads
// them off the first item rather than a second call; an empty list means the
// author has no posts, which is reported as an error instead of an empty feed.

export const meta = {
  id: 'rome.rsshub-sspai-author',
  name: '少数派 · 作者',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: '少数派指定作者的文章',
  icon: 'https://sspai.com/favicon.ico',
  params: {
    fields: [
      {
        key: 'id',
        type: 'text',
        label: '作者',
        help: '作者主页 URL 中的用户名，或数字作者 ID，例如 dnbwg',
        placeholder: 'dnbwg',
        default: '',
      },
    ],
  },
}

const API = 'https://sspai.com/api/v1'
const CDN = 'https://cdnfile.sspai.com/'

function cover(value) {
  if (!value) return undefined
  return value.startsWith('http') ? value : `${CDN}${value}`
}

async function json(ctx, url, referer) {
  const response = await ctx.fetch(url, { headers: { accept: 'application/json', referer } })

  if (!response.ok) {
    throw new Error(`少数派返回 ${response.status}（${url}）`)
  }

  return response.json()
}

export async function fetch(ctx) {
  let id = String(ctx.params.id || '').trim()

  if (!id) {
    throw new Error('请填写作者的用户名或 ID')
  }

  if (!/^\d+$/.test(id)) {
    const slug = await json(ctx, `${API}/user/slug/info/get?slug=${encodeURIComponent(id)}`, `https://sspai.com/u/${id}/posts`)

    if (slug.error !== 0 || !slug.data?.id) {
      throw new Error(`少数派上找不到作者 ${id}`)
    }

    id = String(slug.data.id)
  }

  const body = await json(ctx, `${API}/articles?offset=0&limit=20&author_ids=${id}&include_total=false`, 'https://sspai.com')

  if (!Array.isArray(body.list)) {
    throw new Error('少数派没有返回文章列表，接口可能已经变了')
  }

  if (body.list.length === 0) {
    throw new Error('该作者没有可见的文章')
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

  ctx.log.info(`sspai-author: ${entries.length} 条（${body.list[0].author?.nickname || id}）`)

  return { entries }
}

export async function preview(ctx) {
  const content = await ctx.article(ctx.item.url)
  return content ? { content } : null
}
