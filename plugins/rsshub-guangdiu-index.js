// Ported from RSSHub lib/routes/guangdiu/index.ts (AGPL-3.0).
// 逛丢 — the deal listing. One request, one block per deal; the detail page
// (which carries the buy button and the absolute time) is left to preview.

export const meta = {
  id: 'rome.rsshub-guangdiu-index',
  name: '逛丢 · 国内折扣 / 海外折扣',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: '逛丢的国内折扣与海外折扣列表',
  icon: 'https://guangdiu.com/favicon.ico',
  params: {
    fields: [
      {
        key: 'query',
        type: 'text',
        label: '链接参数',
        help: '对应网址问号后的内容，例如 k=daily；填 c=us 为海外折扣，留空为国内折扣',
        default: ''
      }
    ]
  }
}

const BASE = 'https://guangdiu.com'

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

// 逛丢 prints Beijing time, which is UTC+8.
function chinaSeconds(text) {
  const match = /(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(String(text))
  if (!match) return undefined
  const milliseconds = Date.parse(`${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:00+08:00`)
  return Number.isFinite(milliseconds) ? Math.floor(milliseconds / 1000) : undefined
}

// The listing only says "3分钟前"; the detail page has the exact time, so the
// relative form is approximated from now.
function listSeconds(text) {
  const value = String(text).trim()
  const now = Math.floor(Date.now() / 1000)

  if (value === '刚刚') return now

  const relative = /^(\d+)\s*(秒|分钟|小时|天)前$/.exec(value)

  if (relative) {
    const units = { 秒: 1, 分钟: 60, 小时: 3600, 天: 86400 }
    return now - Number(relative[1]) * units[relative[2]]
  }

  const yesterday = /^昨天\s*(\d{1,2}):(\d{2})$/.exec(value)

  if (yesterday) {
    const day = new Date((now - 86400) * 1000 + 8 * 3600 * 1000)
    const date = day.toISOString().slice(0, 10)
    const milliseconds = Date.parse(`${date}T${String(yesterday[1]).padStart(2, '0')}:${yesterday[2]}:00+08:00`)
    return Number.isFinite(milliseconds) ? Math.floor(milliseconds / 1000) : undefined
  }

  return chinaSeconds(value)
}

export async function fetch(ctx) {
  const query = String(ctx.params.query || '').trim()
  const url = query === 'c=us'
    ? `${BASE}/?c=us`
    : query
      ? `${BASE}/cate.php?${query}`
      : `${BASE}/`

  const response = await ctx.fetch(url, { headers: { accept: 'text/html' } })

  if (!response.ok) {
    throw new Error(`逛丢返回 ${response.status} ${response.statusText}`)
  }

  const html = await response.text()
  const entries = []

  for (const block of html.split('<div class="gooditem').slice(1)) {
    const title = /<a class="goodname"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(block)
    if (!title) continue

    const dealId = /id=(\d+)/.exec(title[1])
    if (!dealId) continue

    const entry = {
      id: `guangdiu:${dealId[1]}`,
      title: strip(title[2]),
      url: new URL(title[1], BASE).href
    }

    const summary = /<a class="abstractcontent"[^>]*>([\s\S]*?)<\/a>/.exec(block)
    if (summary) {
      entry.summary = strip(summary[1])
    }

    const image = /<img class="imgself"[^>]*src="([^"]+)"/.exec(block)
    if (image) {
      entry.image = image[1]
    }

    const time = /<span class="latesttime">([^<]*)<\/span>/.exec(block)
    const publishedAt = time ? listSeconds(time[1]) : undefined
    if (publishedAt !== undefined) {
      entry.publishedAt = publishedAt
    }

    entries.push(entry)
  }

  if (entries.length === 0) {
    throw new Error('逛丢页面结构已变化，未找到折扣')
  }

  return { entries }
}

export async function preview(ctx) {
  const url = ctx.item?.url
  if (!url) return null
  const content = await ctx.article(url)
  return content === null ? null : { content }
}
