// Ported from RSSHub lib/routes/kiro/changelog.ts (AGPL-3.0).
// Kiro · Changelog — ported from RSSHub's /kiro/changelog.
//
// The changelog publishes its own RSS 2.0 feed at /changelog/feed.rss, with a
// `category` per entry (IDE, CLI, Models, …) and often the release note in the
// description. Entries whose description is only the editor's
// `{/ cspell:ignore … /}` marker are shown without a summary and rely on
// `preview` for the body.

export const meta = {
  id: 'rome.rsshub-kiro-changelog',
  name: 'Kiro · Changelog',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: 'Kiro 更新日志，含分类、摘要与发布时间',
  icon: 'https://kiro.dev/favicon.ico',
}

const FEED = 'https://kiro.dev/changelog/feed.rss'

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

function plain(value) {
  return decodeXml(String(value ?? '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim()
}

function summaryOf(description) {
  const text = plain(description)
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
    throw new Error('Kiro 更新日志没有返回 RSS 条目，订阅源可能已经变了')
  }

  const entries = []

  for (const block of blocks) {
    const title = tag(block, 'title')
    const link = tag(block, 'link')
    if (!title || !link) continue

    const category = tag(block, 'category')
    const summary = summaryOf(tag(block, 'description'))

    const entry = {
      id: `kiro:changelog:${tag(block, 'guid') || link}`,
      title,
      url: link,
      summary: summary ? `${category ? `${category} · ` : ''}${summary}` : category,
      content: [
        category ? `<p>${category.replaceAll('&', '&amp;').replaceAll('<', '&lt;')}</p>` : null,
        summary ? `<p>${summary.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')}</p>` : null,
      ].filter(Boolean).join('') || undefined,
    }

    const publishedAt = Date.parse(tag(block, 'pubDate') ?? '')
    if (Number.isFinite(publishedAt)) entry.publishedAt = Math.floor(publishedAt / 1000)

    entries.push(entry)
  }

  if (entries.length === 0) {
    throw new Error('Kiro 更新日志订阅源为空，接口可能已经变了')
  }

  ctx.log.info(`kiro-changelog: ${entries.length} 条`)

  return { entries, icon: 'https://kiro.dev/favicon.ico' }
}

export async function preview(ctx) {
  const url = ctx.item && ctx.item.url
  if (!url) return null

  const content = await ctx.article(url)
  return content === null ? null : { content }
}
