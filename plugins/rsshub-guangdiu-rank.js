// Ported from RSSHub lib/routes/guangdiu/rank.ts (AGPL-3.0).
// 逛丢一小时风云榜 — one page, one block per ranked deal. The ranking carries no
// time of its own; the detail page does, so it is left to preview.

export const meta = {
  id: 'rome.rsshub-guangdiu-rank',
  name: '逛丢 · 一小时风云榜',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: '逛丢按点击热度每小时统计的折扣榜单',
  icon: 'https://guangdiu.com/favicon.ico'
}

const BASE = 'https://guangdiu.com'
const LIST = `${BASE}/rank.php`

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
  const response = await ctx.fetch(LIST, { headers: { accept: 'text/html' } })

  if (!response.ok) {
    throw new Error(`逛丢返回 ${response.status} ${response.statusText}`)
  }

  const html = await response.text()
  const entries = []

  for (const block of html.split('<div class="hourrankitem">').slice(1)) {
    const title = /<a class="hourranktitle"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(block)
    if (!title) continue

    const dealId = /id=(\d+)/.exec(title[1])
    if (!dealId) continue

    const entry = {
      id: `guangdiu:rank:${dealId[1]}`,
      title: strip(title[2]),
      url: new URL(title[1], BASE).href
    }

    const rank = /<div class="hourranknumtext">([\s\S]*?)<\/div>/.exec(block)
    const from = /<div class="hourrankfromsite">([\s\S]*?)<\/div>/.exec(block)
    const parts = []

    if (rank) parts.push(strip(rank[1]))
    if (from) parts.push(strip(from[1]))
    if (parts.length > 0) entry.summary = parts.join(' · ')

    const image = /<img class="hourrankimg"[^>]*src="([^"]+)"/.exec(block)
    if (image) entry.image = image[1]

    entries.push(entry)
  }

  if (entries.length === 0) {
    throw new Error('逛丢风云榜页面结构已变化，未找到榜单')
  }

  return { entries }
}

export async function preview(ctx) {
  const url = ctx.item?.url
  if (!url) return null
  const content = await ctx.article(url)
  return content === null ? null : { content }
}
