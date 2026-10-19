// Ported from RSSHub lib/routes/pts/projects.ts (AGPL-3.0).
// 公視新聞網數位敘事 — a server-rendered list of project cards. Each card is an
// <h3 class="project-main-title"><a> heading followed by a <p> summary and a
// <time> date.

export const meta = {
  id: 'rome.rsshub-pts-projects',
  name: '公視新聞網 · 數位敘事',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: '公視新聞網數位敘事專題列表',
  icon: 'https://news.pts.org.tw/favicon.ico'
}

const BASE = 'https://news.pts.org.tw'
const LIST = `${BASE}/projects`

function decode(text) {
  const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }
  return String(text).replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity) => {
    if (entity[0] === '#') {
      const code = entity[1] === 'x' || entity[1] === 'X'
        ? Number.parseInt(entity.slice(2), 16)
        : Number.parseInt(entity.slice(1), 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : match
    }
    return Object.prototype.hasOwnProperty.call(entities, entity) ? entities[entity] : match
  })
}

function strip(html) {
  return decode(String(html).replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim()
}

// "2026/06/24" — a day-level date, so UTC is close enough.
function dateSeconds(text) {
  const match = /(\d{4})\/(\d{1,2})\/(\d{1,2})/.exec(String(text))
  if (!match) return undefined
  return Math.floor(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / 1000)
}

export async function fetch(ctx) {
  const response = await ctx.fetch(LIST, { headers: { accept: 'text/html' } })

  if (!response.ok) {
    throw new Error(`公視新聞網返回 ${response.status} ${response.statusText}`)
  }

  const html = await response.text()
  const entries = []
  const seen = new Set()

  const heading = /<h3 class="project-main-title"><a href="([^"]+)"[^>]*>([\s\S]*?)<\/a><\/h3>/g

  for (const match of html.matchAll(heading)) {
    const url = match[1]
    if (seen.has(url)) continue
    seen.add(url)

    const next = html.indexOf('<h3 class="project-main-title"', match.index + 1)
    const block = html.slice(match.index, next === -1 ? undefined : next)

    const entry = {
      id: `pts:project:${url.split('/').filter(Boolean).pop()}`,
      title: strip(match[2]),
      url
    }

    const summary = /<p>([\s\S]*?)<\/p>/.exec(block)
    if (summary) {
      entry.summary = strip(summary[1])
    }

    const time = /<time[^>]*>([\s\S]*?)<\/time>/.exec(block)
    const publishedAt = time ? dateSeconds(strip(time[1])) : undefined
    if (publishedAt !== undefined) {
      entry.publishedAt = publishedAt
    }

    entries.push(entry)
  }

  if (entries.length === 0) {
    throw new Error('公視新聞網數位敘事页面结构已变化，未找到专题')
  }

  return { entries }
}

export async function preview(ctx) {
  const url = ctx.item?.url
  if (!url) return null
  const content = await ctx.article(url)
  return content === null ? null : { content }
}
