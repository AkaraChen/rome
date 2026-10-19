// Ported from RSSHub lib/routes/ifanr/category.ts (AGPL-3.0).
// 爱范儿分类 — a JSON listing behind the category pages.
//
// `sso.ifanr.com/api/v5/wp/article` takes the Chinese category name straight
// from the URL, so the route's four categories become a select rather than a
// free-text slug. The listing carries an excerpt and a cover; the article body
// is left to preview.
//
// The category route upstream is marked `antiCrawler`, but this API answers
// without cookies.

export const meta = {
  id: 'rome.rsshub-ifanr-category',
  name: '爱范儿 · 分类',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: '爱范儿早报、评测、糖纸众测与产品分类的最新文章',
  icon: 'https://www.ifanr.com/favicon.ico',
  params: {
    fields: [
      {
        key: 'name',
        type: 'select',
        label: '分类',
        help: '选择要订阅的爱范儿分类。',
        default: '',
        options: [
          { value: '早报', label: '早报' },
          { value: '评测', label: '评测' },
          { value: '糖纸众测', label: '糖纸众测' },
          { value: '产品', label: '产品' },
        ],
      },
    ],
  },
}

const API = 'https://sso.ifanr.com/api/v5/wp/article/'

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
  const name = String(ctx.params.name ?? '').trim()

  if (!name) {
    throw new Error('缺少分类：请选择早报、评测、糖纸众测或产品')
  }

  const allowed = ['早报', '评测', '糖纸众测', '产品']
  if (!allowed.includes(name)) {
    throw new Error(`不支持的分类 ${name}：可选值为 ${allowed.join('、')}`)
  }

  const url = `${API}?post_category=${encodeURIComponent(name)}&limit=20&offset=0`
  ctx.log.debug(`ifanr-category: GET ${url}`)

  const response = await ctx.fetch(url, { headers: { accept: 'application/json' } })

  if (!response.ok) {
    throw new Error(`爱范儿返回 ${response.status} ${response.statusText}`)
  }

  const body = await response.json()

  if (!Array.isArray(body?.objects)) {
    throw new Error('爱范儿没有返回 objects 数组，接口可能已经变了')
  }

  const entries = body.objects
    .filter((item) => item?.post_id && item.post_title && item.post_url)
    .map((item) => {
      const entry = {
        // `post_id` is the article id in the site's own URL, so it is stable.
        id: `ifanr:article:${item.post_id}`,
        title: plain(item.post_title),
        url: item.post_url,
        summary: plain(item.post_excerpt, 140),
      }

      if (item.created_by?.name) entry.author = item.created_by.name
      if (item.post_cover_image) entry.image = item.post_cover_image

      const publishedAt = seconds(item.published_at ?? item.created_at)
      if (publishedAt !== undefined) entry.publishedAt = publishedAt

      return entry
    })

  if (entries.length === 0) {
    throw new Error('爱范儿返回了 0 条可解析的文章，接口可能已经变了')
  }

  ctx.log.info(`ifanr-category: ${name} ${entries.length} 条`)

  return { entries }
}

export async function preview(ctx) {
  const url = ctx.item?.url
  if (!url) return null

  const content = await ctx.article(url)

  return content === null ? null : { content }
}
