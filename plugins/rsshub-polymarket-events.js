// Ported from RSSHub lib/routes/polymarket/events.ts (AGPL-3.0).
// Polymarket — the busiest open events.
//
// The gamma API is public and paginated; only the first page is read, ordered
// by volume, which is what the upstream route does. The tag slug is optional
// and filters the list to one topic.

export const meta = {
  id: 'rome.rsshub-polymarket-events',
  name: 'Polymarket · Events',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: 'Polymarket 按交易量排序的热门事件',
  icon: 'https://polymarket.com/favicon.ico',
  params: {
    fields: [
      {
        key: 'tagSlug',
        type: 'text',
        label: '标签',
        help: '标签 slug，例如 politics、sports、crypto，留空则不限',
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

function description(event) {
  const parts = []
  if (event.description) parts.push(`<p>${escape(event.description)}</p>`)
  parts.push(`<p>交易量：$${Number(event.volume || 0).toLocaleString()}</p>`)

  const markets = Array.isArray(event.markets) ? event.markets.slice(0, 3) : []
  if (markets.length > 0) {
    const rows = markets
      .map((market) => `<li><strong>${escape(market.question || '')}</strong><br>${escape(odds(market))}</li>`)
      .join('')
    parts.push(`<h4>市场：</h4><ul>${rows}</ul>`)
  }

  if (event.image) parts.push(`<img src="${escape(event.image)}" alt="${escape(event.title || '')}">`)
  return parts.join('')
}

export async function fetch(ctx) {
  const tagSlug = String(ctx.params.tagSlug || '').trim()

  const query = new URLSearchParams({
    active: 'true',
    closed: 'false',
    limit: '30',
    order: 'volume',
    ascending: 'false',
  })
  if (tagSlug) query.set('tag_slug', tagSlug)

  const response = await ctx.fetch(`${GAMMA}/events/pagination?${query}`, {
    headers: { accept: 'application/json' },
  })

  if (!response.ok) {
    throw new Error(`Polymarket 返回 ${response.status} ${response.statusText}`)
  }

  const payload = await response.json()
  const list = payload?.data

  if (!Array.isArray(list)) {
    throw new Error('Polymarket 事件接口结构已变化')
  }

  const entries = []

  for (const event of list) {
    if (!event?.slug) continue

    const entry = {
      id: `polymarket:event:${event.id || event.slug}`,
      title: String(event.title || '').trim(),
      url: `https://polymarket.com/event/${event.slug}`,
      content: description(event),
    }

    if (event.image) entry.image = event.image

    const publishedAt = seconds(event.startDate)
    if (publishedAt !== undefined) entry.publishedAt = publishedAt

    entries.push(entry)
  }

  if (entries.length === 0) {
    throw new Error('Polymarket 事件接口没有返回条目')
  }

  return { entries }
}
