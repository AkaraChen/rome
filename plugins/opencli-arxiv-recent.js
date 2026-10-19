// Ported from OpenCLI clis/arxiv/recent.js (Apache-2.0).
// arXiv 最新论文 — OpenCLI's `arxiv recent` command.
//
// arXiv publishes an Atom feed at export.arxiv.org. No key, no cookies, no
// browser: one request returns the whole list, abstracts included.
//
// Ported from clis/arxiv/recent.js and clis/arxiv/utils.js.

export const meta = {
  id: 'rome.opencli-arxiv-recent',
  name: 'arXiv · 最新论文',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: '按 arXiv 分类抓取最新提交的论文',
  icon: 'https://arxiv.org/favicon.ico',
  params: {
    fields: [
      {
        key: 'category',
        type: 'text',
        label: '分类',
        help: 'arXiv 分类，例如 cs.CL、cs.LG、math.PR、q-bio.NC',
        default: '',
      },
      {
        key: 'limit',
        type: 'number',
        label: '条数',
        help: '最多返回多少条（最大 50）',
        default: 10,
      },
    ],
  },
}

const API = 'https://export.arxiv.org/api/query'

// arXiv category identifiers: an archive, optionally followed by a subject
// class. The adapter rejects anything else before it reaches the wire.
const CATEGORY = /^[a-z]+(?:-[a-z]+)*(?:\.[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*)?$/

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

/// The text of the first matching XML element, without its tags.
function first(xml, tag) {
  const match = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`).exec(xml)
  return match ? match[1].trim() : ''
}

/// Every text node of a repeated element, in document order.
function all(xml, tag) {
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'g')
  const values = []
  let match

  while ((match = re.exec(xml)) !== null) {
    values.push(match[1].trim())
  }

  return values
}

/// The value of an attribute on the first matching element. arXiv's
/// `<arxiv:primary_category>` is self-closing, so this cannot use `first`.
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

    // An entry without either is not addressable: its id would be empty and
    // every such item would collide with the next one.
    if (!arxivId || !title) {
      throw new Error('arXiv 返回了一条缺少编号或标题的记录，接口可能已经变了')
    }

    const authors = all(block, 'name').map(clean).filter(Boolean).join(', ')
    const primary = clean(attribute(block, 'arxiv:primary_category', 'term'))
    const comment = clean(first(block, 'arxiv:comment'))
    const abstract = clean(first(block, 'summary'))

    const entry = {
      // `arxivId` is the paper's permanent identifier and is what its URL
      // address is built from; the version suffix was stripped above.
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
  const category = String(ctx.params?.category ?? '').trim()

  if (!category) {
    throw new Error('请填写 arXiv 分类，例如 cs.CL')
  }

  if (!CATEGORY.test(category)) {
    throw new Error(`arXiv 分类 "${category}" 无效，例如 cs.CL、cs.LG、math.PR`)
  }

  const limit = integer(ctx.params?.limit, 10, 1, 50)

  // The category is the adapter's own query form, so the colon goes in
  // before the whole expression is encoded.
  const url = `${API}?search_query=${encodeURIComponent(`cat:${category}`)}&max_results=${limit}&sortBy=submittedDate&sortOrder=descending`

  ctx.log.debug(`opencli-arxiv-recent: GET ${url}`)

  const response = await ctx.fetch(url, { headers: { accept: 'application/atom+xml' } })

  if (!response.ok) {
    throw new Error(`arXiv 返回 ${response.status} ${response.statusText}`)
  }

  const entries = parseEntries(await response.text())

  if (entries.length === 0) {
    throw new Error(`分类 ${category} 下没有返回论文，请检查分类名称`)
  }

  ctx.log.info(`opencli-arxiv-recent: ${entries.length} 条（${category}）`)

  return { entries }
}
