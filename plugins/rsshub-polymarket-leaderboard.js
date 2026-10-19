// Ported from RSSHub lib/routes/polymarket/leaderboard.ts (AGPL-3.0).
// Polymarket — the trader leaderboard.
//
// The data API is public and answers a bare array ordered by profit and loss.
// Both parameters are fixed vocabularies, so they are selects rather than free
// text.

export const meta = {
  id: 'rome.rsshub-polymarket-leaderboard',
  name: 'Polymarket · Leaderboard',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: 'Polymarket 交易者收益排行榜',
  icon: 'https://polymarket.com/favicon.ico',
  params: {
    fields: [
      {
        key: 'category',
        type: 'select',
        label: '分类',
        help: '排行榜的市场分类',
        default: 'OVERALL',
        options: [
          { value: 'OVERALL', label: '综合' },
          { value: 'POLITICS', label: '政治' },
          { value: 'SPORTS', label: '体育' },
          { value: 'CRYPTO', label: '加密货币' },
          { value: 'CULTURE', label: '文化' },
          { value: 'MENTIONS', label: '提及' },
          { value: 'WEATHER', label: '天气' },
          { value: 'ECONOMICS', label: '经济' },
          { value: 'TECH', label: '科技' },
          { value: 'FINANCE', label: '金融' },
        ],
      },
      {
        key: 'timePeriod',
        type: 'select',
        label: '时间范围',
        help: '排行榜统计的时间跨度',
        default: 'DAY',
        options: [
          { value: 'DAY', label: '日榜' },
          { value: 'WEEK', label: '周榜' },
          { value: 'MONTH', label: '月榜' },
          { value: 'ALL', label: '总榜' },
        ],
      },
    ],
  },
}

const DATA = 'https://data-api.polymarket.com'

function escape(text) {
  const entities = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }
  return String(text).replace(/[&<>"]/g, (character) => entities[character])
}

export async function fetch(ctx) {
  const category = String(ctx.params.category || 'OVERALL').trim() || 'OVERALL'
  const timePeriod = String(ctx.params.timePeriod || 'DAY').trim() || 'DAY'

  const query = new URLSearchParams({
    category,
    timePeriod,
    orderBy: 'PNL',
    limit: '50',
  })

  const response = await ctx.fetch(`${DATA}/v1/leaderboard?${query}`, {
    headers: { accept: 'application/json' },
  })

  if (!response.ok) {
    throw new Error(`Polymarket 返回 ${response.status} ${response.statusText}`)
  }

  const list = await response.json()

  if (!Array.isArray(list)) {
    throw new Error('Polymarket 排行榜接口结构已变化')
  }

  const entries = list.map((entry) => {
    const name = entry.userName || entry.proxyWallet

    const parts = [`<p><strong>排名：</strong>#${escape(entry.rank)}</p>`]
    parts.push(`<p><strong>收益：</strong>$${Number(entry.pnl || 0).toLocaleString()}</p>`)
    parts.push(`<p><strong>交易量：</strong>$${Number(entry.vol || 0).toLocaleString()}</p>`)
    if (entry.xUsername) parts.push(`<p><strong>X：</strong>@${escape(entry.xUsername)}</p>`)
    if (entry.profileImage) parts.push(`<img src="${escape(entry.profileImage)}" alt="${escape(name)}">`)

    return {
      id: `polymarket:leaderboard:${category}:${timePeriod}:${entry.proxyWallet}`,
      title: `#${entry.rank} ${name}`,
      url: `https://polymarket.com/portfolio?address=${entry.proxyWallet}`,
      author: name,
      content: parts.join(''),
    }
  })

  if (entries.length === 0) {
    throw new Error('Polymarket 排行榜没有返回条目')
  }

  return { entries }
}
