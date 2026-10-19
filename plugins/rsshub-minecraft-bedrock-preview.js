// Ported from RSSHub lib/routes/minecraft/bedrock-preview.ts (AGPL-3.0).
// Minecraft 基岩版 Beta 与预览版更新日志 — the feedback site's help centre
// API, one JSON request. Each article carries its own changelog body.

export const meta = {
  id: 'rome.rsshub-minecraft-bedrock-preview',
  name: 'Minecraft · Bedrock Beta and Preview changelogs',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: 'Minecraft 基岩版 Beta 与预览版更新日志',
  icon: 'https://www.minecraft.net/favicon.ico',
}

const SECTION = '360001185332'
const API = `https://feedback.minecraft.net/api/v2/help_center/en-us/sections/${SECTION}/articles.json?sort_by=created_at&sort_order=desc`
const LIMIT = 30

const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  ndash: '–', mdash: '—', hellip: '…', lsquo: '‘', rsquo: '’',
  ldquo: '“', rdquo: '”', middot: '·',
}

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

function plain(html, limit) {
  const text = decode(String(html ?? '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim()
  if (!limit || text.length <= limit) return text
  return `${text.slice(0, limit).replace(/\s+$/, '')}…`
}

// The article body opens with a "Posted:" line that repeats the date the API
// already gives us, so it is dropped.
function body(html) {
  return String(html ?? '').replace(/<p>\s*<strong>\s*Posted:[\s\S]*?<\/p>/gi, '')
}

export async function fetch(ctx) {
  ctx.log.debug(`minecraft-bedrock-preview: GET ${API}`)

  const response = await ctx.fetch(API, { headers: { accept: 'application/json' } })

  if (!response.ok) {
    throw new Error(`Minecraft 反馈站返回 ${response.status} ${response.statusText}`)
  }

  const data = await response.json()
  const articles = Array.isArray(data?.articles) ? data.articles : []

  if (articles.length === 0) {
    throw new Error('Minecraft 反馈站没有返回更新日志，接口可能已经变了')
  }

  const entries = articles.slice(0, LIMIT).map((article) => {
    const content = body(article.body)
    const entry = {
      id: `minecraft:bedrock:${article.id}`,
      title: article.title,
      url: article.html_url,
      summary: plain(content, 160),
    }

    if (content) entry.content = content

    const publishedAt = Math.floor(Date.parse(article.created_at) / 1000)
    if (Number.isFinite(publishedAt)) entry.publishedAt = publishedAt

    return entry
  })

  ctx.log.info(`minecraft-bedrock-preview: ${entries.length} 篇更新日志`)

  return { entries, icon: 'https://www.minecraft.net/favicon.ico' }
}
