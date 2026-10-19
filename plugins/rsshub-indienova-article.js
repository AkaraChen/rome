// Ported from RSSHub lib/routes/indienova/article.ts (AGPL-3.0).
// indienova 文章 — 抓取资讯频道或开发频道的列表。
//
// 运行时没有 DOM，所以按 article-panel 块切分 HTML 再取字段。列表页已经带了
// 标题、摘要和标题图，正文留给 preview，一次刷新只发一个请求。

export const meta = {
  id: 'rome.rsshub-indienova-article',
  name: 'indienova 独立游戏 · 文章',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: 'indienova 独立游戏资讯与开发文章',
  icon: 'https://indienova.com/favicon.ico',
  params: {
    fields: [
      {
        key: 'type',
        type: 'select',
        label: '类型',
        help: 'article 为资讯，development 为开发文章',
        default: '',
        required: true,
        options: [
          { value: 'article', label: '文章' },
          { value: 'development', label: '开发' },
        ],
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

  // One block per card; the next card starts a new block.
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
      // The article path is slug-based and permanent, which is more stable than
      // the headline if the editors retitle a post.
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
  const type = ctx.params.type

  if (!type) {
    throw new Error('请填写类型：article（文章）或 development（开发）')
  }
  if (type !== 'article' && type !== 'development') {
    throw new Error(`不支持的类型 ${type}，只能是 article 或 development`)
  }

  const url = type === 'development'
    ? `${BASE}/indie-game-development/`
    : `${BASE}/indie-game-news/`

  ctx.log.debug(`indienova: GET ${url}`)

  const response = await ctx.fetch(url, { headers: { accept: 'text/html' } })

  if (!response.ok) {
    throw new Error(`indienova 返回 ${response.status} ${response.statusText}`)
  }

  const html = await response.text()
  const entries = parseList(html)

  if (entries.length === 0) {
    throw new Error('indienova 列表页没有解析到文章，页面结构可能已经改变')
  }

  return { entries, icon: `${BASE}/favicon.ico` }
}

// 打开条目时才读正文；列表刷新不会逐篇请求。
export async function preview(ctx) {
  if (!ctx.item?.url) return null
  const content = await ctx.article(ctx.item.url)
  return content === null ? null : { content }
}
