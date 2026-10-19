// Ported from RSSHub lib/routes/wechat/wechat2rss.ts (AGPL-3.0).
// 微信公众号（Wechat2RSS 来源）— an official RSS feed served by the third-party
// wechat2rss.xlab.app bridge. The feed already carries the full article body, so
// there is no preview hook.

export const meta = {
  id: 'rome.rsshub-wechat-wechat2rss',
  name: '微信小程序 · 公众号（Wechat2RSS 来源）',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: '通过 Wechat2RSS 订阅的微信公众号文章',
  icon: 'https://wechat2rss.xlab.app/favicon.ico',
  params: {
    fields: [
      {
        key: 'id',
        type: 'text',
        label: '公众号 id',
        help: '打开 https://wechat2rss.xlab.app/posts/list/ ，在 URL 中找到订阅 id，而不是公众号页的 id',
        required: true,
        default: ''
      }
    ]
  }
}

const BASE = 'https://wechat2rss.xlab.app'
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

function decode(text) {
  return String(text).replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (match, entity) => {
    if (entity[0] === '#') {
      const code = entity[1] === 'x' || entity[1] === 'X'
        ? Number.parseInt(entity.slice(2), 16)
        : Number.parseInt(entity.slice(1), 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : match
    }
    return Object.prototype.hasOwnProperty.call(ENTITIES, entity) ? ENTITIES[entity] : match
  })
}

function unwrap(value) {
  return decode(String(value).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1'))
}

function strip(html) {
  return decode(String(html).replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim()
}

function tag(block, name) {
  const match = new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`).exec(block)
  return match ? match[1] : undefined
}

function seconds(value) {
  const milliseconds = Date.parse(String(value).trim())
  return Number.isFinite(milliseconds) ? Math.floor(milliseconds / 1000) : undefined
}

export async function fetch(ctx) {
  const id = String(ctx.params.id || '').trim()

  if (!id) {
    throw new Error('Wechat2RSS 订阅 id 不能为空，请在订阅列表页 URL 中查找')
  }

  const url = `${BASE}/feed/${encodeURIComponent(id)}.xml`
  const response = await ctx.fetch(url, { headers: { accept: 'application/rss+xml, application/xml' } })

  if (!response.ok) {
    throw new Error(`Wechat2RSS 返回 ${response.status} ${response.statusText}`)
  }

  const xml = await response.text()
  const entries = []

  for (const part of xml.split('<item>').slice(1)) {
    const block = part.split('</item>')[0]
    const rawLink = tag(block, 'link')
    const rawTitle = tag(block, 'title')

    if (!rawLink || !rawTitle) continue

    const link = unwrap(rawLink).trim()
    const entry = {
      id: `wechat2rss:${link}`,
      title: strip(unwrap(rawTitle)) || link,
      url: link
    }

    const description = tag(block, 'description')
    if (description) {
      const summary = strip(unwrap(description))
      if (summary) entry.summary = summary
    }

    const content = tag(block, 'content:encoded')
    if (content) {
      entry.content = unwrap(content)
    }

    const pubDate = tag(block, 'pubDate')
    const publishedAt = pubDate ? seconds(unwrap(pubDate)) : undefined
    if (publishedAt !== undefined) {
      entry.publishedAt = publishedAt
    }

    entries.push(entry)
  }

  if (entries.length === 0) {
    throw new Error(`Wechat2RSS 订阅 ${id} 没有返回文章`)
  }

  return { entries }
}
