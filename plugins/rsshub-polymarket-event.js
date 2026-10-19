// Ported from RSSHub lib/routes/polymarket/event.ts (AGPL-3.0).
// Polymarket — one event, one entry per market.
//
// The gamma API answers a single event by slug. An event groups several binary
// markets, and each of those is what carries a price, so each becomes an entry
// pointing at the event page.

export const meta = {
  id: 'rome.rsshub-polymarket-event',
  name: 'Polymarket · Event',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: 'Polymarket 单个事件下的市场赔率',
  icon: 'https://polymarket.com/favicon.ico',
  params: {
    fields: [
      {
        key: 'slug',
        type: 'text',
        label: '事件 slug',
        help: '事件网址中的标识，例如 presidential-election-winner-2024',
        default: '',
      },
    ],
  },
}

const GAMMA = 'https://gamma-api.polymarket.com'

function escape(text) {
  const entities = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }
  return String(text).replace(/[&<>"]/g, (character) => entities[character])
}

function seconds(value) {
  const milliseconds = Date.parse(value)
  return Number.isFinite(milliseconds) ? Math.floor(milliseconds / 1000) : undefined
}

// outcomes and outcomePrices are JSON strings inside the JSON document.
function odds(market) {
  try {
    const outcomes = JSON.parse(market.outcomes || '[]')
    const prices = JSON.parse(market.outcomePrices || '[]')
    if (!Array.isArray(outcomes) || outcomes.length === 0) return ''
    return outcomes
      .map((outcome, index) => `${outcome}: ${(Number(prices[index]) * 100).toFixed(1)}%`)
      .join(' | ')
  } catch {
    return ''
  }
}

export async function fetch(ctx) {
  const slug = String(ctx.params.slug || '').trim()

  if (!slug) {
    throw new Error('请填写事件 slug，例如 presidential-election-winner-2024')
  }

  const response = await ctx.fetch(`${GAMMA}/events/slug/${encodeURIComponent(slug)}`, {
    headers: { accept: 'application/json' },
  })

  if (!response.ok) {
    throw new Error(`Polymarket 返回 ${response.status} ${response.statusText}`)
  }

  const event = await response.json()

  if (!event || !Array.isArray(event.markets)) {
    throw new Error(`找不到事件 ${slug}，或接口结构已变化`)
  }

  const page = `https://polymarket.com/event/${event.slug}`

  const entries = event.markets.map((market) => {
    const parts = []
    const prices = odds(market)
    if (prices) parts.push(`<p><strong>赔率：</strong>${escape(prices)}</p>`)
    parts.push(`<p><strong>交易量：</strong>$${Number(market.volume || 0).toLocaleString()}</p>`)
    if (market.oneDayPriceChange) {
      parts.push(`<p><strong>24 小时变化：</strong>${(market.oneDayPriceChange * 100).toFixed(1)}%</p>`)
    }
    if (market.image) {
      parts.push(`<img src="${escape(market.image)}" alt="${escape(market.question || '')}">`)
    }

    const entry = {
      id: `polymarket:market:${market.id}`,
      title: String(market.question || '').trim(),
      url: page,
      content: parts.join(''),
    }

    if (market.image) entry.image = market.image

    const publishedAt = seconds(market.startDate || event.startDate)
    if (publishedAt !== undefined) entry.publishedAt = publishedAt

    return entry
  })

  if (entries.length === 0) {
    throw new Error(`事件 ${slug} 没有市场`)
  }

  return { entries }
}
