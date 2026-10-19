// Ported from OpenCLI clis/binance/top.js (Apache-2.0).
// Binance 成交榜 — OpenCLI 的 `binance top`.
//
// 一次取回全部 24 小时行情，按计价成交额从高到低排序，再截断。
// 移植自 clis/binance/top.js 的 pipeline。

export const meta = {
  id: 'rome.opencli-binance-top',
  name: 'Binance · 成交榜',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: '按 24 小时成交额排序的 Binance 现货交易对。',
  icon: 'https://www.binance.com/favicon.ico',
  params: {
    fields: [
      {
        key: 'limit',
        type: 'number',
        label: '条数',
        help: '返回多少个交易对',
        default: 20,
        min: 1,
        max: 100,
      },
    ],
  },
}

const TICKERS = 'https://data-api.binance.vision/api/v3/ticker/24hr'

// 交易对没有分隔符，构造网页地址时得知道哪一段是计价币。
// 按长度从长到短排列，避免 USDTIDRT 被更短的 IDRT 之外的规则误判。
const QUOTES = [
  'FDUSD', 'USDT', 'USDC', 'TUSD', 'BUSD', 'USDP', 'AEUR', 'IDRT', 'BIDR',
  'VAI', 'DAI', 'BTC', 'ETH', 'BNB', 'EUR', 'TRY', 'BRL', 'GBP', 'AUD',
  'JPY', 'ZAR', 'RUB', 'UAH', 'NGN', 'ARS', 'COP', 'CZK', 'MXN', 'PLN',
  'RON', 'SEK', 'HUF', 'PEN', 'IDR',
]

function integer(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(Math.max(parsed, min), max)
}

function tradeUrl(symbol) {
  for (const quote of QUOTES) {
    if (symbol.length > quote.length && symbol.endsWith(quote)) {
      return `https://www.binance.com/en/trade/${symbol.slice(0, -quote.length)}_${quote}`
    }
  }

  return `https://www.binance.com/en/trade/${symbol}`
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

function percent(value) {
  if (value == null || value === '') return '-'
  const number = Number(value)
  return Number.isFinite(number) ? `${number.toFixed(2)}%` : '-'
}

export async function fetch(ctx) {
  const limit = integer(ctx.params?.limit, 20, 1, 100)

  ctx.log.debug(`opencli-binance-top: GET ${TICKERS}`)

  const response = await ctx.fetch(TICKERS, {
    headers: { accept: 'application/json' },
  })

  if (!response.ok) {
    throw new Error(`Binance 返回 HTTP ${response.status}`)
  }

  const tickers = await response.json()

  if (!Array.isArray(tickers)) {
    throw new Error('Binance 没有返回交易对数组，接口可能已经变了')
  }

  if (tickers.length === 0) {
    throw new Error('Binance 没有返回任何交易对')
  }

  const sorted = tickers
    .filter((ticker) => ticker?.symbol)
    .sort((left, right) => Number(right.quoteVolume) - Number(left.quoteVolume))
    .slice(0, limit)

  const entries = sorted.map((ticker, index) => ({
    // 交易对符号在 Binance 上永久不变。
    id: `bn:${ticker.symbol}`,
    title: ticker.symbol,
    url: tradeUrl(ticker.symbol),
    summary: [
      `#${index + 1}`,
      `价格 ${ticker.lastPrice}`,
      `24h ${percent(ticker.priceChangePercent)}`,
      `高 ${ticker.highPrice} / 低 ${ticker.lowPrice}`,
      `成交额 ${compact(ticker.quoteVolume)}`,
    ].join(' · '),
  }))

  if (entries.length === 0) {
    throw new Error('Binance 返回的交易对都缺少符号')
  }

  ctx.log.info(`opencli-binance-top: ${entries.length} 条`)

  return { entries }
}
