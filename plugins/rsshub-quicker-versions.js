// Ported from RSSHub lib/routes/quicker/versions.ts (AGPL-3.0).
// Quicker 版本更新 — 官方更新日志。
//
// 每个版本是 <div class="row version">，正文就在同一块里，不需要再点进去，
// 所以这个插件没有 preview：列表一次请求已经拿到了全部内容。

export const meta = {
  id: 'rome.rsshub-quicker-versions',
  name: 'Quicker · 版本更新',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: 'Quicker 客户端的版本更新日志',
  icon: 'https://getquicker.net/favicon.ico',
}

const URL_PAGE = 'https://getquicker.net/Help/Versions'
const BASE = 'https://getquicker.net'

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

function decode(text) {
  return String(text).replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity) => {
    if (entity[0] === '#') {
      const code = entity[1] === 'x' || entity[1] === 'X'
        ? Number.parseInt(entity.slice(2), 16)
        : Number.parseInt(entity.slice(1), 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : match
    }
    return Object.prototype.hasOwnProperty.call(ENTITIES, entity) ? ENTITIES[entity] : match
  })
}

function stripTags(html) {
  return decode(String(html).replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim()
}

// 站点时间按北京时间写，日粒度足够。
function daySeconds(text) {
  const match = /(\d{4})-(\d{2})-(\d{2})/.exec(text)
  if (!match) return undefined
  const milliseconds = Date.parse(`${match[1]}-${match[2]}-${match[3]}T00:00:00+08:00`)
  return Number.isFinite(milliseconds) ? Math.floor(milliseconds / 1000) : undefined
}

function parseList(html) {
  const entries = []

  for (const block of html.split('<div class="row version').slice(1)) {
    const link = /<h2[^>]*>\s*<a href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(block)
    if (!link) continue

    const version = stripTags(link[2])
    if (!version) continue

    const query = /[?&]version=([^&"]+)/.exec(decode(link[1]))
    const content = /<div class="article-content[^"]*">([\s\S]*?)<\/div>/.exec(block)
    const date = /<span class="text-secondary[^"]*"[^>]*>([\s\S]*?)<\/span>/.exec(block)

    const entry = {
      // 版本号本身是永久标识；链接里也带着它。
      id: `quicker:version:${query ? query[1] : version}`,
      title: version,
      url: new URL(decode(link[1]), BASE).href,
    }

    if (content) {
      const body = content[1].trim()
      if (body) entry.content = body
    }
    if (date) {
      const publishedAt = daySeconds(stripTags(date[1]))
      if (publishedAt !== undefined) entry.publishedAt = publishedAt
    }

    entries.push(entry)
  }

  return entries
}

export async function fetch(ctx) {
  ctx.log.debug(`quicker: GET ${URL_PAGE}`)

  const response = await ctx.fetch(URL_PAGE, { headers: { accept: 'text/html' } })

  if (!response.ok) {
    throw new Error(`Quicker 返回 ${response.status} ${response.statusText}`)
  }

  const html = await response.text()
  const entries = parseList(html)

  if (entries.length === 0) {
    throw new Error('Quicker 版本页没有解析到版本，页面结构可能已经改变')
  }

  return { entries, icon: `${BASE}/favicon.ico` }
}
