// Ported from RSSHub lib/routes/polymarket/series.ts (AGPL-3.0).
// Polymarket — series, or one series' events.
//
// With a slug the route lists that series' events; without one it lists the
// series themselves, ordered by volume. Both come from the public gamma API.

export const meta = {
  id: 'rome.rsshub-polymarket-series',
  name: 'Polymarket · Series',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: 'Polymarket 系列及其包含的事件',
  icon: 'https://polymarket.com/favicon.ico',
  params: {
    fields: [
      {
        key: 'slug',
        type: 'text',
        label: '系列 slug',
        help: '例如 nfl、nba、mlb，留空则列出全部系列',
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

export async function fetch(ctx) {
  const slug = String(ctx.params.slug || '').trim()

  if (slug) {
    const query = new URLSearchParams({ slug, limit: '1' })
    const response = await ctx.fetch(`${GAMMA}/series?${query}`, { headers: { accept: 'application/json' } })

    if (!response.ok) {
      throw new Error(`Polymarket 返回 ${response.status} ${response.statusText}`)
    }

    const list = await response.json()
    if (!Array.isArray(list) || list.length === 0) {
      throw new Error(`找不到系列 ${slug}`)
    }

    const series = list[0]
    const events = Array.isArray(series.events) ? series.events : []

    const entries = []

    for (const event of events) {
      if (!event?.slug) continue

      const entry = {
        id: `polymarket:series-event:${event.id || event.slug}`,
        title: String(event.title || '').trim(),
        url: `https://polymarket.com/event/${event.slug}`,
        summary: `交易量：$${Number(event.volume || 0).toLocaleString()}`,
      }

      if (event.image) entry.image = event.image

      const publishedAt = seconds(event.startDate)
      if (publishedAt !== undefined) entry.publishedAt = publishedAt

      entries.push(entry)
    }

    if (entries.length === 0) {
      throw new Error(`系列 ${slug} 没有事件`)
    }

    return { entries }
  }

  const query = new URLSearchParams({ limit: '20', order: 'volume', ascending: 'false' })
  const response = await ctx.fetch(`${GAMMA}/series?${query}`, { headers: { accept: 'application/json' } })

  if (!response.ok) {
    throw new Error(`Polymarket 返回 ${response.status} ${response.statusText}`)
  }

  const list = await response.json()
  if (!Array.isArray(list)) {
    throw new Error('Polymarket 系列接口结构已变化')
  }

  const entries = []

  for (const series of list) {
    if (!series?.slug) continue

    const parts = []
    if (series.description) parts.push(`<p>${escape(series.description)}</p>`)
    parts.push(`<p>交易量：$${Number(series.volume || 0).toLocaleString()}</p>`)
    parts.push(`<p>流动性：$${Number(series.liquidity || 0).toLocaleString()}</p>`)
    if (series.image) parts.push(`<img src="${escape(series.image)}" alt="${escape(series.title || '')}">`)

    const entry = {
      id: `polymarket:series:${series.id || series.slug}`,
      title: String(series.title || '').trim(),
      url: `https://polymarket.com/series/${series.slug}`,
      content: parts.join(''),
    }

    if (series.image) entry.image = series.image

    const publishedAt = seconds(series.createdAt)
    if (publishedAt !== undefined) entry.publishedAt = publishedAt

    entries.push(entry)
  }

  if (entries.length === 0) {
    throw new Error('Polymarket 系列接口没有返回条目')
  }

  return { entries }
}
