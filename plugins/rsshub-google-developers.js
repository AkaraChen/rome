// Ported from RSSHub lib/routes/google/developers.ts (AGPL-3.0).
// Google Developers Blog — /google/developers/:locale
//
// The blog's search page, which is server-rendered and lists the latest posts
// for a locale. The locale is a path segment, so the list is whatever that
// locale publishes.
//
// The eyebrow is `OCT. 15, 2026 / AI` — a date and a category in one line. The
// trailing period after the month abbreviation is not something `Date.parse`
// accepts, so it is stripped before parsing.

export const meta = {
  id: 'rome.rsshub-google-developers',
  name: 'Google · Developers Blog',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: 'Google Developers 博客的最新文章',
  icon: 'https://developers.googleblog.com/favicon.ico',
  params: {
    fields: [
      {
        key: 'locale',
        type: 'select',
        label: '语言',
        default: 'en',
        options: [
          { value: 'en', label: 'English' },
          { value: 'es', label: 'Español (Latam)' },
          { value: 'id', label: 'Bahasa Indonesia' },
          { value: 'ja', label: '日本語' },
          { value: 'ko', label: '한국어' },
          { value: 'pt-br', label: 'Português (Brasil)' },
          { value: 'zh-hans', label: '简体中文' },
        ],
      },
    ],
  },
}

const BASE = 'https://developers.googleblog.com'

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

/// `OCT. 15, 2026` → a timestamp, or undefined when the eyebrow is shaped
/// differently than expected.
function date(text) {
  const normalized = String(text || '').replace(/^([A-Za-z]{3})\./, '$1')
  const parsed = Date.parse(`${normalized} UTC`)
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : undefined
}

export async function fetch(ctx) {
  const locale = String(ctx.params.locale || 'en').trim() || 'en'

  const response = await ctx.fetch(`${BASE}/${encodeURIComponent(locale)}/search/`, { headers: { accept: 'text/html' } })

  if (!response.ok) {
    throw new Error(`Google Developers Blog 返回 ${response.status}（${locale}）`)
  }

  const html = await response.text()
  const chunks = html.match(/<li class="search-result">[\s\S]*?<\/li>/g)

  if (!Array.isArray(chunks) || chunks.length === 0) {
    throw new Error('Google Developers Blog 没有返回文章，页面结构可能已经变了')
  }

  const entries = chunks.map((chunk) => {
    const linkMatch = chunk.match(/<h3 class="search-result__title[^"]*"><a href="([^"]+)">([\s\S]*?)<\/a>/)

    if (!linkMatch) {
      throw new Error('Google Developers Blog 有一篇文章没有标题链接，页面结构可能已经变了')
    }

    const eyebrow = chunk.match(/<p class="search-result__eyebrow">([\s\S]*?)<\/p>/)
    const summary = chunk.match(/<p class="search-result__summary">([\s\S]*?)<\/p>/)
    const [dateText, category] = strip(eyebrow?.[1]).split(' / ', 2)

    const entry = {
      id: `google-developers:${linkMatch[1]}`,
      title: strip(linkMatch[2]),
      url: `${BASE}${linkMatch[1]}`,
      author: category || 'Google',
      summary: summary ? strip(summary[1]) || undefined : undefined,
    }

    const publishedAt = date(dateText)
    if (publishedAt !== undefined) entry.publishedAt = publishedAt

    return entry
  })

  ctx.log.info(`google-developers: ${entries.length} 条（${locale}）`)

  return { entries }
}

export async function preview(ctx) {
  const content = await ctx.article(ctx.item.url)
  return content ? { content } : null
}
