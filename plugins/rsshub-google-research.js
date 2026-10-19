// Ported from RSSHub lib/routes/google/research.ts (AGPL-3.0).
// Google Research Blog — /google/research
//
// The blog index, server-rendered as a grid of cards. Each card is an anchor
// carrying its own href, and everything else — date, title, categories — sits
// inside it, so the parse is: find the card anchors, then read each slice
// between one anchor and the next.
//
// RSSHub fetches each post for its body here; `preview` does that instead,
// one page at a time.

export const meta = {
  id: 'rome.rsshub-google-research',
  name: 'Google · Research Blog',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: 'Google Research 博客的最新文章',
  icon: 'https://research.google/favicon.ico',
}

const BASE = 'https://research.google'

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

function decode(value) {
  return String(value ?? '').replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity) => {
    if (entity[0] === '#') {
      const code = entity[1] === 'x' || entity[1] === 'X'
        ? Number.parseInt(entity.slice(2), 16)
        : Number.parseInt(entity.slice(1), 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : match
    }

    return Object.prototype.hasOwnProperty.call(ENTITIES, entity) ? ENTITIES[entity] : match
  })
}

function strip(html) {
  return decode(String(html ?? '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim()
}

export async function fetch(ctx) {
  const response = await ctx.fetch(`${BASE}/blog/`, { headers: { accept: 'text/html' } })

  if (!response.ok) {
    throw new Error(`Google Research Blog 返回 ${response.status}`)
  }

  const html = await response.text()

  // Card anchors are the only place `glue-card--blog` appears, and each one
  // opens the slice that describes it.
  const starts = []
  const pattern = /<a class="glue-card[^"]*glue-card--blog" href="([^"]+)"/g
  let match

  while ((match = pattern.exec(html)) !== null) {
    starts.push({ href: match[1], at: match.index })
  }

  if (starts.length === 0) {
    throw new Error('Google Research Blog 没有返回文章，页面结构可能已经变了')
  }

  const entries = starts.map((start, index) => {
    const end = index + 1 < starts.length ? starts[index + 1].at : html.length
    const chunk = html.slice(start.at, end)

    const dateMatch = chunk.match(/<p class="glue-card__eyebrow[^"]*">([\s\S]*?)<\/p>/)
    const titleMatch = chunk.match(/<span class="headline-6[^"]*">([\s\S]*?)<\/span>/)

    const categories = []
    const categoryPattern = /<span class="not-glue caption">([\s\S]*?)<\/span>/g
    let category

    while ((category = categoryPattern.exec(chunk)) !== null) {
      const value = strip(category[1]).replace(/^·/, '').trim()
      if (value) categories.push(value)
    }

    const entry = {
      id: `google-research:${start.href}`,
      title: titleMatch ? strip(titleMatch[1]) : undefined,
      url: `${BASE}${start.href}`,
      author: 'Google',
      summary: categories.join(' · ') || undefined,
    }

    const publishedAt = Date.parse(`${strip(dateMatch?.[1])} UTC`)
    if (Number.isFinite(publishedAt)) entry.publishedAt = Math.floor(publishedAt / 1000)

    return entry
  })

  ctx.log.info(`google-research: ${entries.length} 条`)

  return { entries }
}

export async function preview(ctx) {
  const content = await ctx.article(ctx.item.url)
  return content ? { content } : null
}
