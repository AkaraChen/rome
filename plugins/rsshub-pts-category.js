// Ported from RSSHub lib/routes/pts/category.ts (AGPL-3.0).
// 公視新聞網分類 — the same news list as the front page, filtered by category
// id. The category page renders its cards with data-story-url markers, so that
// shape is read first; the <li class="d-flex"> shape is the fallback.

export const meta = {
  id: 'rome.rsshub-pts-category',
  name: '公視新聞網 · 分類',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: '公視新聞網按分類 id 读取的新闻列表',
  icon: 'https://news.pts.org.tw/favicon.ico',
  params: {
    fields: [
      {
        key: 'id',
        type: 'text',
        label: '分類 id',
        help: '可在分類页 URL 中找到，例如 政治 1、社會 7、全球 4、生活 5、兩岸 9、地方 11、產經 10、文教科技 6、環境 3、社福人權 12',
        required: true,
        default: ''
      }
    ]
  }
}

const BASE = 'https://news.pts.org.tw'
const LIMIT = 30

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

// Taiwan time is UTC+8.
function taiwanSeconds(text) {
  const match = /(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(String(text))
  if (!match) return undefined
  const milliseconds = Date.parse(`${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6] || '00'}+08:00`)
  return Number.isFinite(milliseconds) ? Math.floor(milliseconds / 1000) : undefined
}

function shortTaiwanSeconds(text) {
  const match = /(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})/.exec(String(text))
  if (!match) return undefined
  const year = new Date(Date.now() + 8 * 3600 * 1000).getUTCFullYear()
  const month = String(match[1]).padStart(2, '0')
  const day = String(match[2]).padStart(2, '0')
  const hour = String(match[3]).padStart(2, '0')
  const milliseconds = Date.parse(`${year}-${month}-${day}T${hour}:${match[4]}:00+08:00`)
  return Number.isFinite(milliseconds) ? Math.floor(milliseconds / 1000) : undefined
}

export function parseList(html, limit = LIMIT) {
  const entries = []
  const seen = new Set()

  const add = (id, title, url, image, publishedAt) => {
    if (!id || !title || seen.has(id)) return
    seen.add(id)
    const entry = { id: `pts:${id}`, title, url }
    if (image) entry.image = image
    if (publishedAt !== undefined) entry.publishedAt = publishedAt
    entries.push(entry)
  }

  // Shape 1: data-story-url="/story/<forum>/<article id>" cards.
  const story = /data-story-url="\/story\/\d+\/(\d+)"/g

  for (const match of html.matchAll(story)) {
    if (entries.length >= limit) return entries
    const next = html.indexOf('data-story-url="', match.index + 1)
    const block = html.slice(match.index, next === -1 ? undefined : next)
    const title = /storyArticleTitleArea[\s\S]*?<span[^>]*>([\s\S]*?)<\/span>/.exec(block)
    if (!title) continue
    const time = /<time[^>]*>([\s\S]*?)<\/time>/.exec(block)
    const image = /<img src="([^"]+)"/.exec(block)
    add(match[1], strip(title[1]), `${BASE}/article/${match[1]}`, image ? image[1] : undefined, time ? shortTaiwanSeconds(strip(time[1])) : undefined)
  }

  if (entries.length > 0) {
    return entries
  }

  // Shape 2: <li class="d-flex"> rows.
  for (const block of html.split('<li class="d-flex">').slice(1)) {
    const head = /<h2[^>]*title="[^"]*"[^>]*>\s*<a href="(https:\/\/news\.pts\.org\.tw\/article\/(\d+))"[^>]*>([\s\S]*?)<\/a>/.exec(block)
    if (!head) continue
    const time = /<time datetime="([^"]+)"/.exec(block)
    const image = /<img class="cover-fit"[^>]*src="([^"]+)"/.exec(block)
    add(head[2], strip(head[3]), head[1], image ? image[1] : undefined, time ? taiwanSeconds(time[1]) : undefined)
    if (entries.length >= limit) break
  }

  return entries
}

export async function fetch(ctx) {
  const id = String(ctx.params.id || '').trim()

  if (!id) {
    throw new Error('公視新聞網分類 id 不能为空，请在分類页 URL 中查找')
  }

  const url = `${BASE}/category/${encodeURIComponent(id)}`
  const response = await ctx.fetch(url, { headers: { accept: 'text/html' } })

  if (!response.ok) {
    throw new Error(`公視新聞網返回 ${response.status} ${response.statusText}`)
  }

  const entries = parseList(await response.text())

  if (entries.length === 0) {
    throw new Error(`公視新聞網分类 ${id} 页面结构已变化，未找到新闻`)
  }

  return { entries }
}

export async function preview(ctx) {
  const url = ctx.item?.url
  if (!url) return null
  const content = await ctx.article(url)
  return content === null ? null : { content }
}
