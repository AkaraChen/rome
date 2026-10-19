// Ported from OpenCLI clis/openalex/search.js (Apache-2.0).
// OpenAlex 论文搜索 — OpenCLI's `openalex search` command.
//
// OpenAlex's Works index is free and unauthenticated. The adapter asks for a
// narrow `select=` projection, so this ports that projection rather than
// fetching fields nobody reads.
//
// Ported from clis/openalex/search.js and clis/openalex/utils.js.

export const meta = {
  id: 'rome.opencli-openalex-search',
  name: 'OpenAlex · 论文搜索',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: '按关键词搜索 OpenAlex 的学术作品',
  icon: 'https://openalex.org/favicon.ico',
  params: {
    fields: [
      {
        key: 'query',
        type: 'text',
        label: '关键词',
        help: '搜索词，例如 transformers、open access scholarly',
        default: '',
      },
      {
        key: 'limit',
        type: 'number',
        label: '条数',
        help: '最多返回多少条（1-200，单页）',
        default: 20,
      },
    ],
  },
}

const API = 'https://api.openalex.org/works'

// The same projection the adapter uses. Adding fields here changes the wire
// request, so keep it in sync with the mapping below.
const SELECT_FIELDS = [
  'id',
  'doi',
  'title',
  'publication_year',
  'publication_date',
  'cited_by_count',
  'authorships',
  'primary_location',
  'open_access',
  'type',
].join(',')

function integer(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10)

  if (!Number.isFinite(parsed)) {
    return fallback
  }

  return Math.min(Math.max(parsed, min), max)
}

/// OpenAlex returns full URLs as ids; the bare `W…` form is what the site
/// address is made from.
function bareId(value) {
  return String(value ?? '')
    .trim()
    .replace(/^https?:\/\/(?:api\.)?openalex\.org\//i, '')
    .replace(/^works\//i, '')
}

/// Strip the resolver prefix so a DOI reads as `10.…`.
function bareDoi(value) {
  return String(value ?? '').trim().replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '')
}

function count(value) {
  const number = Number(value)
  return Number.isFinite(number) ? String(number).replace(/\B(?=(\d{3})+(?!\d))/g, ',') : ''
}

function seconds(value) {
  if (!value) return undefined

  const milliseconds = Date.parse(`${value}T00:00:00Z`)
  return Number.isFinite(milliseconds) ? Math.floor(milliseconds / 1000) : undefined
}

function toEntry(work) {
  const id = bareId(work?.id)

  if (!id) {
    throw new Error('OpenAlex 返回了一条没有作品编号的记录，接口可能已经变了')
  }

  const year = work.publication_year != null ? Number(work.publication_year) : null
  const citations = work.cited_by_count != null ? Number(work.cited_by_count) : null
  const firstAuthor = Array.isArray(work.authorships) && work.authorships.length > 0
    ? String(work.authorships[0]?.author?.display_name ?? '').trim()
    : ''
  const venue = String(work.primary_location?.source?.display_name ?? '').trim()
  const openAccess = Boolean(work.open_access?.is_oa)
  const type = String(work.type ?? '').trim()
  const doi = bareDoi(work.doi)

  const parts = []

  if (year !== null) parts.push(String(year))
  if (citations !== null) parts.push(`${count(citations)} 次引用`)
  if (venue) parts.push(venue)
  if (openAccess) parts.push('开放获取')
  if (type) parts.push(type)
  if (doi) parts.push(`DOI ${doi}`)

  const entry = {
    // OpenAlex's own Work id is permanent and is what the site URL uses.
    id: `openalex:${id}`,
    title: String(work.title ?? '').trim() || '（无标题）',
    url: `https://openalex.org/${id}`,
  }

  if (firstAuthor) entry.author = firstAuthor
  if (parts.length > 0) entry.summary = parts.join(' · ')

  const publishedAt = seconds(work.publication_date)
  if (publishedAt !== undefined) entry.publishedAt = publishedAt

  return entry
}

export async function fetch(ctx) {
  const query = String(ctx.params?.query ?? '').trim()

  if (!query) {
    throw new Error('请填写搜索关键词')
  }

  const limit = integer(ctx.params?.limit, 20, 1, 200)
  const url = `${API}?search=${encodeURIComponent(query)}&per-page=${limit}&select=${SELECT_FIELDS}`

  ctx.log.debug(`opencli-openalex-search: GET ${url}`)

  const response = await ctx.fetch(url, {
    headers: {
      accept: 'application/json',
      'user-agent': 'rome-opencli-openalex',
    },
  })

  if (!response.ok) {
    // OpenAlex explains throttling and bad queries in `message`; that text is
    // more useful than the status alone.
    const detail = await response.text().catch(() => '')
    const message = /"message"\s*:\s*"([^"]+)"/.exec(detail)
    throw new Error(`OpenAlex 返回 ${response.status}${message ? `：${message[1]}` : ''}`)
  }

  const body = await response.json()

  if (!Array.isArray(body?.results)) {
    throw new Error('OpenAlex 没有返回 results 数组，接口可能已经变了')
  }

  if (body.results.length === 0) {
    throw new Error(`OpenAlex 没有找到与 "${query}" 匹配的作品`)
  }

  const entries = body.results.slice(0, limit).map(toEntry)

  ctx.log.info(`opencli-openalex-search: ${entries.length} 条（${query}）`)

  return { entries }
}
