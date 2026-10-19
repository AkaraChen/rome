// Ported from RSSHub lib/routes/xueqiu/fund.ts (AGPL-3.0).
// 雪球蛋卷基金净值 — one JSON request per fund.
//
// The public endpoint returns the fund's current net value and its daily
// change, which is the only thing that moves. The entry id includes the
// valuation date, so a new value is a new entry rather than a silent edit of
// yesterday's.
//
// `danjuanapp.com` now redirects to `danjuanfunds.com`; ctx.fetch follows it,
// so the route keeps the address the site publishes.

export const meta = {
  id: 'rome.rsshub-xueqiu-fund',
  name: '雪球 · 基金净值',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: '雪球蛋卷基金每个交易日的净值与涨跌幅',
  icon: 'https://danjuanapp.com/favicon.ico',
  params: {
    fields: [
      {
        key: 'id',
        type: 'text',
        label: '基金代码',
        help: '在基金主页 URL 中找到，例如 040008',
        default: '',
      },
    ],
  },
}

function escape(text) {
  return String(text ?? '').replace(/[&<>"]/g, (ch) => {
    if (ch === '&') return '&amp;'
    if (ch === '<') return '&lt;'
    if (ch === '>') return '&gt;'
    return '&quot;'
  })
}

/// The change is a decimal string in the API. Treating it as a number is what
/// decides the arrow, but the string itself is what the site prints.
function direction(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return { arrow: '', word: '' }
  if (number > 0) return { arrow: '📈', word: '日涨跌' }
  if (number < 0) return { arrow: '📉', word: '日跌跌' }
  return { arrow: '', word: '无波动' }
}

/// `end_date` is a valuation date with no time. The fund publishes it on
/// China Standard Time, so midnight there is the honest instant.
function valuationTime(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? ''))
  if (!match) return undefined

  const milliseconds = Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    0, 0, 0,
  ) - 8 * 60 * 60 * 1000

  return Number.isFinite(milliseconds) ? Math.floor(milliseconds / 1000) : undefined
}

export async function fetch(ctx) {
  const id = String(ctx.params.id ?? '').trim()

  if (!id) {
    throw new Error('缺少基金代码：请在基金主页 URL 中找到它，例如 040008')
  }

  const url = `https://danjuanapp.com/djapi/fund/${encodeURIComponent(id)}`
  ctx.log.debug(`xueqiu-fund: GET ${url}`)

  const response = await ctx.fetch(url, {
    headers: { accept: 'application/json', referer: `https://danjuanapp.com/funding/${id}` },
  })

  if (!response.ok) {
    throw new Error(`蛋卷基金返回 ${response.status} ${response.statusText}`)
  }

  const body = await response.json()
  const fund = body?.data
  const derived = fund?.fund_derived

  if (!fund || !derived) {
    throw new Error('蛋卷基金没有返回基金数据，接口可能已经变了')
  }

  const code = fund.fd_code || id
  const name = fund.fd_full_name || fund.fd_name || code
  const change = derived.nav_grtd
  const { arrow, word } = direction(change)

  const title = arrow ? `${name} ${arrow} ${change}%` : `${name} 持平`

  const facts = [
    `基金代码：${escape(code)}`,
    `今日净值（${escape(derived.end_date)}）：¥${escape(derived.unit_nav)}`,
  ]

  if (word && arrow) facts.push(`日涨跌：${escape(change)}%`)
  if (word === '无波动') facts.push('当日无波动')

  const entry = {
    // A net value belongs to a valuation date, so the pair is the permanent id.
    id: `xueqiu:fund:${code}:${derived.end_date || id}`,
    title,
    url: `https://danjuanapp.com/funding/${encodeURIComponent(id)}`,
    summary: `净值 ${derived.unit_nav}（${derived.end_date}）`,
    content: `<ul>${facts.map((fact) => `<li>${fact}</li>`).join('')}</ul>`,
  }

  const publishedAt = valuationTime(derived.end_date)
  if (publishedAt !== undefined) entry.publishedAt = publishedAt

  ctx.log.info(`xueqiu-fund: ${code} ${derived.unit_nav}`)

  return { entries: [entry] }
}
