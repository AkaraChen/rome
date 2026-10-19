// Ported from OpenCLI clis/arxiv/search.js (Apache-2.0).
// arXiv 论文搜索 — OpenCLI's `arxiv search` command.
//
// The same Atom feed as `arxiv recent`, queried across all fields and ordered
// by relevance. No key, no cookies, no browser.
//
// Ported from clis/arxiv/search.js and clis/arxiv/utils.js.

export const meta = {
  id: 'rome.opencli-arxiv-search',
  name: 'arXiv · 论文搜索',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: '按关键词搜索 arXiv 论文',
  icon: 'https://arxiv.org/favicon.ico',
  params: {
    fields: [
      {
        key: 'query',
        type: 'text',
        label: '关键词',
        help: '搜索词，例如 attention is all you need',
        default: '',
      },
      {
        key: 'limit',
        type: 'number',
        label: '条数',
        help: '最多返回多少条（最大 25）',
        default: 10,
      },
    ],
  },
}

const API = 'https://export.arxiv.org/api/query'

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

function decode(value) {
  return String(value).replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity) => {
    if (entity[0] === '#') {
      const code = entity[1] === 'x' || entity[1] === 'X'
        ? Number.parseInt(entity.slice(2), 16)
        : Number.parseInt(entity.slice(1), 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : match
    }

    return Object.prototype.hasOwnProperty.call(ENTITIES, entity) ? ENTITIES[entity] : match
  })
}

function first(xml, tag) {
  const match = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`).exec(xml)
  return match ? match[1].trim() : ''
}

function all(xml, tag) {
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'g')
  const values = []
  let match

  while ((match = re.exec(xml)) !== null) {
    values.push(match[1].trim())
  }

  return values
}

function attribute(xml, tag, name) {
  const match = new RegExp(`<${tag}\\b[^>]*?\\b${name}="([^"]*)"`).exec(xml)
  return match ? match[1] : ''
}

function clean(value) {
  return decode(String(value ?? '')).replace(/\s+/g, ' ').trim()
}

function integer(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10)

  if (!Number.isFinite(parsed)) {
    return fallback
  }

  return Math.min(Math.max(parsed, min), max)
}

function seconds(value) {
  const milliseconds = Date.parse(value)
  return Number.isFinite(milliseconds) ? Math.floor(milliseconds / 1000) : undefined
}

function parseEntries(xml) {
  const entries = []

  for (const match of xml.matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry>/g)) {
    const block = match[1]
    const rawId = first(block, 'id')
    const arxivId = rawId.replace(/^https?:\/\/arxiv\.org\/abs\//, '').replace(/v\d+$/, '')
    const title = clean(first(block, 'title'))

    if (!arxivId || !title) {
      throw new Error('arXiv 返回了一条缺少编号或标题的记录，接口可能已经变了')
    }

    const authors = all(block, 'name').map(clean).filter(Boolean).join(', ')
    const primary = clean(attribute(block, 'arxiv:primary_category', 'term'))
    const comment = clean(first(block, 'arxiv:comment'))
    const abstract = clean(first(block, 'summary'))

    const entry = {
      id: `arxiv:${arxivId}`,
      title,
      url: `https://arxiv.org/abs/${arxivId}`,
    }

    if (authors) entry.author = authors
    if (abstract) entry.content = abstract

    const summary = [primary, comment].filter(Boolean).join(' · ')
    if (summary) entry.summary = summary

    const publishedAt = seconds(first(block, 'published'))
    if (publishedAt !== undefined) entry.publishedAt = publishedAt

    entries.push(entry)
  }

  return entries
}

export async function fetch(ctx) {
  const query = String(ctx.params?.query ?? '').trim()

  if (!query) {
    throw new Error('请填写搜索关键词')
  }

  const limit = integer(ctx.params?.limit, 10, 1, 25)
  const url = `${API}?search_query=${encodeURIComponent(`all:${query}`)}&max_results=${limit}&sortBy=relevance`

  ctx.log.debug(`opencli-arxiv-search: GET ${url}`)

  const response = await ctx.fetch(url, { headers: { accept: 'application/atom+xml' } })

  if (!response.ok) {
    throw new Error(`arXiv 返回 ${response.status} ${response.statusText}`)
  }

  const entries = parseEntries(await response.text())

  if (entries.length === 0) {
    throw new Error(`arXiv 没有找到与 "${query}" 匹配的论文，请尝试其他关键词`)
  }

  ctx.log.info(`opencli-arxiv-search: ${entries.length} 条（${query}）`)

  return { entries }
}
