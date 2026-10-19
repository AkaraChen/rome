// Ported from RSSHub lib/routes/indienova/column.ts (AGPL-3.0).
// indienova 专题 — 和资讯列表同一种卡片，只是 URL 换成 /column/<id>。
//
// 专题 ID 是路径里的正整数（52 是 itch 一周游戏汇，29 是每周发售作品），
// 站点没有给专题名做列表，所以标题直接用 ID。

export const meta = {
  id: 'rome.rsshub-indienova-column',
  name: 'indienova 独立游戏 · 专题',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: 'indienova 按专题聚合的文章列表',
  icon: 'https://indienova.com/favicon.ico',
  params: {
    fields: [
      {
        key: 'columnId',
        type: 'text',
        label: '专题 ID',
        help: '专题 URL 中的数字，例如 52 为 itch 一周游戏汇',
        default: '',
        required: true,
      },
    ],
  },
}

const BASE = 'https://indienova.com'

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

function absolute(href, base) {
  try {
    return new URL(decode(href), base).href
  } catch {
    return null
  }
}

function idFromUrl(url) {
  try {
    return new URL(url).pathname.replace(/\/+$/, '') || url
  } catch {
    return url
  }
}

function parseList(html) {
  const entries = []

  for (const block of html.split('<div class="article-panel').slice(1)) {
    const title = /<h4>\s*<a href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(block)
    if (!title) continue

    const url = absolute(title[1], BASE)
    const heading = stripTags(title[2])
    if (!url || !heading) continue

    const summary = /<\/h4>\s*<p>([\s\S]*?)<\/p>/.exec(block)
    const image = /<img[^>]+src="([^"]+)"/.exec(block)
    const votes = /<span class="number-first">(\d+)<\/span>/.exec(block)
    const comments = /<span class="number-last">(\d+)<\/span>/.exec(block)

    const entry = {
      id: `indienova:${idFromUrl(url)}`,
      title: heading,
      url,
    }

    if (summary) {
      const text = stripTags(summary[1])
      if (text) entry.summary = text
    }
    if (image) entry.image = absolute(image[1], BASE)

    const counts = []
    if (votes) counts.push(`赞 ${votes[1]}`)
    if (comments) counts.push(`评论 ${comments[1]}`)
    if (counts.length > 0) entry.summary = [entry.summary, counts.join(' · ')].filter(Boolean).join(' · ')

    entries.push(entry)
  }

  return entries
}

export async function fetch(ctx) {
  const columnId = String(ctx.params.columnId ?? '').trim()

  if (!columnId) {
    throw new Error('请填写专题 ID（正整数）')
  }
  if (!/^\d+$/.test(columnId) || !/[1-9]/.test(columnId)) {
    throw new Error(`专题 ID ${columnId} 无效，应为正整数`)
  }

  const url = `${BASE}/column/${columnId}`

  ctx.log.debug(`indienova: GET ${url}`)

  const response = await ctx.fetch(url, { headers: { accept: 'text/html' } })

  if (!response.ok) {
    throw new Error(`indienova 专题返回 ${response.status} ${response.statusText}`)
  }

  const html = await response.text()
  const entries = parseList(html)

  if (entries.length === 0) {
    throw new Error(`indienova 专题 ${columnId} 没有解析到文章，页面结构或专题 ID 可能已经改变`)
  }

  return { entries, icon: `${BASE}/favicon.ico` }
}

export async function preview(ctx) {
  if (!ctx.item?.url) return null
  const content = await ctx.article(ctx.item.url)
  return content === null ? null : { content }
}
