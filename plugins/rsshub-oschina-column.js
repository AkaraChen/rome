// Ported from RSSHub lib/routes/oschina/column.ts (AGPL-3.0).
// OSCHINA — a news column.
//
// The column page is server-rendered HTML. Every card is a `div.item.news-item`
// carrying its own `data-url`; the trailing comment-count div repeats that URL
// with a `#comments` fragment, so the first match inside a card is the one
// wanted. The body is read from the news API in preview, not here.

export const meta = {
  id: 'rome.rsshub-oschina-column',
  name: '开源中国 · 专栏',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: '开源中国指定专栏的文章',
  icon: 'https://www.oschina.net/favicon.ico',
  params: {
    fields: [
      {
        key: 'id',
        type: 'text',
        label: '专栏 id',
        help: '可在专栏页网址 columnId 后找到，例如 14 表示开源安全专栏',
        default: '',
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

// `2025/12/05 11:51` is Asia/Shanghai wall-clock time.
function shanghaiSeconds(text) {
  const match = /^(\d{4})\/(\d{2})\/(\d{2})\s+(\d{2}):(\d{2})/.exec(String(text).trim())
  if (!match) return undefined
  return Math.floor(Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]) - 8,
    Number(match[5]),
  ) / 1000)
}

export async function fetch(ctx) {
  const id = String(ctx.params.id || '').trim()

  if (!id) {
    throw new Error('请填写专栏 id，例如 14 表示开源安全专栏')
  }

  const url = `${ROOT}/news/column?columnId=${encodeURIComponent(id)}`
  const response = await ctx.fetch(url, { headers: { accept: 'text/html' } })

  if (!response.ok) {
    throw new Error(`开源中国返回 ${response.status} ${response.statusText}`)
  }

  const html = await response.text()
  const entries = []
  const seen = new Set()

  for (const part of html.split('<div class="item news-item').slice(1)) {
    const link = /data-url="([^"]+)"/.exec(part)
    if (!link) continue

    const articleUrl = link[1]
    const newsId = /\/news\/(\d+)/.exec(articleUrl)
    if (!newsId || seen.has(newsId[1])) continue
    seen.add(newsId[1])

    const title = /<div class="title"[^>]*>([\s\S]*?)<\/div>/.exec(part)
    if (!title) continue

    const entry = {
      id: `oschina:news:${newsId[1]}`,
      title: strip(title[1]),
      url: articleUrl,
      params: { newsId: newsId[1] },
    }

    const summary = /<p class="line-clamp">([\s\S]*?)<\/p>/.exec(part)
    if (summary) entry.summary = strip(summary[1])

    const author = /<a href="https:\/\/my\.oschina\.net\/u\/\d+"[^>]*>([\s\S]*?)<\/a>/.exec(part)
    if (author) entry.author = strip(author[1])

    const date = /(\d{4}\/\d{2}\/\d{2}\s+\d{2}:\d{2})/.exec(part)
    if (date) {
      const publishedAt = shanghaiSeconds(date[1])
      if (publishedAt !== undefined) entry.publishedAt = publishedAt
    }

    entries.push(entry)
  }

  if (entries.length === 0) {
    throw new Error('开源中国专栏页面结构已变化，未找到文章')
  }

  return { entries }
}

export async function preview(ctx) {
  const newsId = ctx.item?.params?.newsId
  if (!newsId) return null

  const response = await ctx.fetch(`${API}/oschinapi/new/detail?id=${encodeURIComponent(newsId)}`, {
    headers: { accept: 'application/json' },
  })

  if (!response.ok) {
    throw new Error(`开源中国返回 ${response.status} ${response.statusText}`)
  }

  const payload = await response.json()
  if (payload?.code !== 200 || !payload?.result?.detail) return null

  return { content: payload.result.detail }
}
