// Ported from RSSHub lib/routes/infoq/topic.ts (AGPL-3.0).
// InfoQ 中文 · 话题 — ported from RSSHub's /infoq/topic/:id.
//
// Two POSTs: `topic/getInfo` resolves the id (or an alias) to the topic record,
// and `article/getList` returns its articles with title, summary, cover,
// authors and publish time. The full body is a second step, so it is left to
// `preview`.

export const meta = {
  id: 'rome.rsshub-infoq-topic',
  name: 'InfoQ 中文 · 话题',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: 'InfoQ 话题下的文章，含摘要、封面与作者',
  icon: 'https://www.infoq.cn/favicon.ico',
  params: {
    fields: [
      {
        key: 'id',
        type: 'text',
        label: '话题 id',
        help: '话题 id，可在 InfoQ 全部话题页面的 URL 中找到，例如 https://www.infoq.cn/topic/61 中的 61',
        default: '',
      },
    ],
  },
}

const SITE = 'https://www.infoq.cn'
const INFO_API = `${SITE}/public/v1/topic/getInfo`
const LIST_API = `${SITE}/public/v1/article/getList`
const DETAIL_API = `${SITE}/public/v1/article/getDetail`

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function unixFromMilliseconds(value) {
  const milliseconds = Number(value)
  return Number.isFinite(milliseconds) ? Math.floor(milliseconds / 1000) : undefined
}

function authorLine(item) {
  const names = Array.isArray(item.author) ? item.author.map((person) => person && person.nickname).filter(Boolean) : []
  return names.length > 0 ? names.join(',') : item.no_author || undefined
}

// --- body rendering --------------------------------------------------------

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
  const id = String(ctx.params.id ?? '').trim()

  if (id === '') {
    throw new Error('请填写话题 id，例如 61（阿里巴巴）')
  }

  // A numeric id and an alias are different fields in the same request.
  const infoBody = Number.isNaN(Number(id)) ? { alias: id } : { id: Number.parseInt(id, 10) }
  const info = await post(ctx, INFO_API, infoBody, `${SITE}/topic/${id}`)
  const topic = info && info.data

  if (!topic || !topic.id) {
    throw new Error(`InfoQ 没有找到该话题（${(info && info.msg) || id}），请检查话题 id`)
  }

  const list = await post(ctx, LIST_API, { id: topic.id, ptype: 0, size: 30, type: 0 }, `${SITE}/topic/${id}`)
  const articles = list && list.data

  if (!Array.isArray(articles)) {
    throw new Error(`InfoQ 没有返回话题文章（${(list && list.msg) || '未知原因'}），接口可能已经变了`)
  }

  const entries = []

  for (const item of articles) {
    if (!item || !item.uuid || !item.article_title) continue

    const image = item.article_cover || undefined
    const author = authorLine(item)

    const entry = {
      id: `infoq:topic:${item.uuid}`,
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
    throw new Error('InfoQ 话题文章为空，接口可能已经变了')
  }

  ctx.log.info(`infoq-topic: ${topic.name} ${entries.length} 条`)

  return { entries, icon: topic.cover || 'https://www.infoq.cn/favicon.ico' }
}

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
