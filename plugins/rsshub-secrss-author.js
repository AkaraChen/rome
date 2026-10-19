// Ported from RSSHub lib/routes/secrss/author.ts (AGPL-3.0).
// 安全内参 · 作者 — ported from RSSHub's /secrss/author/:author.
//
// The author index is a JSON endpoint (`/api/articles/group?author=`). Its rows
// carry a title, a summary, a tag and a unix timestamp but no body, so the
// article is read by `preview` only when it is opened.
//
// The author value is a display name, not an id, and is passed through URL
// encoded: names contain Chinese text and spaces.

export const meta = {
  id: 'rome.rsshub-secrss-author',
  name: '安全内参 · 作者',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: '安全内参指定作者的文章，含摘要、标签与发布时间',
  icon: 'https://www.secrss.com/favicon.ico',
  params: {
    fields: [
      {
        key: 'author',
        type: 'text',
        label: '作者',
        help: '作者名，可在文章页的作者链接中找到，例如 网络安全威胁和漏洞信息共享平台',
        default: '',
      },
    ],
  },
}

const HOST = 'https://www.secrss.com'
const API = `${HOST}/api/articles/group?author=`

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

export async function fetch(ctx) {
  const author = String(ctx.params.author ?? '').trim()

  if (author === '') {
    throw new Error('请填写作者名，例如 网络安全威胁和漏洞信息共享平台')
  }

  const response = await ctx.fetch(`${API}${encodeURIComponent(author)}`, {
    headers: { accept: 'application/json' },
  })

  if (!response.ok) {
    throw new Error(`安全内参返回 ${response.status} ${response.statusText}`)
  }

  const body = await response.json()
  const articles = body && body.data && body.data.list

  if (!Array.isArray(articles)) {
    throw new Error(`安全内参没有返回作者文章（${(body && body.message) || '该作者可能不存在'}），请检查作者名`)
  }

  const entries = []

  for (const item of articles) {
    if (!item || !item.url || !item.title) continue

    const image = typeof item.img === 'string' && item.img !== '' ? item.img : undefined

    const entry = {
      id: `secrss:author:${item.url}`,
      title: item.title,
      url: `${HOST}${item.url}`,
      summary: [item.summary, item.tag].filter(Boolean).join(' · ') || undefined,
      content: [
        image ? `<p><img src="${escapeHtml(image)}"></p>` : null,
        item.summary ? `<p>${escapeHtml(item.summary)}</p>` : null,
        item.tag ? `<p>${escapeHtml(item.tag)}</p>` : null,
      ].filter(Boolean).join(''),
    }

    entry.author = author
    if (image) entry.image = image

    const publishedAt = Number(item.original_timestamp)
    if (Number.isFinite(publishedAt) && publishedAt > 0) entry.publishedAt = Math.floor(publishedAt)

    entries.push(entry)
  }

  if (entries.length === 0) {
    throw new Error('安全内参作者文章为空，接口可能已经变了')
  }

  ctx.log.info(`secrss-author: ${author} ${entries.length} 条`)

  return { entries, icon: 'https://www.secrss.com/favicon.ico' }
}

export async function preview(ctx) {
  const url = ctx.item && ctx.item.url
  if (!url) return null

  const content = await ctx.article(url)
  return content === null ? null : { content }
}
