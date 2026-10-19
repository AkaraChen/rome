// Ported from OpenCLI clis/stackoverflow/hot.js (Apache-2.0).
// Stack Overflow 热门问题 — the public Stack Exchange API, sort=hot.
//
// One JSON request, no key, no page cursor: the API's own question id is the
// stable key.

export const meta = {
  id: 'rome.opencli-stackoverflow-hot',
  name: 'Stack Overflow · 热门问题',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: '抓取 Stack Overflow 当前的热门问题。',
  icon: 'https://stackoverflow.com/favicon.ico',
  params: {
    fields: [
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

const API = 'https://api.stackexchange.com/2.3/questions'

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
  const limit = integer(ctx.params.limit, 10, 1, 100)

  const query = new URLSearchParams({
    order: 'desc',
    sort: 'hot',
    site: 'stackoverflow',
    pagesize: String(limit),
  })

  ctx.log.debug(`stackoverflow-hot: GET ${API}?${query}`)

  const response = await ctx.fetch(`${API}?${query}`, {
    headers: { accept: 'application/json' },
  })

  if (!response.ok) {
    throw new Error(`Stack Overflow 返回 ${response.status} ${response.statusText}`)
  }

  const payload = await response.json()

  if (!Array.isArray(payload.items)) {
    throw new Error('Stack Overflow 没有返回问题数组，接口可能已经变了')
  }

  const entries = toEntries(payload.items, limit)

  if (entries.length === 0) {
    throw new Error('Stack Overflow 没有返回问题，接口可能已经变了')
  }

  return { entries }
}

// Question pages are server-rendered, so the host's extractor can read the
// question and its answers when the entry is opened.
export async function preview(ctx) {
  const content = await ctx.article(ctx.item.url)

  return content === null ? null : { content }
}
