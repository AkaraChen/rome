// Ported from RSSHub lib/routes/modelscope/learn.ts (AGPL-3.0).
// ModelScope 魔搭社区 · 研习社 — ported from RSSHub's /modelscope/learn.
//
// The article index is a JSON endpoint that already carries the body. `Content`
// is a JSON-encoded tree of `[tag, attributes, ...children]` tuples, so it is
// rendered here rather than fetched again; when an article has no body the API
// falls back to `Desc`, and a course stores its chapters in `CourseInfo`.

export const meta = {
  id: 'rome.rsshub-modelscope-learn',
  name: 'ModelScope 魔搭社区 · 研习社',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: '魔搭研习社最新文章与课程，含正文、作者与领域标签',
  icon: 'https://modelscope.cn/favicon.ico',
}

const BASE = 'https://www.modelscope.cn'
const LIST = `${BASE}/api/v1/dolphin/articles`

// Attributes the editor writes for its own bookkeeping; they mean nothing in a
// reader and only add noise to the markup.
const USELESS_ATTRS = new Set(['data-type', 'ind', 'jc', 'list', 'metadata', 'newcode', 'spacing', 'subtype', 'sz', 'szunit', 'uuid'])

const ALLOWED_TAGS = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'img', 'code', 'pre', 'a', 'ul', 'ol', 'li', 'strong', 'em', 'br', 'hr', 'table', 'thead', 'tbody', 'tr', 'th', 'td'])

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function unixFromSeconds(value) {
  const seconds = Number(value)
  return Number.isFinite(seconds) ? Math.floor(seconds) : undefined
}

function parseJson(value, fallback) {
  if (typeof value !== 'string' || value.trim() === '') return fallback
  try {
    return JSON.parse(value)
  } catch {
    return fallback
  }
}

/// One `[tag, attributes, ...children]` node. A tag the reader does not know is
/// unwrapped rather than dropped, so its text survives.
function renderNode(node) {
  if (typeof node === 'string') return escapeHtml(node)
  if (!Array.isArray(node)) return ''

  const [tag, rawAttributes, ...children] = node

  if (typeof tag !== 'string') return ''

  if (tag === 'text') {
    const attributes = rawAttributes && typeof rawAttributes === 'object' ? rawAttributes : {}
    return escapeHtml(attributes.text ?? '')
  }

  const body = children.map(renderNode).join('')

  if (!ALLOWED_TAGS.has(tag)) return body

  if (tag === 'img') {
    const attributes = rawAttributes && typeof rawAttributes === 'object' ? rawAttributes : {}
    return attributes.src ? `<img src="${escapeHtml(attributes.src)}">` : ''
  }

  if (tag === 'br' || tag === 'hr') return `<${tag}>`

  const attributes = rawAttributes && typeof rawAttributes === 'object' ? rawAttributes : {}
  const attrs = Object.keys(attributes)
    .filter((key) => !USELESS_ATTRS.has(key) && ['href', 'src', 'alt', 'title', 'lang'].includes(key))
    .map((key) => ` ${key}="${escapeHtml(attributes[key])}"`)
    .join('')

  return `<${tag}${attrs}>${body}</${tag}>`
}

/// `Content` is a JSON array of nodes; `CourseInfo` is an array of chapters,
/// each optionally carrying its own `Content`.
function bodyOf(article) {
  const content = parseJson(article.Content, null)
  if (Array.isArray(content) && content.length > 0) {
    return content.map(renderNode).join('')
  }

  const course = parseJson(article.CourseInfo, [])
  if (Array.isArray(course)) {
    const rendered = course
      .map((chapter) => {
        const nodes = parseJson(chapter && chapter.Content, null)
        return Array.isArray(nodes) ? nodes.map(renderNode).join('') : ''
      })
      .join('')
    if (rendered) return rendered
  }

  return article.Desc ? `<p>${escapeHtml(article.Desc)}</p>` : ''
}

export async function fetch(ctx) {
  const response = await ctx.fetch(LIST, {
    method: 'POST',
    headers: { accept: 'application/json', referer: `${BASE}/learn` },
    body: {
      PageNumber: 1,
      PageSize: 18,
      Type: 2,
      Sort: 'gmt_modified',
      Query: '',
      ExcludeIds: [1558, 1436, 881, 399, 1129],
      IsCourse: [0, 1],
    },
  })

  if (!response.ok) {
    throw new Error(`魔搭返回 ${response.status} ${response.statusText}`)
  }

  const body = await response.json()
  const articles = body && body.Data && body.Data.Articles

  if (!Array.isArray(articles)) {
    throw new Error('魔搭没有返回文章列表，接口可能已经变了')
  }

  const entries = []

  for (const article of articles) {
    if (!article || !article.Id || !article.Title) continue

    const domains = parseJson(article.Domains, [])
    const subjects = parseJson(article.Subjects, [])
    const tags = [...new Set([...(Array.isArray(domains) ? domains : []), ...(Array.isArray(subjects) ? subjects : [])])]

    const entry = {
      id: `modelscope:learn:${article.Id}`,
      title: article.Title,
      url: `${BASE}/learn/${article.Id}`,
      author: article.CreatedBy || undefined,
      summary: [article.Desc, tags.join(' · ')].filter(Boolean).join(' · ') || undefined,
      content: bodyOf(article),
    }

    if (article.ImageUrl) entry.image = article.ImageUrl

    const publishedAt = unixFromSeconds(article.GmtCreated)
    if (publishedAt !== undefined) entry.publishedAt = publishedAt

    entries.push(entry)
  }

  if (entries.length === 0) {
    throw new Error('魔搭研习社列表为空，接口可能已经变了')
  }

  ctx.log.info(`modelscope-learn: ${entries.length} 条`)

  return { entries, icon: 'https://modelscope.cn/favicon.ico' }
}
