// Ported from RSSHub lib/routes/caixin/article.ts (AGPL-3.0).
// Caixin — front page articles.
//
// The wap index carries a summary and an author for every entry, so no extra
// request is needed for the list. The article body is paywalled and is left to
// the host extractor in preview.

export const meta = {
  id: 'rome.rsshub-caixin-article',
  name: '财新 · 首页新闻',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: '财新网首页新闻',
  icon: 'https://www.caixin.com/favicon.ico',
}

const API = 'https://mapiv5.caixin.com/m/api/getWapIndexListByPage'

function strip(html) {
  return String(html).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
}

export async function fetch(ctx) {
  const response = await ctx.fetch(API, { headers: { accept: 'application/json' } })

  if (!response.ok) {
    throw new Error(`财新网返回 ${response.status} ${response.statusText}`)
  }

  const payload = await response.json()
  const list = payload?.data?.list

  if (!Array.isArray(list)) {
    throw new Error('财新网首页接口结构已变化')
  }

  const entries = []

  for (const item of list) {
    const url = String(item.web_url || '')
    if (!url) continue

    const entry = {
      id: `caixin:index:${item.id || url}`,
      title: strip(item.title),
      url,
    }

    const author = strip(item.author_name || '')
    if (author) entry.author = author

    const summary = strip(item.summary || '')
    if (summary) entry.summary = summary

    if (typeof item.pics === 'string' && item.pics) entry.image = item.pics

    // The API sends seconds as a string.
    const seconds = Number(item.time)
    if (Number.isFinite(seconds) && seconds > 0) entry.publishedAt = Math.floor(seconds)

    entries.push(entry)
  }

  if (entries.length === 0) {
    throw new Error('财新网首页接口返回为空')
  }

  return { entries }
}

export async function preview(ctx) {
  const url = ctx.item?.url
  if (!url) return null
  const content = await ctx.article(url)
  return content === null ? null : { content }
}
