// Ported from OpenCLI clis/coingecko/trending.js (Apache-2.0).
// CoinGecko 热搜币 — OpenCLI 的 `coingecko trending`.
//
// 搜索热度榜，一次公开请求，无参数、无 key、无浏览器。
// 移植自 clis/coingecko/trending.js。

export const meta = {
  id: 'rome.opencli-coingecko-trending',
  name: 'CoinGecko · 热搜币',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: '过去 24 小时搜索热度最高的加密货币。',
  icon: 'https://www.coingecko.com/favicon.ico',
}

const TRENDING = 'https://api.coingecko.com/api/v3/search/trending'

function priceBtc(value) {
  if (value == null || value === '') return null
  const number = Number(value)
  if (!Number.isFinite(number)) return null
  return number.toPrecision(6)
}

export async function fetch(ctx) {
  ctx.log.debug(`opencli-coingecko-trending: GET ${TRENDING}`)

  const response = await ctx.fetch(TRENDING, {
    headers: { 'user-agent': 'Mozilla/5.0', accept: 'application/json' },
  })

  if (response.status === 429) {
    throw new Error('CoinGecko 触发了限流（HTTP 429），请稍后重试')
  }

  if (!response.ok) {
    throw new Error(`CoinGecko 返回 HTTP ${response.status}`)
  }

  const data = await response.json()
  const coins = Array.isArray(data?.coins) ? data.coins : []

  if (coins.length === 0) {
    throw new Error('CoinGecko 没有返回热搜币种')
  }

  const entries = []

  for (const [index, row] of coins.entries()) {
    const coin = row?.item ?? {}

    // 热搜列表没有独立条目 id，币种 slug 才是站点自己的稳定标识。
    if (!coin.id) continue

    const symbol = String(coin.symbol ?? '').toUpperCase()
    const parts = [`热搜 #${index + 1}`]

    if (coin.market_cap_rank != null) parts.push(`市值排名 #${coin.market_cap_rank}`)

    const btc = priceBtc(coin.price_btc)
    if (btc) parts.push(`${btc} BTC`)

    const entry = {
      id: `cg:${coin.id}`,
      title: symbol ? `${coin.name} (${symbol})` : String(coin.name ?? coin.id),
      url: `https://www.coingecko.com/en/coins/${coin.id}`,
      summary: parts.join(' · '),
    }

    const image = coin.thumb || coin.small || coin.large
    if (image) entry.image = image

    entries.push(entry)
  }

  if (entries.length === 0) {
    throw new Error('CoinGecko 返回的热搜记录都缺少币种 id')
  }

  ctx.log.info(`opencli-coingecko-trending: ${entries.length} 条`)

  return { entries }
}
