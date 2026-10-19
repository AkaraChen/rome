// Ported from RSSHub lib/routes/pts/index.ts (AGPL-3.0).
// 公視新聞網即時新聞 — the list page is server-rendered. The newest items are
// <li class="d-flex"> rows with an <h2 title><a href> heading, a <time> and a
// cover image; the grid further down repeats the same pieces without the
// heading wrapper. Both shapes are read, because which one a page uses depends
// on how much content sits on it.

export const meta = {
  id: 'rome.rsshub-pts-index',
  name: '公視新聞網 · 即時新聞',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: '公視新聞網的即時新聞列表',
  icon: 'https://news.pts.org.tw/favicon.ico'
}

const BASE = 'https://news.pts.org.tw'
const LIST = `${BASE}/dailynews`
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

// The site prints Taiwan time, which is UTC+8.
function taiwanSeconds(text) {
  const match = /(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(String(text))
  if (!match) return undefined
  const milliseconds = Date.parse(`${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6] || '00'}+08:00`)
  return Number.isFinite(milliseconds) ? Math.floor(milliseconds / 1000) : undefined
}

// The grid prints "10/19 13:53" without a year, so the current Taiwan year is
// assumed — the same assumption a reader makes looking at the page.
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

  // Shape 1: <li class="d-flex"> rows.
  for (const block of html.split('<li class="d-flex">').slice(1)) {
    const head = /<h2[^>]*title="[^"]*"[^>]*>\s*<a href="(https:\/\/news\.pts\.org\.tw\/article\/(\d+))"[^>]*>([\s\S]*?)<\/a>/.exec(block)
    if (!head) continue

    const time = /<time datetime="([^"]+)"/.exec(block)
    const image = /<img class="cover-fit"[^>]*src="([^"]+)"/.exec(block)
    add(head[2], strip(head[3]), head[1], image ? image[1] : undefined, time ? taiwanSeconds(time[1]) : undefined)

    if (entries.length >= limit) return entries
  }

  if (entries.length > 0) {
    return entries
  }

  // Shape 2: the card grid, <a class="flex gap-2 flex-col"> around an image, a
  // title span and a <time>.
  const grid = /<a href="(https:\/\/news\.pts\.org\.tw\/article\/(\d+))"[\s\S]*?<\/a>/g

  for (const match of html.matchAll(grid)) {
    if (entries.length >= limit) break
    const block = match[0]
    const title = /<span class="text-base leading-5\.75 font-bold">([\s\S]*?)<\/span>/.exec(block)
    if (!title) continue
    const time = /<time[^>]*>([\s\S]*?)<\/time>/.exec(block)
    const image = /<img src="([^"]+)"/.exec(block)
    add(match[2], strip(title[1]), match[1], image ? image[1] : undefined, time ? shortTaiwanSeconds(strip(time[1])) : undefined)
  }

  return entries
}

export async function fetch(ctx) {
  const response = await ctx.fetch(LIST, { headers: { accept: 'text/html' } })

  if (!response.ok) {
    throw new Error(`公視新聞網返回 ${response.status} ${response.statusText}`)
  }

  const entries = parseList(await response.text())

  if (entries.length === 0) {
    throw new Error('公視新聞網页面结构已变化，未找到新闻')
  }

  return { entries }
}

export async function preview(ctx) {
  const url = ctx.item?.url
  if (!url) return null
  const content = await ctx.article(url)
  return content === null ? null : { content }
}
