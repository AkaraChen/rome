// Ported from RSSHub lib/routes/telegram/blog.ts (AGPL-3.0).
// Telegram Blog — the index is a card list that already carries the title, the
// lead and the date, so a refresh is one request. The post body is left to
// preview.

export const meta = {
  id: 'rome.rsshub-telegram-blog',
  name: 'Telegram · Blog',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: 'Telegram 官方博客的文章列表',
  icon: 'https://telegram.org/favicon.ico'
}

const BASE = 'https://telegram.org'
const LIST = `${BASE}/blog`
const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 }

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

// "Aug 25, 2026"
function dateSeconds(text) {
  const match = /([A-Za-z]{3})\s+(\d{1,2}),?\s+(\d{4})/.exec(String(text))
  if (!match) return undefined
  const month = MONTHS[match[1].toLowerCase()]
  if (month === undefined) return undefined
  return Math.floor(Date.UTC(Number(match[3]), month, Number(match[2])) / 1000)
}

export async function fetch(ctx) {
  const response = await ctx.fetch(LIST, { headers: { accept: 'text/html' } })

  if (!response.ok) {
    throw new Error(`Telegram 博客返回 ${response.status} ${response.statusText}`)
  }

  const html = await response.text()
  const entries = []
  const seen = new Set()

  const card = /<a class="dev_blog_card_link_wrap" href="([^"]+)">([\s\S]*?)<\/a>/g

  for (const match of html.matchAll(card)) {
    const href = match[1]
    if (seen.has(href)) continue
    seen.add(href)

    const block = match[2]
    const title = /<h4 class="dev_blog_card_title">([\s\S]*?)<\/h4>/.exec(block)
    if (!title) continue

    const slug = href.split('/').filter(Boolean).pop()
    const entry = {
      id: `telegram:blog:${slug}`,
      title: strip(title[1]),
      url: new URL(href, BASE).href
    }

    const lead = /<div class="dev_blog_card_lead">([\s\S]*?)<\/div>/.exec(block)
    if (lead) {
      entry.summary = strip(lead[1])
    }

    const date = /<div class="dev_blog_card_date">([\s\S]*?)<\/div>/.exec(block)
    const publishedAt = date ? dateSeconds(strip(date[1])) : undefined
    if (publishedAt !== undefined) {
      entry.publishedAt = publishedAt
    }

    const image = /<img class="dev_blog_card_image"[^>]*src="([^"]+)"/.exec(block)
    if (image) {
      entry.image = image[1]
    }

    entries.push(entry)
  }

  if (entries.length === 0) {
    throw new Error('Telegram 博客页面结构已变化，未找到文章')
  }

  return { entries }
}

export async function preview(ctx) {
  const url = ctx.item?.url
  if (!url) return null
  const content = await ctx.article(url)
  return content === null ? null : { content }
}
