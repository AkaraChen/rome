// Ported from RSSHub lib/routes/juejin/trending.ts (AGPL-3.0).
// 掘金热门 — /juejin/trending/:category/:type
//
// Two recommend endpoints sit behind this route. `recommend_all_feed` answers
// for the whole site and wraps each hit in `item_type`/`item_info`; a named
// category uses `recommend_cate_feed`, which returns bare articles. The
// wrapper is detected rather than assumed, because which endpoint answers
// depends on whether the slug exists in the category list.
//
// `sort_type` is the API's own scale: 7 for the week, 30 for the month, 0 for
// all time.

export const meta = {
  id: 'rome.rsshub-juejin-trending',
  name: '掘金 · 热门',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: '掘金各分类的本周、本月或历史最热文章',
  icon: 'https://juejin.cn/favicon.ico',
  params: {
    fields: [
      {
        key: 'category',
        type: 'select',
        label: '分类',
        default: 'all',
        options: [
          { value: 'all', label: '全部' },
          { value: 'backend', label: '后端' },
          { value: 'frontend', label: '前端' },
          { value: 'android', label: 'Android' },
          { value: 'ios', label: 'iOS' },
          { value: 'ai', label: '人工智能' },
          { value: 'freebie', label: '工具资源' },
          { value: 'article', label: '阅读' },
          { value: 'design', label: '设计' },
          { value: 'product', label: '产品' },
          { value: 'devops', label: '运维' },
        ],
      },
      {
        key: 'type',
        type: 'select',
        label: '时间范围',
        default: 'weekly',
        options: [
          { value: 'weekly', label: '本周最热' },
          { value: 'monthly', label: '本月最热' },
          { value: 'historical', label: '历史最热' },
        ],
      },
    ],
  },
}

const API = 'https://api.juejin.cn'
const PAGE = 'https://juejin.cn'

const PERIODS = {
  weekly: 7,
  monthly: 30,
  historical: 0,
}

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
  const category = String(ctx.params.category || 'all').trim() || 'all'
  const type = PERIODS[ctx.params.type] !== undefined ? ctx.params.type : 'weekly'
  const sort = PERIODS[type]

  const briefs = await ctx.fetch(`${API}/tag_api/v1/query_category_briefs`, { headers: { accept: 'application/json' } })

  if (!briefs.ok) {
    throw new Error(`掘金返回 ${briefs.status}（分类列表）`)
  }

  const categories = (await briefs.json()).data

  if (!Array.isArray(categories)) {
    throw new Error('掘金没有返回分类列表，接口可能已经变了')
  }

  const match = categories.find((item) => item.category_url === category)

  const body = { cursor: '0', id_type: 2, limit: 20, sort_type: sort }
  const url = match
    ? `${API}/recommend_api/v1/article/recommend_cate_feed`
    : `${API}/recommend_api/v1/article/recommend_all_feed`

  if (match) body.cate_id = match.category_id

  const data = await post(ctx, url, body)

  if (!Array.isArray(data)) {
    throw new Error('掘金没有返回文章数组，接口可能已经变了')
  }

  // The whole-site feed interleaves article cards with other item kinds; the
  // category feed does not wrap its articles at all.
  const list = data[0]?.item_type === undefined ? data : data.filter((item) => item.item_type === 2).map((item) => item.item_info)

  const entries = list.map(entryOf).filter(Boolean)

  ctx.log.info(`juejin-trending: ${entries.length} 条（${match?.category_name || '全部'}，${type}）`)

  return { entries }
}

export async function preview(ctx) {
  const content = await ctx.article(ctx.item.url)
  return content ? { content } : null
}
