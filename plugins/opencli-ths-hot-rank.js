// Ported from OpenCLI clis/ths/hot-rank.js (Apache-2.0).
// 同花顺热股榜 — OpenCLI 的 `ths hot-rank`.
//
// 同花顺热度接口是公开的，但会检查 Referer，所以请求头必须带上来源页。
// 移植自 clis/ths/hot-rank.js。

export const meta = {
  id: 'rome.opencli-ths-hot-rank',
  name: '同花顺 · 热股榜',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: '同花顺当前热度最高的 A 股股票。',
  icon: 'https://www.10jqka.com.cn/favicon.ico',
  params: {
    fields: [
      {
        key: 'limit',
        type: 'number',
        label: '条数',
        help: '最多 100 条',
        default: 20,
        min: 1,
        max: 100,
      },
    ],
  },
}

const HOT_API = 'https://dq.10jqka.com.cn/fuyao/hot_list_data/out/hot_list/v1/stock?stock_type=a&type=hour&list_type=normal'

function integer(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(Math.max(parsed, min), max)
}

function tagsFromStock(stock) {
  const tag = stock?.tag && typeof stock.tag === 'object' ? stock.tag : {}

  return [
    ...(Array.isArray(tag.concept_tag) ? tag.concept_tag : []),
    ...(Array.isArray(tag.popularity_tag) ? tag.popularity_tag : []),
  ].filter(Boolean).join(',')
}

function compact(value) {
  if (value == null || value === '') return String(value ?? '')
  const number = Number(value)
  if (!Number.isFinite(number)) return String(value ?? '')
  const abs = Math.abs(number)
  if (abs >= 1e8) return `${(number / 1e8).toFixed(2)}亿`
  if (abs >= 1e4) return `${(number / 1e4).toFixed(2)}万`
  return number.toFixed(0)
}

export async function fetch(ctx) {
  const limit = integer(ctx.params?.limit, 20, 1, 100)

  ctx.log.debug(`opencli-ths-hot-rank: GET ${HOT_API}`)

  const response = await ctx.fetch(HOT_API, {
    headers: {
      accept: 'application/json, text/plain, */*',
      'user-agent': 'Mozilla/5.0',
      referer: 'https://eq.10jqka.com.cn/',
    },
  })

  if (!response.ok) {
    throw new Error(`同花顺热股榜返回 HTTP ${response.status}`)
  }

  const payload = await response.json()
  const stocks = Array.isArray(payload?.data?.stock_list) ? payload.data.stock_list : []

  if (stocks.length === 0) {
    throw new Error('同花顺热股榜没有返回股票数据')
  }

  const entries = []

  for (const [index, stock] of stocks.slice(0, limit).entries()) {
    const code = String(stock?.code ?? '').trim()

    if (!code) continue

    const parts = [
      `#${stock.order ?? index + 1}`,
      `涨幅 ${stock.rise_and_fall ?? '-'}%`,
      `热度 ${compact(stock.rate)}`,
    ]

    const tags = tagsFromStock(stock)
    if (tags) parts.push(tags)

    entries.push({
      // 股票代码是交易所分配的，长期不变。
      id: `ths:${code}`,
      title: String(stock.name ?? code),
      url: `https://stockpage.10jqka.com.cn/${code}/`,
      summary: parts.join(' · '),
      params: { code },
    })
  }

  if (entries.length === 0) {
    throw new Error('同花顺热股榜返回的股票都缺少代码')
  }

  ctx.log.info(`opencli-ths-hot-rank: ${entries.length} 条`)

  return { entries }
}
