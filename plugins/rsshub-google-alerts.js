// Ported from RSSHub lib/routes/google/alerts.ts (AGPL-3.0).
// Google 快讯 — /google/alerts/:keyword
//
// Google Alerts has no API; the RSSHub route calls the page the alerts form
// itself calls, with a `params` blob that encodes the keyword, the language and
// a client id. That blob is reproduced here verbatim — it is the request the
// site makes, and there is nothing to derive it from.
//
// The response is a result list, and each hit's link is a google.com/url
// redirect: the real address is the `url` query parameter inside it.

export const meta = {
  id: 'rome.rsshub-google-alerts',
  name: 'Google · 快讯',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: 'Google 快讯的搜索结果',
  icon: 'https://www.google.com/favicon.ico',
  params: {
    fields: [
      {
        key: 'keyword',
        type: 'text',
        label: '关键词',
        help: '要监控的搜索词，例如 RSSHub',
        placeholder: 'RSSHub',
        default: '',
      },
    ],
  },
}

const ENDPOINT = 'https://www.google.com/alerts/preview'

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

/// The alert form's own envelope. The client id in the tail is a constant the
/// page ships; the keyword is the only thing that varies.
function envelope(keyword) {
  return `[null,[null,null,null,[null,${JSON.stringify(keyword)},"com",[null,"en","US"],null,null,null,0,0],null,3,[[null,1,"user@example.com",[null,null,20],2,"en-US",null,null,null,null,null,"0",null,null,"AB2Xq4hcilCERh73EFWJVHXx-io2lhh1EhC8UD8"]]],0]`
}

/// A hit's href is `https://www.google.com/url?...&url=<the real page>&...`.
function resolve(href) {
  const decoded = decode(href)
  const match = decoded.match(/[?&]url=([^&]+)/)
  if (!match) return decoded
  return decodeURIComponent(match[1])
}

export async function fetch(ctx) {
  const keyword = String(ctx.params.keyword || '').trim()

  if (!keyword) {
    throw new Error('请填写要监控的关键词')
  }

  const url = new URL(ENDPOINT)
  url.searchParams.set('params', envelope(keyword))

  const response = await ctx.fetch(url, { headers: { accept: 'text/html' } })

  if (!response.ok) {
    throw new Error(`Google 快讯返回 ${response.status}（${keyword}）`)
  }

  const html = await response.text()
  const chunks = html.match(/<li class="result">[\s\S]*?<\/li>/g)

  if (!Array.isArray(chunks) || chunks.length === 0) {
    throw new Error('Google 快讯没有返回结果，页面结构可能已经变了')
  }

  const entries = chunks.map((chunk) => {
    const titleMatch = chunk.match(/<a class="result_title_link" href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/)

    if (!titleMatch) {
      throw new Error('Google 快讯的一条结果没有标题链接，页面结构可能已经变了')
    }

    const link = resolve(titleMatch[1])
    const source = chunk.match(/<div class="result_source">([\s\S]*?)<\/div>/)
    const snippet = chunk.match(/<span class="snippet">([\s\S]*?)<\/span>/)
    const title = strip(titleMatch[2])

    const entry = {
      id: `google-alerts:${link || title}`,
      title,
      url: link,
      author: source ? strip(source[1]) || undefined : undefined,
      summary: snippet ? strip(snippet[1]) || undefined : undefined,
    }

    return entry
  })

  ctx.log.info(`google-alerts: ${entries.length} 条（${keyword}）`)

  return { entries }
}

export async function preview(ctx) {
  const content = await ctx.article(ctx.item.url)
  return content ? { content } : null
}
