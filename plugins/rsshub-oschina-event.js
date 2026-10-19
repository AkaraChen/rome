// Ported from RSSHub lib/routes/oschina/event.ts (AGPL-3.0).
// OSCHINA — the event board.
//
// The listing is fetched with a POST carrying the tab, and answers with HTML.
// Each card opens its detail page through an inline `window.open`, which is
// where the link is read from. The dates on the cards are the dates of the
// events themselves, not of their publication, so they are shown as text and
// not used as a publish time.

export const meta = {
  id: 'rome.rsshub-oschina-event',
  name: '开源中国 · 活动',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: '开源中国线下活动',
  icon: 'https://www.oschina.net/favicon.ico',
  params: {
    fields: [
      {
        key: 'category',
        type: 'text',
        label: '分类',
        help: '活动分类，例如 latest 表示最新活动、recommend 表示强力推荐',
        default: 'latest',
      },
    ],
  },
}

const ROOT = 'https://www.oschina.net'
const API = 'https://apiv1.oschina.net'

function decode(text) {
  const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }
  return String(text).replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity) => {
    if (entity[0] === '#') {
      const code = entity[1] === 'x' || entity[1] === 'X'
        ? Number.parseInt(entity.slice(2), 16)
        : Number.parseInt(entity.slice(1), 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : match
    }
    return Object.prototype.hasOwnProperty.call(entities, entity) ? entities[entity] : match
  })
}

function strip(html) {
  return decode(String(html).replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim()
}

export async function fetch(ctx) {
  const category = String(ctx.params.category || 'latest').trim() || 'latest'

  const response = await ctx.fetch(`${ROOT}/action/ajax/get_more_event_list`, {
    method: 'POST',
    headers: {
      accept: 'text/html',
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: `tab=${encodeURIComponent(category)}`,
  })

  if (!response.ok) {
    throw new Error(`开源中国返回 ${response.status} ${response.statusText}`)
  }

  const html = await response.text()
  const entries = []
  const seen = new Set()

  for (const part of html.split('<div class="lee-item event-item"').slice(1)) {
    const opened = /window\.open\(\s*'([^']+)'/.exec(part)
    const href = opened ? opened[1] : /<a[^>]*class="summary"[^>]*href="([^"]+)"/.exec(part)?.[1]
    if (!href) continue

    const url = href.startsWith('http') ? href : `${ROOT}${href}`
    const eventId = /\/event\/(\d+)/.exec(url)
    if (!eventId || seen.has(eventId[1])) continue
    seen.add(eventId[1])

    const title = /<a[^>]*class="summary"[^>]*>([\s\S]*?)<\/a>/.exec(part)
    if (!title) continue

    const entry = {
      id: `oschina:event:${eventId[1]}`,
      title: strip(title[1]),
      url,
      params: { eventId: eventId[1] },
    }

    const image = /<img[^>]*data-delay="([^"]+)"/.exec(part)
    if (image) entry.image = image[1]

    // The first label is the event date, the second the city.
    const labels = [...part.matchAll(/<label[^>]*>([\s\S]*?)<\/label>/g)].map((match) => strip(match[1]))
    const when = labels[0] || ''
    const where = labels[1] || ''
    if (when || where) entry.summary = [when, where].filter(Boolean).join(' · ')

    entries.push(entry)
  }

  if (entries.length === 0) {
    throw new Error('开源中国活动页面结构已变化，未找到活动')
  }

  return { entries }
}

export async function preview(ctx) {
  const eventId = ctx.item?.params?.eventId
  if (!eventId) return null

  const response = await ctx.fetch(`${API}/oschinapi/event/id?id=${encodeURIComponent(eventId)}`, {
    headers: { accept: 'application/json' },
  })

  if (!response.ok) {
    throw new Error(`开源中国返回 ${response.status} ${response.statusText}`)
  }

  const payload = await response.json()
  if (payload?.code !== 200 || !payload?.result?.description) return null

  return { content: payload.result.description }
}
