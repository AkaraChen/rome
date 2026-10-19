// Ported from RSSHub lib/routes/tradingview/desktop.ts (AGPL-3.0).
// TradingView — 桌面版发布说明。
//
// 发布说明是一页长文档，每个版本是一个 `<h4 data-identifyelement>` 标题，
// 后面跟着该版本的正文，直到下一个 h4。正文已经在这一次请求里拿到，所以
// 直接放进条目，不再单独请求。

export const meta = {
  id: 'rome.rsshub-tradingview-desktop',
  name: 'TradingView · 桌面版发布说明',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: '列出 TradingView 桌面版的版本发布说明',
  icon: 'https://www.tradingview.com/favicon.ico',
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

function seconds(value) {
  const milliseconds = Date.parse(value)
  return Number.isFinite(milliseconds) ? Math.floor(milliseconds / 1000) : undefined
}

function slug(text) {
  return strip(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
}

export async function fetch(ctx) {
  const url = 'https://www.tradingview.com/support/solutions/43000673888-tradingview-desktop-releases-and-release-notes/'

  ctx.log.debug(`tradingview: GET ${url}`)

  const response = await ctx.fetch(url, { headers: { accept: 'text/html' } })

  if (!response.ok) {
    throw new Error(`TradingView 返回 ${response.status} ${response.statusText}`)
  }

  const html = await response.text()
  const headings = [...html.matchAll(/<h4\b[^>]*\bdata-identifyelement="[^"]*"[^>]*>([\s\S]*?)<\/h4>/g)]
  const entries = []

  for (const [index, match] of headings.entries()) {
    const title = strip(match[1])
    if (!title) continue

    const start = match.index + match[0].length
    const content = html.slice(start, headings[index + 1]?.index ?? html.length)

    const entry = {
      id: `tradingview-desktop:${slug(title) || index}`,
      title,
      url,
      content: content.trim(),
    }

    // 标题以「September 8, 2026.」开头，日期是标题的一部分。
    const date = /^([A-Z][a-z]+ \d{1,2}, \d{4})/.exec(title)
    if (date) {
      const publishedAt = seconds(date[1])
      if (publishedAt !== undefined) entry.publishedAt = publishedAt
    }

    const summary = strip(content)
    if (summary) entry.summary = summary.slice(0, 200)

    entries.push(entry)
  }

  if (entries.length === 0) {
    throw new Error('TradingView 发布说明页没有版本标题，页面结构可能已经变了')
  }

  ctx.log.info(`tradingview: ${entries.length} 个版本`)

  return { entries }
}
