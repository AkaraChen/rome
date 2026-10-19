// Ported from OpenCLI clis/google/news.js (Apache-2.0).
// Google News — the public RSS endpoint. With no keyword it is the top-story
// feed; with one it is the search feed. No browser, no key.

export const meta = {
  id: 'rome.opencli-google-news',
  name: 'Google · 新闻',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: 'Google 新闻头条，可按关键词搜索。',
  icon: 'https://news.google.com/favicon.ico',
  params: {
    fields: [
      { key: 'keyword', type: 'text', label: '搜索关键词', help: '留空则读取头条新闻', default: '' },
      { key: 'limit', type: 'number', label: '每次抓取条数', help: '1 到 100 条', default: 10, min: 1, max: 100 },
      { key: 'lang', type: 'text', label: '语言', help: '语言短代码，例如 en、zh', default: 'en' },
      { key: 'region', type: 'text', label: '地区', help: '地区代码，例如 US、CN', default: 'US' },
    ],
  },
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

function decode(text) {
  return String(text || '').replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity) => {
    if (entity[0] === '#') {
      const code = entity[1] === 'x' || entity[1] === 'X'
        ? Number.parseInt(entity.slice(2), 16)
        : Number.parseInt(entity.slice(1), 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : match
    }
    return Object.prototype.hasOwnProperty.call(ENTITIES, entity) ? ENTITIES[entity] : match
  })
}

// `<source url="…">CNN</source>` is the one field here with attributes, so the
// tag pattern accepts them and the caller keeps only the text.
function tag(block, name) {
  const pattern = new RegExp(`<${name}(?:\\s[^>]*)?>\\s*(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?\\s*</${name}>`)
  const match = pattern.exec(block)
  return match ? match[1] : ''
}

function plain(html) {
  return decode(String(html || '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim()
}

function seconds(value) {
  if (!value) return undefined
  const milliseconds = Date.parse(value)
  return Number.isFinite(milliseconds) ? Math.floor(milliseconds / 1000) : undefined
}

function integer(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(Math.max(parsed, min), max)
}

export async function fetch(ctx) {
  const limit = integer(ctx.params.limit, 10, 1, 100)
  const keyword = String(ctx.params.keyword || '').trim()
  const lang = String(ctx.params.lang || 'en').trim() || 'en'
  const region = String(ctx.params.region || 'US').trim() || 'US'
  const ceid = `${region}:${lang}`

  const url = keyword
    ? `https://news.google.com/rss/search?q=${encodeURIComponent(keyword)}&hl=${encodeURIComponent(lang)}&gl=${encodeURIComponent(region)}&ceid=${ceid}`
    : `https://news.google.com/rss?hl=${encodeURIComponent(lang)}&gl=${encodeURIComponent(region)}&ceid=${ceid}`

  const response = await ctx.fetch(url, { headers: { accept: 'application/rss+xml, application/xml' } })

  if (!response.ok) {
    throw new Error(`Google 新闻 RSS 返回 HTTP ${response.status}`)
  }

  const xml = await response.text()
  const entries = []
  const item = /<item[^>]*>([\s\S]*?)<\/item>/g
  let match

  while ((match = item.exec(xml)) !== null && entries.length < limit) {
    const block = match[1]
    const link = decode(tag(block, 'link')).trim()
    const guid = decode(tag(block, 'guid')).trim()
    const address = link || guid

    if (!address) continue

    let title = plain(tag(block, 'title'))
    let source = plain(tag(block, 'source'))

    // Older items carry no <source> element but still end the title with
    // " - Publisher", which is the only place the outlet appears.
    if (!source) {
      const index = title.lastIndexOf(' - ')
      if (index !== -1) {
        source = title.slice(index + 3)
        title = title.slice(0, index)
      }
    }

    if (!title) continue

    entries.push({
      id: `google:${guid || address}`,
      title,
      url: address,
      author: source || undefined,
      publishedAt: seconds(decode(tag(block, 'pubDate')).trim()),
    })
  }

  if (entries.length === 0) {
    throw new Error('Google 新闻没有返回条目，请更换关键词或地区。')
  }

  return { entries }
}

export async function preview(ctx) {
  const content = await ctx.article(ctx.item.url)
  return content === null ? null : { content }
}
