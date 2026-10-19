// Ported from RSSHub lib/routes/caixin/latest.ts (AGPL-3.0).
// Caixin — latest articles.
//
// The scroll index is a public JSON API. FM, video and data-news entries are
// dropped the same way the upstream route drops them; the rest are ordinary
// articles. Bodies are not fetched here, only in preview.

export const meta = {
  id: 'rome.rsshub-caixin-latest',
  name: '财新 · 最新文章',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: '财新网最新文章，不含音频和视频内容',
  icon: 'https://www.caixin.com/favicon.ico',
}

const API = 'https://gateway.caixin.com/api/dataplatform/scroll/index'
const EXCLUDED = ['https://fm.caixin.com/', 'https://video.caixin.com/', 'https://datanews.caixin.com/']

function strip(html) {
  return String(html).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
}

// The index mixes millisecond and second stamps depending on the channel.
function unixSeconds(value) {
  const number = Number(value)
  if (!Number.isFinite(number) || number <= 0) return undefined
  return number > 1e11 ? Math.floor(number / 1000) : Math.floor(number)
}

export async function fetch(ctx) {
  const response = await ctx.fetch(API, { headers: { accept: 'application/json' } })

  if (!response.ok) {
    throw new Error(`财新网返回 ${response.status} ${response.statusText}`)
  }

  const payload = await response.json()
  const list = payload?.data?.articleList

  if (!Array.isArray(list)) {
    throw new Error('财新网最新文章接口结构已变化')
  }

  const entries = []

  for (const item of list) {
    const url = String(item.url || '')
    if (!url || EXCLUDED.some((prefix) => url.startsWith(prefix))) continue

    const id = String(item.contentId || item.articleId || url)
    const entry = {
      id: `caixin:latest:${id}`,
      title: strip(item.title),
      url,
    }

    const author = strip(item.author || '')
    if (author) entry.author = author

    const summary = strip(item.summary || '')
    if (summary) entry.summary = summary

    if (typeof item.picture === 'string' && item.picture) entry.image = item.picture

    const publishedAt = unixSeconds(item.time)
    if (publishedAt !== undefined) entry.publishedAt = publishedAt

    entries.push(entry)
  }

  if (entries.length === 0) {
    throw new Error('财新网最新文章接口返回为空')
  }

  return { entries }
}

export async function preview(ctx) {
  const url = ctx.item?.url
  if (!url) return null
  const content = await ctx.article(url)
  return content === null ? null : { content }
}
