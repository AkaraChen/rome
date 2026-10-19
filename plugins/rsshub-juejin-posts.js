// Ported from RSSHub lib/routes/juejin/posts.ts (AGPL-3.0).
// 掘金专栏 — /juejin/posts/:id
//
// The site's article list endpoint, called with the numeric user id from a
// profile URL. It is a POST with a JSON body and no authentication.
//
// RSSHub then fetches every article body through a WAF challenge it solves by
// brute-forcing a hash prefix. This plugin does not: the listing already has
// the brief, and `preview` asks the reader's extractor for the page itself.

export const meta = {
  id: 'rome.rsshub-juejin-posts',
  name: '掘金 · 用户专栏',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: '掘金用户的专栏文章',
  icon: 'https://juejin.cn/favicon.ico',
  params: {
    fields: [
      {
        key: 'id',
        type: 'text',
        label: '用户 ID',
        help: '掘金用户主页 URL 中的数字 ID',
        placeholder: '3051900006845944',
        default: '',
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

/// One article as the feed endpoints present it. Both the list endpoint and
/// the recommend endpoints wrap an article in `article_info`; the recommend
/// feed sometimes adds a layer of `item_info` on top.
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
  const id = String(ctx.params.id || '').trim()

  if (!id) {
    throw new Error('请填写掘金用户 ID')
  }

  const data = await post(ctx, `${API}/content_api/v1/article/query_list`, {
    user_id: id,
    sort_type: 2,
  })

  if (!Array.isArray(data)) {
    throw new Error('掘金没有返回文章数组，接口可能已经变了')
  }

  const entries = data.map(entryOf).filter(Boolean)

  ctx.log.info(`juejin-posts: ${entries.length} 条（用户 ${id}）`)

  return { entries }
}

export async function preview(ctx) {
  const content = await ctx.article(ctx.item.url)
  return content ? { content } : null
}
