// Ported from RSSHub lib/routes/infoq/recommend.ts (AGPL-3.0).
// InfoQ 中文 · 推荐 — ported from RSSHub's /infoq/recommend.
//
// The recommendation endpoint is a POST that takes only a page size and
// returns the articles complete with title, summary, cover, authors and
// publish time, so a refresh is one request. The full body lives behind a
// second POST (`getDetail`) and, for newer articles, a signed `content_url`
// holding a JSON document; both are read in `preview` only.

export const meta = {
  id: 'rome.rsshub-infoq-recommend',
  name: 'InfoQ 中文 · 推荐',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: 'InfoQ 中文推荐阅读，含摘要、封面与作者',
  icon: 'https://www.infoq.cn/favicon.ico',
}

const SITE = 'https://www.infoq.cn'
const LIST_API = `${SITE}/public/v1/my/recommond`
const DETAIL_API = `${SITE}/public/v1/article/getDetail`

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

/// `publish_time` is milliseconds; entries carry seconds.
function unixFromMilliseconds(value) {
  const milliseconds = Number(value)
  return Number.isFinite(milliseconds) ? Math.floor(milliseconds / 1000) : undefined
}

function authorLine(item) {
  const names = Array.isArray(item.author) ? item.author.map((person) => person && person.nickname).filter(Boolean) : []
  return names.length > 0 ? names.join(',') : item.no_author || undefined
}

// --- body rendering --------------------------------------------------------
// Newer articles ship a ProseMirror-style document: `{type: 'doc', content:
// [...]}`. Older ones still carry an HTML string, which is used as is.

function renderNodes(nodes) {
  return Array.isArray(nodes) ? nodes.map(renderNode).join('') : ''
}

function renderNode(node) {
  if (!node || typeof node !== 'object') return ''

  const children = renderNodes(node.content)
  const attrs = node.attrs && typeof node.attrs === 'object' ? node.attrs : {}

  switch (node.type) {
    case 'doc':
      return children
    case 'paragraph':
      return `<p>${children}</p>`
    case 'text':
      return escapeHtml(node.text ?? '')
    case 'heading':
      return children ? `<h${Number(attrs.level) || 2}>${children}</h${Number(attrs.level) || 2}>` : ''
    case 'blockquote':
      return children ? `<blockquote>${children}</blockquote>` : ''
    case 'image':
      return attrs.src ? `<img src="${escapeHtml(attrs.src)}">` : ''
    case 'codeblock':
      return children ? `<pre><code>${children}</code></pre>` : ''
    case 'link':
      return `<a href="${escapeHtml(attrs.href ?? '')}">${children}</a>`
    default:
      return children
  }
}

function renderBody(text) {
  const value = String(text ?? '').trim()
  if (value === '') return ''
  if (!value.startsWith('{')) return value
  try {
    return renderNode(JSON.parse(value))
  } catch {
    return ''
  }
}

async function post(ctx, url, body, referer) {
  const response = await ctx.fetch(url, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json', referer: referer || `${SITE}/` },
    body,
  })

  if (!response.ok) {
    throw new Error(`InfoQ 返回 ${response.status} ${response.statusText}`)
  }

  return response.json()
}

export async function fetch(ctx) {
  const body = await post(ctx, LIST_API, { size: 30 })
  const articles = body && body.data

  if (!Array.isArray(articles)) {
    throw new Error(`InfoQ 没有返回推荐列表（${(body && body.msg) || '未知原因'}），接口可能已经变了`)
  }

  const entries = []

  for (const item of articles) {
    if (!item || !item.uuid || !item.article_title) continue

    const image = item.article_cover || undefined
    const author = authorLine(item)

    const entry = {
      id: `infoq:recommend:${item.uuid}`,
      title: item.article_title,
      url: `${SITE}/article/${item.uuid}`,
      summary: item.article_summary || undefined,
      content: [
        image ? `<p><img src="${escapeHtml(image)}"></p>` : null,
        item.article_summary ? `<p>${escapeHtml(item.article_summary)}</p>` : null,
      ].filter(Boolean).join(''),
      params: { uuid: item.uuid },
    }

    if (author) entry.author = author
    if (image) entry.image = image

    const publishedAt = unixFromMilliseconds(item.publish_time)
    if (publishedAt !== undefined) entry.publishedAt = publishedAt

    entries.push(entry)
  }

  if (entries.length === 0) {
    throw new Error('InfoQ 推荐列表为空，接口可能已经变了')
  }

  ctx.log.info(`infoq-recommend: ${entries.length} 条`)

  return { entries, icon: 'https://www.infoq.cn/favicon.ico' }
}

/// `getDetail` sometimes returns the body inline and sometimes only a signed
/// `content_url` pointing at the same document as JSON.
export async function preview(ctx) {
  const uuid = ctx.item && ctx.item.params && ctx.item.params.uuid
  if (!uuid) return null

  const link = `${SITE}/article/${uuid}`
  const body = await post(ctx, DETAIL_API, { uuid }, link)
  const detail = body && body.data

  if (!detail) return null

  let raw = detail.content
  if ((!raw || raw === '') && detail.content_url) {
    const response = await ctx.fetch(detail.content_url)
    if (!response.ok) {
      throw new Error(`InfoQ 返回 ${response.status} ${response.statusText}`)
    }
    raw = await response.text()
  }

  const content = renderBody(raw)
  return content ? { content } : null
}
