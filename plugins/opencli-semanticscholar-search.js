// Ported from OpenCLI clis/semanticscholar/search.js (Apache-2.0).
// Semantic Scholar 论文搜索 — OpenCLI's `semanticscholar search` command.
//
// The public Graph API answers anonymous reads. The adapter retries once on
// 429 because anonymous traffic has a small burst budget; that behaviour is
// kept here rather than failing a refresh on the first throttle.
//
// Ported from clis/semanticscholar/search.js and utils.js.

export const meta = {
  id: 'rome.opencli-semanticscholar-search',
  name: 'Semantic Scholar · 论文搜索',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: '按关键词搜索 Semantic Scholar 论文',
  icon: 'https://www.semanticscholar.org/favicon.ico',
  params: {
    fields: [
      {
        key: 'query',
        type: 'text',
        label: '关键词',
        help: '搜索词，例如 attention is all you need、diffusion model',
        default: '',
      },
      {
        key: 'limit',
        type: 'number',
        label: '条数',
        help: '最多返回多少条（1-100，单页）',
        default: 20,
      },
    ],
  },
}

const API = 'https://api.semanticscholar.org/graph/v1/paper/search'

const FIELDS = [
  'paperId',
  'title',
  'year',
  'authors',
  'citationCount',
  'externalIds',
].join(',')

function integer(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10)

  if (!Number.isFinite(parsed)) {
    return fallback
  }

  return Math.min(Math.max(parsed, min), max)
}

function count(value) {
  const number = Number(value)
  return Number.isFinite(number) ? String(number).replace(/\B(?=(\d{3})+(?!\d))/g, ',') : ''
}

function firstAuthor(authors) {
  if (!Array.isArray(authors) || authors.length === 0) return ''

  const name = authors[0]?.name
  return typeof name === 'string' ? name.trim() : ''
}

function toEntry(paper) {
  const paperId = String(paper?.paperId ?? '').trim()
  const title = String(paper?.title ?? '').trim()

  // Both are the address of the result. An empty one would collide with the
  // next malformed row, so fail loudly instead.
  if (!paperId || !title) {
    throw new Error('Semantic Scholar 返回了一条缺少 paperId 或标题的记录，接口可能已经变了')
  }

  const year = paper.year != null && Number.isFinite(Number(paper.year)) ? Number(paper.year) : null
  const citations = paper.citationCount != null && Number.isFinite(Number(paper.citationCount))
    ? Number(paper.citationCount)
    : null
  const doi = typeof paper.externalIds?.DOI === 'string' ? paper.externalIds.DOI.trim() : ''
  const author = firstAuthor(paper.authors)

  const parts = []

  if (year !== null) parts.push(String(year))
  if (citations !== null) parts.push(`${count(citations)} 次引用`)
  if (doi) parts.push(`DOI ${doi}`)

  const entry = {
    id: `semanticscholar:${paperId}`,
    title,
    url: typeof paper.url === 'string' && paper.url.trim()
      ? paper.url.trim()
      : `https://www.semanticscholar.org/paper/${paperId}`,
  }

  if (author) entry.author = author
  if (parts.length > 0) entry.summary = parts.join(' · ')

  // The API gives a year, not a day. January 1 is the smallest claim that is
  // still true, and it keeps year-ordered feeds sorted correctly.
  if (year !== null) {
    entry.publishedAt = Math.floor(Date.UTC(year, 0, 1) / 1000)
  }

  return entry
}

async function request(ctx, url) {
  for (let attempt = 0; ; attempt += 1) {
    const response = await ctx.fetch(url, {
      headers: {
        accept: 'application/json',
        'user-agent': 'rome-opencli-semanticscholar',
      },
    })

    // One retry covers the usual burst-then-cool-down case. A second 429 is
    // reported rather than hammered.
    if (response.status === 429 && attempt === 0) {
      ctx.log.warn('opencli-semanticscholar-search: 429，1.5 秒后重试一次')
      await new Promise((resolve) => setTimeout(resolve, 1500))
      continue
    }

    return response
  }
}

export async function fetch(ctx) {
  const query = String(ctx.params?.query ?? '').trim()

  if (!query) {
    throw new Error('请填写搜索关键词')
  }

  const limit = integer(ctx.params?.limit, 20, 1, 100)
  const url = `${API}?query=${encodeURIComponent(query)}&limit=${limit}&fields=${FIELDS}`

  ctx.log.debug(`opencli-semanticscholar-search: GET ${url}`)

  const response = await request(ctx, url)

  if (response.status === 429) {
    throw new Error('Semantic Scholar 限制了匿名请求频率，请稍后再试')
  }

  if (!response.ok) {
    throw new Error(`Semantic Scholar 返回 ${response.status} ${response.statusText}`)
  }

  const body = await response.json()

  if (body && typeof body === 'object' && body.error) {
    throw new Error(`Semantic Scholar 返回错误：${body.error}`)
  }

  if (!Array.isArray(body?.data)) {
    throw new Error('Semantic Scholar 没有返回 data 数组，接口可能已经变了')
  }

  if (body.data.length === 0) {
    throw new Error(`Semantic Scholar 没有找到与 "${query}" 匹配的论文`)
  }

  const entries = body.data.slice(0, limit).map(toEntry)

  ctx.log.info(`opencli-semanticscholar-search: ${entries.length} 条（${query}）`)

  return { entries }
}
