// Ported from OpenCLI clis/stackoverflow/search.js (Apache-2.0).
// Stack Overflow 搜索 — the public Stack Exchange API, search/advanced.
//
// The one argument that is not a page size is the query itself; everything
// else is the adapter's `sort=relevance` request.

export const meta = {
  id: 'rome.opencli-stackoverflow-search',
  name: 'Stack Overflow · 搜索',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: '按关键词搜索 Stack Overflow 问题。',
  icon: 'https://stackoverflow.com/favicon.ico',
  params: {
    fields: [
      {
        key: 'query',
        type: 'text',
        label: '搜索词',
        help: '要搜索的关键词',
        default: '',
      },
      {
        key: 'limit',
        type: 'number',
        label: '条数',
        help: '每次抓取的条目数',
        default: 10,
        min: 1,
        max: 100,
      },
    ],
  },
}

const API = 'https://api.stackexchange.com/2.3/search/advanced'

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

/// The API HTML-escapes titles and display names (`&#233;`, `&amp;`), and there
/// is no DOM here to let the browser do it.
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

function integer(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10)

  if (!Number.isFinite(parsed)) {
    return fallback
  }

  return Math.min(Math.max(parsed, min), max)
}

function summary(question) {
  const parts = [
    `${question.score ?? 0} 分`,
    `${question.answer_count ?? 0} 个回答`,
    `${question.view_count ?? 0} 次浏览`,
  ]

  if (question.is_answered) {
    parts.push('已解决')
  }

  if (Array.isArray(question.tags) && question.tags.length > 0) {
    parts.push(question.tags.map((tag) => `#${tag}`).join(' '))
  }

  return parts.join(' · ')
}

function toEntries(items, limit) {
  const entries = []

  for (const question of items) {
    if (!question.question_id || !question.title) {
      continue
    }

    const entry = {
      id: `so:${question.question_id}`,
      title: decode(question.title).trim(),
      url: question.link,
      summary: summary(question),
    }

    if (question.owner?.display_name) {
      entry.author = decode(question.owner.display_name).trim()
    }

    // Stack Exchange dates are already unix seconds.
    if (Number.isFinite(question.creation_date)) {
      entry.publishedAt = question.creation_date
    }

    entries.push(entry)

    if (entries.length >= limit) {
      break
    }
  }

  return entries
}

export async function fetch(ctx) {
  const text = String(ctx.params.query ?? '').trim()
  const limit = integer(ctx.params.limit, 10, 1, 100)

  if (!text) {
    throw new Error('请先填写搜索关键词')
  }

  const params = new URLSearchParams({
    order: 'desc',
    sort: 'relevance',
    q: text,
    site: 'stackoverflow',
    pagesize: String(limit),
  })

  ctx.log.debug(`stackoverflow-search: GET ${API}?${params}`)

  const response = await ctx.fetch(`${API}?${params}`, {
    headers: { accept: 'application/json' },
  })

  if (!response.ok) {
    throw new Error(`Stack Overflow 返回 ${response.status} ${response.statusText}`)
  }

  const payload = await response.json()

  if (!Array.isArray(payload.items)) {
    throw new Error('Stack Overflow 没有返回问题数组，接口可能已经变了')
  }

  // An empty list is a valid search answer, so it is not treated as a break.
  return { entries: toEntries(payload.items, limit) }
}

// Question pages are server-rendered, so the host's extractor can read the
// question and its answers when the entry is opened.
export async function preview(ctx) {
  const content = await ctx.article(ctx.item.url)

  return content === null ? null : { content }
}
