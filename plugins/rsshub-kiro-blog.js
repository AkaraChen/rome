// Ported from RSSHub lib/routes/kiro/blog.ts (AGPL-3.0).
// Kiro · Blog — ported from RSSHub's /kiro/blog.
//
// The site publishes an RSS 2.0 feed at /blog/feed.rss and links it from the
// blog page, so the list is read from the feed rather than by scanning the
// rendered cards. Some items carry a `{/ cspell:ignore … /}` editor marker as
// their description instead of a summary; those are treated as having none, and
// the article body is left to `preview`.

export const meta = {
  id: 'rome.rsshub-kiro-blog',
  name: 'Kiro · Blog',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: 'Kiro 官方博客文章，含摘要与发布时间',
  icon: 'https://kiro.dev/favicon.ico',
}

const FEED = 'https://kiro.dev/blog/feed.rss'

function decodeXml(value) {
  return String(value ?? '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#x([0-9a-f]+);/gi, (match, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (match, decimal) => String.fromCodePoint(Number(decimal)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

function tag(xml, name) {
  const safe = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = xml.match(new RegExp(`<${safe}(?:\\s[^>]*)?>([\\s\\S]*?)</${safe}>`))
  return match ? decodeXml(match[1]).trim() : undefined
}

/// Strips tags, because a description is HTML in some feeds and plain in this one.
function plain(value) {
  return decodeXml(String(value ?? '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim()
}

function summaryOf(description) {
  const text = plain(description)
  // `{/ cspell:ignore … /}` is the editor's spell-check directive, not copy.
  if (text === '' || /^\{\/\s*cspell/i.test(text)) return undefined
  return text
}

export async function fetch(ctx) {
  const response = await ctx.fetch(FEED, {
    headers: { accept: 'application/rss+xml, application/xml, text/xml' },
  })

  if (!response.ok) {
    throw new Error(`Kiro 返回 ${response.status} ${response.statusText}`)
  }

  const xml = await response.text()
  const blocks = xml.match(/<item>[\s\S]*?<\/item>/g)

  if (!blocks) {
    throw new Error('Kiro 博客没有返回 RSS 条目，订阅源可能已经变了')
  }

  const entries = []

  for (const block of blocks) {
    const title = tag(block, 'title')
    const link = tag(block, 'link')
    if (!title || !link) continue

    const entry = {
      id: `kiro:blog:${tag(block, 'guid') || link}`,
      title,
      url: link,
      summary: summaryOf(tag(block, 'description')),
    }

    const publishedAt = Date.parse(tag(block, 'pubDate') ?? '')
    if (Number.isFinite(publishedAt)) entry.publishedAt = Math.floor(publishedAt / 1000)

    entries.push(entry)
  }

  if (entries.length === 0) {
    throw new Error('Kiro 博客订阅源为空，接口可能已经变了')
  }

  ctx.log.info(`kiro-blog: ${entries.length} 条`)

  return { entries, icon: 'https://kiro.dev/favicon.ico' }
}

export async function preview(ctx) {
  const url = ctx.item && ctx.item.url
  if (!url) return null

  const content = await ctx.article(url)
  return content === null ? null : { content }
}
