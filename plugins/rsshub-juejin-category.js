// Ported from RSSHub lib/routes/juejin/category.ts (AGPL-3.0).
// 掘金分类 — /juejin/category/:category
//
// The category list endpoint maps the slug in the URL (`frontend`) to the
// numeric `cate_id` the recommend feed needs, so it is always two requests.
// A slug the list does not know is reported rather than silently returning
// the whole site's feed.

export const meta = {
  id: 'rome.rsshub-juejin-category',
  name: '掘金 · 分类',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: '掘金指定分类的最新文章',
  icon: 'https://juejin.cn/favicon.ico',
  params: {
    fields: [
      {
        key: 'category',
        type: 'select',
        label: '分类',
        default: 'frontend',
        options: [
          { value: 'backend', label: '后端' },
          { value: 'frontend', label: '前端' },
          { value: 'android', label: 'Android' },
          { value: 'ios', label: 'iOS' },
          { value: 'ai', label: '人工智能' },
          { value: 'freebie', label: '开发工具' },
          { value: 'career', label: '代码人生' },
          { value: 'article', label: '阅读' },
        ],
      },
    ],
  },
}

const API = 'https://api.juejin.cn'
const PAGE = 'https://juejin.cn'

function firstLine(text, limit) {
  const line = String(text ?? '').replace(/\s+/g, ' ').trim()
  if (!line) return undefined
  return line.length > limit ? `${line.slice(0, limit - 1)}…` : line
}

function entryOf(item) {
  const article = item?.article_info
  if (!article?.article_id) return null

  const entry = {
    id: `juejin:${article.article_id}`,
    title: article.title,
    url: `${PAGE}/post/${article.article_id}`,
    author: item.author_user_info?.user_name,
    summary: firstLine(article.brief_content, 140) || '暂无摘要',
  }

  if (article.cover_image) entry.image = article.cover_image

  const publishedAt = Number(article.ctime)
  if (Number.isFinite(publishedAt)) entry.publishedAt = Math.floor(publishedAt)

  return entry
}

async function post(ctx, url, body) {
  const response = await ctx.fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    throw new Error(`掘金返回 ${response.status}（${url}）`)
  }

  const payload = await response.json()

  if (payload.err_no !== 0) {
    throw new Error(`掘金接口报错 ${payload.err_no}：${payload.err_msg || '未知错误'}`)
  }

  return payload.data
}

export async function fetch(ctx) {
  const category = String(ctx.params.category || '').trim() || 'frontend'

  const briefs = await ctx.fetch(`${API}/tag_api/v1/query_category_briefs`, { headers: { accept: 'application/json' } })

  if (!briefs.ok) {
    throw new Error(`掘金返回 ${briefs.status}（分类列表）`)
  }

  const categories = (await briefs.json()).data

  if (!Array.isArray(categories)) {
    throw new Error('掘金没有返回分类列表，接口可能已经变了')
  }

  const match = categories.find((item) => item.category_url === category)

  if (!match) {
    throw new Error(`掘金没有 ${category} 这个分类`)
  }

  const data = await post(ctx, `${API}/recommend_api/v1/article/recommend_cate_feed`, {
    id_type: 2,
    sort_type: 300,
    cate_id: match.category_id,
    cursor: '0',
    limit: 20,
  })

  if (!Array.isArray(data)) {
    throw new Error('掘金没有返回文章数组，接口可能已经变了')
  }

  const entries = data.map(entryOf).filter(Boolean)

  ctx.log.info(`juejin-category: ${entries.length} 条（${match.category_name}）`)

  return { entries }
}

export async function preview(ctx) {
  const content = await ctx.article(ctx.item.url)
  return content ? { content } : null
}
