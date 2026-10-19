// Ported from RSSHub lib/routes/guancha/headline.ts (AGPL-3.0).
// 观察者网头条 — a server-rendered list, one block per item inside
// <ul class="headline-list">. The article body is left to preview.

export const meta = {
  id: 'rome.rsshub-guancha-headline',
  name: '观察者网 · 头条',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: '观察者网头条栏目的最新文章',
  icon: 'https://www.guancha.cn/favicon.ico'
}

const BASE = 'https://www.guancha.cn'
const LIST = `${BASE}/GuanChaZheTouTiao/list_1.shtml`

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

// 观察者网 prints Beijing time, which is UTC+8.
function chinaSeconds(text) {
  const match = /(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(String(text))
  if (!match) return undefined
  const milliseconds = Date.parse(`${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6] || '00'}+08:00`)
  return Number.isFinite(milliseconds) ? Math.floor(milliseconds / 1000) : undefined
}

export async function fetch(ctx) {
  const response = await ctx.fetch(LIST, { headers: { accept: 'text/html' } })

  if (!response.ok) {
    throw new Error(`观察者网返回 ${response.status} ${response.statusText}`)
  }

  const html = await response.text()
  const entries = []

  for (const block of html.split('<div class="content-headline">').slice(1)) {
    const head = /<h3><a href="([^"]+)"[^>]*>([\s\S]*?)<\/a><\/h3>/.exec(block)
    if (!head) continue

    const href = head[1]
    const slug = href.split('/').pop().replace(/\.shtml$/, '')

    if (!slug) continue

    const entry = {
      id: `guancha:${slug}`,
      title: strip(head[2]),
      url: new URL(href, BASE).href
    }

    const summary = /<p class="module-artile">([\s\S]*?)<\/p>/.exec(block)
    if (summary) {
      entry.summary = strip(summary[1])
    }

    const image = /<img src="([^"]+)"/.exec(block)
    if (image) {
      entry.image = image[1]
    }

    const time = /<span>(\d{4}-\d{2}-\d{2} \d{2}:\d{2})<\/span>/.exec(block)
    const publishedAt = time ? chinaSeconds(time[1]) : undefined
    if (publishedAt !== undefined) {
      entry.publishedAt = publishedAt
    }

    entries.push(entry)
  }

  if (entries.length === 0) {
    throw new Error('观察者网头条页面结构已变化，未找到文章')
  }

  return { entries }
}

export async function preview(ctx) {
  const url = ctx.item?.url
  if (!url) return null
  const content = await ctx.article(url)
  return content === null ? null : { content }
}
