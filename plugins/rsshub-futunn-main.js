// Ported from RSSHub lib/routes/futunn/main.ts (AGPL-3.0).
// 富途牛牛要闻 — news.futunn.com/main。
//
// 列表接口带标题、摘要和配图。详情页是 JS 渲染的（直接抓回来只有一段
// 反爬脚本），所以正文用摘要，不再对每篇发起第二次请求。

export const meta = {
  id: 'rome.rsshub-futunn-main',
  name: '富途牛牛 · 要闻',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: '富途牛牛的财经要闻',
  icon: 'https://news.futunn.com/favicon.ico',
}

const ROOT = 'https://news.futunn.com'
const LIMIT = 48

function escape(text) {
  return String(text ?? '').replace(/[&<>"]/g, (ch) => {
    if (ch === '&') return '&amp;'
    if (ch === '<') return '&lt;'
    if (ch === '>') return '&gt;'
    return '&quot;'
  })
}

function seconds(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : undefined
}

export async function fetch(ctx) {
  const url = `${ROOT}/news-site-api/main/get-market-list?size=${LIMIT}`

  ctx.log.debug(`futunn: GET ${url}`)

  const response = await ctx.fetch(url, { headers: { accept: 'application/json' } })

  if (!response.ok) {
    throw new Error(`富途牛牛要闻返回 ${response.status} ${response.statusText}`)
  }

  const body = await response.json()
  const list = body.data?.list

  if (!Array.isArray(list)) {
    throw new Error('富途牛牛要闻接口没有返回 list 数组，接口可能已经变了')
  }

  const entries = list.map((item) => {
    const entry = {
      // newsId 和专题里用的是同一个编号。
      id: `futunn:news:${item.newsId}`,
      title: item.title,
      // 链接后面挂着 futusource 等来源参数，去掉它才是文章地址。
      url: String(item.url ?? '').split('?')[0],
    }

    if (item.source) entry.author = item.source
    if (item.pic) entry.image = item.pic

    const abstract = item.abstract
    if (abstract) entry.content = `<p>${escape(abstract)}</p>`

    const publishedAt = seconds(item.timestamp)
    if (publishedAt !== undefined) entry.publishedAt = publishedAt

    return entry
  })

  if (entries.length === 0) {
    throw new Error('富途牛牛要闻没有返回任何内容')
  }

  return { entries, icon: `${ROOT}/favicon.ico` }
}
