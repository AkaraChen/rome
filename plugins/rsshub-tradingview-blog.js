// Ported from RSSHub lib/routes/tradingview/blog.ts (AGPL-3.0).
// TradingView — 博客。
//
// 博客列表页把每篇文章写成一个 `<article>`，链接在 `.articles-grid-link` 里。
// 文章 id 取自 URL 末段的 slug，标题改了也不会变。正文留给 preview。

export const meta = {
  id: 'rome.rsshub-tradingview-blog',
  name: 'TradingView · 博客',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: '抓取 TradingView 博客的文章列表',
  icon: 'https://www.tradingview.com/favicon.ico',
  params: {
    fields: [
      {
        key: 'category',
        type: 'text',
        label: '语言或分类',
        help: '语言代码（如 en、zh、ja）或分类路径（如 en/category/charts），默认为 en',
        default: 'en',
      },
    ],
  },
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

function decode(text) {
  return String(text ?? '').replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity) => {
    if (entity[0] === '#') {
      const code = entity[1] === 'x' || entity[1] === 'X'
        ? Number.parseInt(entity.slice(2), 16)
        : Number.parseInt(entity.slice(1), 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : match
    }
    return Object.prototype.hasOwnProperty.call(ENTITIES, entity) ? ENTITIES[entity] : match
  })
}

function strip(text) {
  return decode(String(text ?? '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim()
}

/// 属性顺序在文章之间不固定，所以按 class 找 anchor，再单独取 href。
function anchorWithClass(block, name) {
  for (const anchor of block.matchAll(/<a\b([^>]*)>/g)) {
    if (!anchor[1].includes(name)) continue
    const href = /href="([^"]+)"/.exec(anchor[1])
    if (href) return decode(href[1])
  }
  return null
}

export async function fetch(ctx) {
  const requested = String(ctx.params.category || 'en').trim() || 'en'
  const category = requested.endsWith('/') ? requested : `${requested}/`
  const url = new URL(`blog/${category}`, 'https://www.tradingview.com/').href

  ctx.log.debug(`tradingview: GET ${url}`)

  const response = await ctx.fetch(url, { headers: { accept: 'text/html' } })

  if (!response.ok) {
    throw new Error(`TradingView 返回 ${response.status} ${response.statusText}`)
  }

  const html = await response.text()
  const entries = []

  for (const match of html.matchAll(/<article\b[^>]*>([\s\S]*?)<\/article>/g)) {
    const block = match[1]
    const link = anchorWithClass(block, 'articles-grid-link')

    if (!link) continue

    const heading = /<[^>]*class="[^"]*\btitle\b[^"]*"[^>]*>([\s\S]*?)<\/[^>]+>/.exec(block)
    const title = heading ? strip(heading[1]) : ''

    if (!title) continue

    let slug = null
    try {
      slug = new URL(link).pathname.split('/').filter(Boolean).pop() || null
    } catch {
      slug = null
    }

    const entry = {
      id: `tradingview-blog:${slug || link}`,
      title,
      url: link,
    }

    const picture = /<div class="articles-grid-img">[\s\S]*?<img[^>]*\bsrc="([^"]+)"/.exec(block)
    if (picture) entry.image = decode(picture[1])

    const categories = []
    for (const category of block.matchAll(/<a[^>]*class="tv-category-link"[^>]*>([\s\S]*?)<\/a>/g)) {
      const name = strip(category[1])
      if (name) categories.push(name)
    }
    if (categories.length > 0) entry.summary = categories.join(' · ')

    entries.push(entry)
  }

  if (entries.length === 0) {
    throw new Error('TradingView 博客页没有文章列表，页面结构可能已经变了')
  }

  ctx.log.info(`tradingview: ${entries.length} 篇文章`)

  return { entries }
}

export async function preview(ctx) {
  const url = ctx.item?.url
  if (!url) return null

  const content = await ctx.article(url)
  return content === null ? null : { content }
}
