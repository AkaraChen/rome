// Ported from OpenCLI clis/sinafinance/rolling-news.js (Apache-2.0).
// 新浪财经滚动新闻 — OpenCLI 的 `sinafinance rolling-news`.
//
// 滚动页自己也是调用这个公开 JSON 接口，直接请求可以省掉浏览器。
// 移植自 clis/sinafinance/rolling-news.js。

export const meta = {
  id: 'rome.opencli-sinafinance-rolling-news',
  name: '新浪财经 · 滚动新闻',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: '新浪财经滚动新闻，按发布时间倒序。',
  icon: 'https://finance.sina.com.cn/favicon.ico',
}

const ROLL_API = 'https://feed.mix.sina.com.cn/api/roll/get'

export async function fetch(ctx) {
  const params = new URLSearchParams({
    pageid: '384',
    lid: '2519',
    k: '',
    num: '50',
    page: '1',
  })

  const url = `${ROLL_API}?${params}`

  ctx.log.debug(`opencli-sinafinance-rolling-news: GET ${url}`)

  const response = await ctx.fetch(url, { headers: { accept: 'application/json' } })

  if (!response.ok) {
    throw new Error(`新浪财经滚动新闻接口返回 HTTP ${response.status}`)
  }

  const payload = await response.json()

  if (payload?.result?.status?.code !== 0) {
    throw new Error(`新浪财经滚动新闻接口失败：${payload?.result?.status?.msg || '未知状态'}`)
  }

  const items = payload?.result?.data

  if (!Array.isArray(items)) {
    throw new Error('新浪财经滚动新闻接口返回了意料之外的数据')
  }

  if (items.length === 0) {
    throw new Error('新浪财经滚动新闻没有返回条目')
  }

  const entries = []

  for (const item of items) {
    const title = typeof item?.title === 'string' ? item.title.trim() : ''
    const address = typeof item?.url === 'string' ? item.url.trim() : ''

    if (!title || !address) continue

    // docid（形如 comos:xxxx）是文章的永久标识；oid 和 url 作为退路。
    const key = item.docid || item.oid || address

    const entry = {
      id: `sina:${key}`,
      title,
      url: address,
    }

    const seconds = Number(item.ctime)
    if (Number.isFinite(seconds) && seconds > 0) entry.publishedAt = seconds

    const summary = [item.media_name, item.intro]
      .filter((part) => typeof part === 'string' && part.trim())
      .join(' · ')
      .slice(0, 180)

    if (summary) entry.summary = summary

    const image = item.images?.[0]?.u || item.img?.[0]?.u
    if (image) entry.image = image

    entries.push(entry)
  }

  if (entries.length === 0) {
    throw new Error('新浪财经滚动新闻返回的条目都缺少标题或链接')
  }

  ctx.log.info(`opencli-sinafinance-rolling-news: ${entries.length} 条`)

  return { entries }
}

export async function preview(ctx) {
  const url = ctx.item?.url

  if (!url) return null

  const content = await ctx.article(url)
  return content === null ? null : { content }
}
