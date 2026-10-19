// Ported from RSSHub lib/routes/secrss/category.ts (AGPL-3.0).
// 安全内参 · 分类 — ported from RSSHub's /secrss/category/:category.
//
// The category index is a public JSON endpoint (`/api/articles?tag=`), and it
// already carries the summary and the cover, so a refresh is one request. The
// article body is not in it — `/api/articles` returns `content` empty — so the
// body is left to `preview`.
//
// `published_at` is Beijing wall-clock time with no offset, which is why it is
// read as +08:00 rather than through the local time zone.

export const meta = {
  id: 'rome.rsshub-secrss-category',
  name: '安全内参 · 分类',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: '安全内参分类下的文章，含摘要、封面、作者与标签',
  icon: 'https://www.secrss.com/favicon.ico',
  params: {
    fields: [
      {
        key: 'category',
        type: 'text',
        label: '分类',
        help: '分类名，可在文章页的标签链接中找到，例如 产业研究；留空表示全部',
        default: '',
      },
    ],
  },
}

const HOST = 'https://www.secrss.com'
const API = `${HOST}/api/articles?tag=`

function unixFromBeijing(value) {
  const text = String(value ?? '').trim()
  if (text === '') return undefined
  const iso = /[zZ]$|[+-]\d{2}:?\d{2}$/.test(text) ? text.replace(' ', 'T') : `${text.replace(' ', 'T')}+08:00`
  const milliseconds = Date.parse(iso)
  return Number.isFinite(milliseconds) ? Math.floor(milliseconds / 1000) : undefined
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

export async function fetch(ctx) {
  const category = String(ctx.params.category ?? '').trim()
  const response = await ctx.fetch(`${API}${encodeURIComponent(category)}`, {
    headers: { accept: 'application/json' },
  })

  if (!response.ok) {
    throw new Error(`安全内参返回 ${response.status} ${response.statusText}`)
  }

  const body = await response.json()
  const articles = body && body.data

  if (!Array.isArray(articles)) {
    throw new Error(`安全内参没有返回分类文章（${(body && body.message) || '该分类可能不存在'}），请检查分类名`)
  }

  const entries = []

  for (const item of articles) {
    if (!item || item.id === undefined || !item.title) continue

    const tags = Array.isArray(item.tags) ? item.tags.map((tag) => tag && tag.title).filter(Boolean) : []
    const image = item.image_url || item.thumb_image_url || undefined

    const entry = {
      id: `secrss:category:${item.id}`,
      title: item.title,
      url: `${HOST}/articles/${item.id}`,
      summary: [item.summary, tags.join(' · ')].filter(Boolean).join(' · ') || undefined,
      content: [
        image ? `<p><img src="${escapeHtml(image)}"></p>` : null,
        item.summary ? `<p>${escapeHtml(item.summary)}</p>` : null,
        tags.length > 0 ? `<p>${escapeHtml(tags.join(' · '))}</p>` : null,
      ].filter(Boolean).join(''),
    }

    const author = item.source_author || item.author
    if (author) entry.author = author
    if (image) entry.image = image

    const publishedAt = unixFromBeijing(item.published_at)
    if (publishedAt !== undefined) entry.publishedAt = publishedAt

    entries.push(entry)
  }

  if (entries.length === 0) {
    throw new Error('安全内参分类文章为空，接口可能已经变了')
  }

  ctx.log.info(`secrss-category: ${category || 'all'} ${entries.length} 条`)

  return { entries, icon: 'https://www.secrss.com/favicon.ico' }
}

export async function preview(ctx) {
  const url = ctx.item && ctx.item.url
  if (!url) return null

  const content = await ctx.article(url)
  return content === null ? null : { content }
}
