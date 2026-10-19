// Ported from RSSHub lib/routes/ifanr/index.ts (AGPL-3.0).
// 爱范儿首页 — the mixed web feed.
//
// The feed lists posts and columns together; the upstream route drops the
// columns, because a column is a container rather than an article. Each post
// carries its cover and excerpt, and the article body is read by preview.
//
// `post_id` is what the site's own article URLs end with, so it is the stable
// key; the feed's separate `id` is not used for anything.

export const meta = {
  id: 'rome.rsshub-ifanr-index',
  name: '爱范儿 · 首页',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: '爱范儿首页的最新文章',
  icon: 'https://www.ifanr.com/favicon.ico',
}

const API = 'https://sso.ifanr.com/api/v5/wp/web-feed/?limit=20&offset=0'

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

function seconds(value) {
  const number = Number(value)
  if (!Number.isFinite(number) || number <= 0) return undefined
  return Math.floor(number > 1e12 ? number / 1000 : number)
}

export async function fetch(ctx) {
  ctx.log.debug(`ifanr-index: GET ${API}`)

  const response = await ctx.fetch(API, { headers: { accept: 'application/json' } })

  if (!response.ok) {
    throw new Error(`爱范儿首页返回 ${response.status} ${response.statusText}`)
  }

  const body = await response.json()

  if (!Array.isArray(body?.objects)) {
    throw new Error('爱范儿首页没有返回 objects 数组，接口可能已经变了')
  }

  const entries = body.objects
    // Columns are containers, not articles; they have no readable body.
    .filter((item) => item?.post_type !== 'column')
    .filter((item) => item?.post_id && item.post_title && item.post_url)
    .map((item) => {
      const entry = {
        id: `ifanr:post:${item.post_id}`,
        title: plain(item.post_title),
        url: item.post_url,
        summary: plain(item.post_excerpt, 140),
      }

      if (item.created_by?.name) entry.author = item.created_by.name
      if (item.post_cover_image) entry.image = item.post_cover_image

      const publishedAt = seconds(item.created_at)
      if (publishedAt !== undefined) entry.publishedAt = publishedAt

      return entry
    })

  if (entries.length === 0) {
    throw new Error('爱范儿首页返回了 0 条可解析的文章，接口可能已经变了')
  }

  ctx.log.info(`ifanr-index: ${entries.length} 条`)

  return { entries }
}

export async function preview(ctx) {
  const url = ctx.item?.url
  if (!url) return null

  const content = await ctx.article(url)

  return content === null ? null : { content }
}
