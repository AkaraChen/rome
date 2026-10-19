// Ported from RSSHub lib/routes/sina/chuangshiji.ts (AGPL-3.0).
// 新浪专栏创事记 — one fixed partition of the roll news API, so the route
// takes no parameters at all.

export const meta = {
  id: 'rome.rsshub-sina-chuangshiji',
  name: '新浪 · 专栏 - 创事记',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: '新浪专栏创事记的最新文章',
  icon: 'https://www.sina.com.cn/favicon.ico',
}

const PAGE_ID = '402'
const LID = '2559'
const LIMIT = 50

function https(url) {
  return String(url ?? '').replace(/^http:\/\//, 'https://')
}

export async function fetch(ctx) {
  const url = `https://feed.mix.sina.com.cn/api/roll/get?pageid=${PAGE_ID}&lid=${LID}&k=&num=${LIMIT}&page=1&r=${Math.random()}&_=${Date.now()}`

  ctx.log.debug(`sina-chuangshiji: GET ${url}`)

  const response = await ctx.fetch(url, {
    headers: { accept: 'application/json', referer: 'https://news.sina.com.cn/' },
  })

  if (!response.ok) {
    throw new Error(`新浪返回 ${response.status} ${response.statusText}`)
  }

  const body = await response.json()
  const list = body?.result?.data

  if (!Array.isArray(list)) {
    throw new Error('新浪滚动新闻接口没有返回数据，接口可能已经变了')
  }

  const entries = list.map((item) => {
    const entry = {
      id: `sina:${item.oid || item.docid || item.url}`,
      title: item.title,
      url: https(item.url),
      summary: item.intro,
    }

    if (item.media_name) entry.author = item.media_name

    const publishedAt = Number(item.intime)
    if (Number.isFinite(publishedAt)) entry.publishedAt = Math.floor(publishedAt)

    return entry
  }).filter((entry) => entry.title && entry.url)

  if (entries.length === 0) {
    throw new Error('新浪滚动新闻接口没有返回可解析的条目，接口可能已经变了')
  }

  ctx.log.info(`sina-chuangshiji: ${entries.length} 条`)

  return { entries, icon: 'https://www.sina.com.cn/favicon.ico' }
}

export async function preview(ctx) {
  const url = ctx.item?.url
  if (!url) return null

  const content = await ctx.article(url)
  return content === null ? null : { content }
}
