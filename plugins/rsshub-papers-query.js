// Ported from RSSHub lib/routes/papers/query.ts (AGPL-3.0).
// Cool Papers — arXiv 关键词搜索。
//
// 搜索结果页自己带 Atom feed，读它比解析 HTML 稳。feed 一次给上千条，
// 这里截前 50 条。

export const meta = {
  id: 'rome.rsshub-papers-query',
  name: 'Cool Papers · 搜索',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: '按关键词搜索 Cool Papers 上的 arXiv 论文',
  icon: 'https://papers.cool/favicon.ico',
  params: {
    fields: [
      {
        key: 'keyword',
        type: 'text',
        label: '关键词',
        help: '要搜索的关键词，例如 Detection',
        default: '',
      },
    ],
  },
}

const LIMIT = 50

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

function unwrap(text) {
  return String(text ?? '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim()
}

function tag(block, name) {
  const match = new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`).exec(block)
  return match ? decode(unwrap(match[1])) : ''
}

function seconds(value) {
  const milliseconds = Date.parse(value)
  return Number.isFinite(milliseconds) ? Math.floor(milliseconds / 1000) : undefined
}

export async function fetch(ctx) {
  const keyword = String(ctx.params.keyword || '').trim()

  if (!keyword) {
    throw new Error('请填写搜索关键词')
  }

  const url = `https://papers.cool/arxiv/search/feed?query=${encodeURIComponent(keyword)}`

  ctx.log.debug(`papers: GET ${url}`)

  const response = await ctx.fetch(url, { headers: { accept: 'application/atom+xml' } })

  if (!response.ok) {
    throw new Error(`Cool Papers 返回 ${response.status} ${response.statusText}`)
  }

  const xml = await response.text()
  const blocks = xml.split('<entry>').slice(1)
  const entries = []

  for (const block of blocks.slice(0, LIMIT)) {
    const id = tag(block, 'id')
    const title = tag(block, 'title')
    const link = /<link\b[^>]*\bhref="([^"]+)"/.exec(block)?.[1]
    const paperId = /arxiv\/([^/<\s]+)\s*$/.exec(id)?.[1] || (link ? /arxiv\/([^/<\s]+)\s*$/.exec(link)?.[1] : null)

    if (!title || !paperId) continue

    const entry = {
      id: `papers-query:${paperId}`,
      title,
      url: link ? decode(link) : `https://papers.cool/arxiv/${paperId}`,
      params: { paperId },
    }

    const authors = []
    for (const author of block.matchAll(/<author\b[^>]*>([\s\S]*?)<\/author>/g)) {
      const name = tag(author[1], 'name')
      if (name) authors.push(name)
    }
    if (authors.length > 0) entry.author = authors.join(', ')

    const summary = tag(block, 'summary')
    if (summary) entry.summary = summary

    const publishedAt = seconds(tag(block, 'updated') || tag(block, 'published'))
    if (publishedAt !== undefined) entry.publishedAt = publishedAt

    entries.push(entry)
  }

  if (entries.length === 0) {
    throw new Error('Cool Papers 搜索没有返回结果，关键词可能没有匹配的论文')
  }

  ctx.log.info(`papers: ${keyword} 共 ${entries.length} 篇`)

  return { entries }
}

export async function preview(ctx) {
  const paperId = ctx.item?.params?.paperId
  if (!paperId) return null

  const content = await ctx.article(`https://papers.cool/arxiv/${paperId}`)
  return content === null ? null : { content }
}
