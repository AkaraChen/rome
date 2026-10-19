// Ported from RSSHub lib/routes/juejin/tag.ts (AGPL-3.0).
// 掘金标签 — /juejin/tag/:tag
//
// Same two-step shape as the category route: the tag name is resolved to a
// numeric `tag_id` first, then the recommend feed is asked for it. A tag the
// site does not know comes back as a non-zero `err_no`, which is surfaced.

export const meta = {
  id: 'rome.rsshub-juejin-tag',
  name: '掘金 · 标签',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: '掘金指定标签的最新文章',
  icon: 'https://juejin.cn/favicon.ico',
  params: {
    fields: [
      {
        key: 'tag',
        type: 'text',
        label: '标签',
        help: '标签名称，可在标签页 URL 中找到，例如 JavaScript',
        placeholder: 'JavaScript',
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
  const tag = String(ctx.params.tag || '').trim()

  if (!tag) {
    throw new Error('请填写标签名称')
  }

  const detail = await post(ctx, `${API}/tag_api/v1/query_tag_detail`, { key_word: tag })
  const tagId = detail?.tag?.tag_id

  if (!tagId) {
    throw new Error(`掘金上找不到标签 ${tag}`)
  }

  const data = await post(ctx, `${API}/recommend_api/v1/article/recommend_tag_feed`, {
    id_type: 2,
    cursor: '0',
    tag_ids: [tagId],
    sort_type: 300,
  })

  if (!Array.isArray(data)) {
    throw new Error('掘金没有返回文章数组，接口可能已经变了')
  }

  const entries = data.map(entryOf).filter(Boolean)

  ctx.log.info(`juejin-tag: ${entries.length} 条（${tag}）`)

  return { entries }
}

export async function preview(ctx) {
  const content = await ctx.article(ctx.item.url)
  return content ? { content } : null
}
