// Ported from RSSHub lib/routes/wechat/announce.ts (AGPL-3.0).
// 微信公众平台系统公告 — the announcement list is a plain server-rendered page.
// Each row carries the announcement id inside its link, which is what the entry
// is keyed on.

export const meta = {
  id: 'rome.rsshub-wechat-announce',
  name: '微信小程序 · 公众平台系统公告栏目',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: '微信公众平台的系统公告栏目',
  icon: 'https://mp.weixin.qq.com/favicon.ico'
}

const BASE = 'https://mp.weixin.qq.com'
const LIST = `${BASE}/cgi-bin/announce?action=getannouncementlist&lang=zh_CN`

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

// The list prints a bare date in Beijing time, which is UTC+8.
function chinaDateSeconds(text) {
  const match = /(\d{4})-(\d{2})-(\d{2})/.exec(String(text))
  if (!match) return undefined
  const milliseconds = Date.parse(`${match[1]}-${match[2]}-${match[3]}T00:00:00+08:00`)
  return Number.isFinite(milliseconds) ? Math.floor(milliseconds / 1000) : undefined
}

export async function fetch(ctx) {
  const response = await ctx.fetch(LIST, { headers: { accept: 'text/html' } })

  if (!response.ok) {
    throw new Error(`微信公众平台返回 ${response.status} ${response.statusText}`)
  }

  const html = await response.text()
  const entries = []

  for (const block of html.split('<li class="mp_news_item">').slice(1)) {
    const link = /<a href="([^"]+)"/.exec(block)
    const title = /<strong>([\s\S]*?)<\/strong>/.exec(block)
    if (!link || !title) continue

    const href = decode(link[1])
    const announceId = /announce_id=([^&"]+)/.exec(href)

    const entry = {
      id: `wechat:announce:${announceId ? announceId[1] : href}`,
      title: strip(title[1]),
      url: new URL(href, BASE).href
    }

    const time = /<span class="read_more">([^<]*)<\/span>/.exec(block)
    const publishedAt = time ? chinaDateSeconds(time[1]) : undefined
    if (publishedAt !== undefined) {
      entry.publishedAt = publishedAt
    }

    entries.push(entry)
  }

  if (entries.length === 0) {
    throw new Error('微信公众平台公告页面结构已变化，未找到公告')
  }

  return { entries }
}

export async function preview(ctx) {
  const url = ctx.item?.url
  if (!url) return null
  const content = await ctx.article(url)
  return content === null ? null : { content }
}
