// Ported from OpenCLI clis/coingecko/top.js (Apache-2.0).
// CoinGecko 市值榜 — OpenCLI 的 `coingecko top`.
//
// 公开行情接口按市值从高到低返回一页，不需要 key，也不需要浏览器。
// 移植自 clis/coingecko/top.js。

export const meta = {
  id: 'rome.opencli-coingecko-top',
  name: 'CoinGecko · 市值榜',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: '按市值排序的加密货币行情，计价币种可选。',
  icon: 'https://www.coingecko.com/favicon.ico',
  params: {
    fields: [
      {
        key: 'currency',
        type: 'text',
        label: '计价币种',
        help: 'usd / cny / eur / jpy 等',
        default: 'usd',
      },
      {
        key: 'limit',
        type: 'number',
        label: '条数',
        help: '最多 250 条',
        default: 10,
        min: 1,
        max: 250,
      },
    ],
  },
}

const MARKETS = 'https://api.coingecko.com/api/v3/coins/markets'

function integer(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(Math.max(parsed, min), max)
}

// 价格保留有效位，市值和成交额用 K/M/B/T 缩写。
function price(value) {
  if (value == null || value === '') return '-'
  const number = Number(value)
  if (!Number.isFinite(number)) return '-'
  if (Math.abs(number) >= 1000) return number.toFixed(2)
  if (Math.abs(number) >= 1) return number.toFixed(4)
  return number.toPrecision(4)
}

function compact(value) {
  if (value == null || value === '') return '-'
  const number = Number(value)
  if (!Number.isFinite(number)) return '-'
  const abs = Math.abs(number)
  if (abs >= 1e12) return `${(number / 1e12).toFixed(2)}T`
  if (abs >= 1e9) return `${(number / 1e9).toFixed(2)}B`
  if (abs >= 1e6) return `${(number / 1e6).toFixed(2)}M`
  if (abs >= 1e3) return `${(number / 1e3).toFixed(2)}K`
  if (abs >= 1) return number.toFixed(2)
  return number.toPrecision(4)
}

export async function fetch(ctx) {
  const currency = String(ctx.params?.currency ?? 'usd').trim().toLowerCase() || 'usd'
  const limit = integer(ctx.params?.limit, 10, 1, 250)

  const url = new URL(MARKETS)
  url.searchParams.set('vs_currency', currency)
  url.searchParams.set('order', 'market_cap_desc')
  url.searchParams.set('per_page', String(limit))
  url.searchParams.set('page', '1')
  url.searchParams.set('sparkline', 'false')

  ctx.log.debug(`opencli-coingecko-top: GET ${url.href}`)

  const response = await ctx.fetch(url, {
    headers: { 'user-agent': 'Mozilla/5.0', accept: 'application/json' },
  })

  if (!response.ok) {
    throw new Error(`CoinGecko 返回 HTTP ${response.status}，计价币种 ${currency} 可能不受支持`)
  }

  const data = await response.json()

  if (data?.error) {
    throw new Error(`CoinGecko 返回错误：${data.error}`)
  }

  if (!Array.isArray(data)) {
    throw new Error('CoinGecko 返回了意料之外的响应，接口可能已经变了')
  }

  if (data.length === 0) {
    throw new Error('CoinGecko 没有返回行情数据')
  }

  const entries = []

  for (const [index, coin] of data.slice(0, limit).entries()) {
    if (!coin?.id) continue

    const symbol = String(coin.symbol ?? '').toUpperCase()
    const rank = coin.market_cap_rank ?? index + 1
    const rawChange = coin.price_change_percentage_24h
    const change = rawChange == null ? Number.NaN : Number(rawChange)
    const parts = [
      `#${rank}`,
      `价格 ${price(coin.current_price)} ${currency.toUpperCase()}`,
      Number.isFinite(change) ? `24h ${change.toFixed(2)}%` : null,
      `市值 ${compact(coin.market_cap)}`,
      `成交额 ${compact(coin.total_volume)}`,
    ].filter(Boolean)

    const entry = {
      // CoinGecko 的币种 id 是稳定 slug，改名不会变。
      id: `cg:${coin.id}`,
      title: symbol ? `${coin.name} (${symbol})` : String(coin.name ?? coin.id),
      url: `https://www.coingecko.com/en/coins/${coin.id}`,
      summary: parts.join(' · '),
    }

    if (coin.image) entry.image = coin.image

    entries.push(entry)
  }

  if (entries.length === 0) {
    throw new Error('CoinGecko 返回的行情记录都缺少币种 id')
  }

  ctx.log.info(`opencli-coingecko-top: ${entries.length} 条（${currency}）`)

  return { entries }
}
