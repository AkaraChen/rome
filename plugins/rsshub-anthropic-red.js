// Ported from RSSHub lib/routes/anthropic/red.ts (AGPL-3.0).
// Anthropic 前沿红队 — RSSHub 的 /anthropic/red 路由。
//
// RSSHub 的实现找的是 red.anthropic.com 上的 a[class^="note"]，但那个站点
// 现在已经整站 301 到 https://www.anthropic.com/research/team/frontier-red-team，
// note 卡片不复存在。落在的是研究团队页，文章列表和 /research 同一种形状：
// <a class="…__listItem"> 带 <time> 和分类。所以这里按新页面解析，
// 万一 301 没被跟随，再直接取一次团队页。

export const meta = {
  id: 'rome.rsshub-anthropic-red',
  name: 'Anthropic · 前沿红队',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: 'Anthropic 前沿红队发布的文章',
  icon: 'https://www.anthropic.com/favicon.ico',
}

const BASE = 'https://www.anthropic.com'
const LINK = 'https://red.anthropic.com/'
const TEAM = `${BASE}/research/team/frontier-red-team`

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

const MONTHS = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
}

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

function text(html) {
  return decode(String(html ?? '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim()
}

/// 「Oct 16, 2026」→ 秒。认不出来就返回 undefined。
function seconds(input) {
  const match = /([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),\s*(\d{4})/.exec(String(input ?? ''))

  if (!match) return undefined

  const month = MONTHS[match[1].toLowerCase()]

  if (!month) return undefined

  return Math.floor(Date.UTC(Number(match[3]), month - 1, Number(match[2])) / 1000)
}

function parseList(html) {
  const entries = []

  for (const list of html.matchAll(/<ul class="PublicationList-module-scss-module__[^"]*__list">([\s\S]*?)<\/ul>/g)) {
    for (const chunk of list[1].split(/<li\b/).slice(1)) {
      const anchor = /<a\b[^>]*\bhref="([^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(chunk)

      if (!anchor) continue

      const title = /__title[^"]*"[^>]*>([\s\S]*?)<\/span>/.exec(anchor[2])

      if (!title) continue

      const heading = text(title[1])

      if (!heading) continue

      const href = decode(anchor[1])
      const url = href.startsWith('http') ? href : `${BASE}${href}`

      const entry = {
        id: `anthropic:${new URL(url).pathname}`,
        title: heading,
        url,
      }

      const date = /<time[^>]*>([\s\S]*?)<\/time>/.exec(anchor[2])
      const publishedAt = seconds(text(date?.[1]))

      if (publishedAt !== undefined) entry.publishedAt = publishedAt

      const category = /__subject[^"]*"[^>]*>([\s\S]*?)<\/span>/.exec(anchor[2])

      if (category) {
        const subject = text(category[1])
        if (subject) entry.summary = subject
      }

      entries.push(entry)
    }
  }

  return entries
}

async function load(ctx, url) {
  ctx.log.debug(`anthropic: GET ${url}`)

  const response = await ctx.fetch(url, { headers: { accept: 'text/html' } })

  if (!response.ok) {
    throw new Error(`Anthropic 返回 ${response.status} ${response.statusText}`)
  }

  return response.text()
}

export async function fetch(ctx) {
  let entries = parseList(await load(ctx, LINK))

  // 301 没被跟随的话拿到的还是旧站的壳，再直接取一次团队页。
  if (entries.length === 0) {
    entries = parseList(await load(ctx, TEAM))
  }

  if (entries.length === 0) {
    throw new Error('Anthropic 前沿红队页里没有读到任何条目，页面结构可能已经变了')
  }

  ctx.log.info(`anthropic: 前沿红队 ${entries.length} 条`)

  return { entries }
}

export async function preview(ctx) {
  const url = ctx.item?.url

  if (!url) return null

  const content = await ctx.article(url)

  return content === null ? null : { content }
}
