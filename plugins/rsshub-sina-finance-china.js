// Ported from RSSHub lib/routes/sina/finance/china.ts (AGPL-3.0).
// 新浪财经国内 — the same roll news API with the finance page id and its own
// partition ids.

export const meta = {
  id: 'rome.rsshub-sina-finance-china',
  name: '新浪 · 财经－国內',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: '新浪财经国内各分区的最新文章',
  icon: 'https://www.sina.com.cn/favicon.ico',
  params: {
    fields: [
      {
        key: 'lid',
        type: 'select',
        label: '分区',
        help: '选择要订阅的财经国内分区，默认为国内滚动',
        default: '1686',
        options: [
          { value: '1686', label: '国内滚动' },
          { value: '1687', label: '宏观经济' },
          { value: '1690', label: '金融新闻' },
          { value: '1688', label: '地方经济' },
          { value: '1689', label: '部委动态' },
          { value: '3231', label: '今日财经 TOP10' },
        ],
      },
    ],
  },
}

const PAGE_ID = '155'
const LIMIT = 50

function https(url) {
  return String(url ?? '').replace(/^http:\/\//, 'https://')
}

export async function fetch(ctx) {
  const lid = String(ctx.params.lid ?? '').trim() || '1686'
  const url = `https://feed.mix.sina.com.cn/api/roll/get?pageid=${PAGE_ID}&lid=${encodeURIComponent(lid)}&k=&num=${LIMIT}&page=1&r=${Math.random()}&_=${Date.now()}`

  ctx.log.debug(`sina-finance-china: GET ${url}`)

  const response = await ctx.fetch(url, {
    headers: { accept: 'application/json', referer: 'https://finance.sina.com.cn/' },
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

  ctx.log.info(`sina-finance-china: ${lid} ${entries.length} 条`)

  return { entries, icon: 'https://www.sina.com.cn/favicon.ico' }
}

export async function preview(ctx) {
  const url = ctx.item?.url
  if (!url) return null

  const content = await ctx.article(url)
  return content === null ? null : { content }
}
