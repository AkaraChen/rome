// Ported from RSSHub lib/routes/papers/category.ts (AGPL-3.0).
// Cool Papers — arXiv 分类。
//
// 分类页把每篇论文写成一个 `<div class="panel paper">`，id 就是 arXiv 号。
// 一页给 50 篇，够用，所以不做翻页。正文留给 preview 去抓论文详情页。

export const meta = {
  id: 'rome.rsshub-papers-category',
  name: 'Cool Papers · 分类',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: '抓取 Cool Papers 某个 arXiv 分类的最新论文',
  icon: 'https://papers.cool/favicon.ico',
  params: {
    fields: [
      {
        key: 'id',
        type: 'text',
        label: '分类 id',
        help: '分类 id，可在对应分类页 URL 中找到，例如 arxiv/cs.AI',
        default: '',
      },
    ],
  },
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

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

function strip(text) {
  return decode(String(text ?? '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim()
}

/// 页面上的时间写作 `2026-10-16 17:57:55 UTC`，标准解析器不一定认，手动拆。
function utcDate(text) {
  const match = /(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})/.exec(text)
  if (!match) return undefined
  const [, year, month, day, hour, minute, second] = match
  return Math.floor(Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second)) / 1000)
}

export async function fetch(ctx) {
  const id = String(ctx.params.id || '').trim().replace(/^\/+|\/+$/g, '')

  if (!id) {
    throw new Error('请填写分类 id，例如 arxiv/cs.AI')
  }

  const url = `https://papers.cool/${id}?show=50`

  ctx.log.debug(`papers: GET ${url}`)

  const response = await ctx.fetch(url, { headers: { accept: 'text/html' } })

  if (!response.ok) {
    throw new Error(`Cool Papers 返回 ${response.status} ${response.statusText}`)
  }

  const html = await response.text()

  // 以论文容器的开标签切分，切出来是 [前言, id, 正文, id, 正文, ...]。
  const parts = html.split(/<div id="([^"]+)" class="panel paper"/)
  const entries = []

  for (let index = 1; index + 1 < parts.length; index += 2) {
    const paperId = parts[index]
    const block = parts[index + 1]
    const titleTag = /<a[^>]*class="title-link[^"]*"[^>]*>([\s\S]*?)<\/a>/.exec(block)
    const title = titleTag ? strip(titleTag[1]) : ''

    if (!title) continue

    const entry = {
      id: `papers-category:${paperId}`,
      title,
      url: `https://papers.cool/arxiv/${paperId}`,
      params: { paperId },
    }

    const authors = []
    for (const author of block.matchAll(/<a[^>]*class="author[^"]*"[^>]*>([\s\S]*?)<\/a>/g)) {
      const name = strip(author[1])
      if (name) authors.push(name)
    }
    if (authors.length > 0) entry.author = authors.join(', ')

    const summary = /<p[^>]*class="summary[^"]*"[^>]*>([\s\S]*?)<\/p>/.exec(block)
    if (summary) {
      const text = strip(summary[1])
      if (text) entry.summary = text
    }

    const date = /<span class="date-data">([\s\S]*?)<\/span>/.exec(block)
    if (date) {
      const publishedAt = utcDate(date[1])
      if (publishedAt !== undefined) entry.publishedAt = publishedAt
    }

    entries.push(entry)
  }

  if (entries.length === 0) {
    throw new Error('Cool Papers 分类页没有论文列表，分类 id 可能不存在')
  }

  ctx.log.info(`papers: ${id} 共 ${entries.length} 篇`)

  return { entries }
}

export async function preview(ctx) {
  const paperId = ctx.item?.params?.paperId
  if (!paperId) return null

  const content = await ctx.article(`https://papers.cool/arxiv/${paperId}`)
  return content === null ? null : { content }
}
