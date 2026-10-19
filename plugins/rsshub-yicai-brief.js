// Ported from RSSHub lib/routes/yicai/brief.ts (AGPL-3.0).
// Yicai — the live brief feed (正在).
//
// A public JSON API. The upstream title field embeds markup, so the plain
// `LiveTitle` is preferred and the markup-bearing one is stripped as a
// fallback. Items without a timestamp fall back to the date and clock fields.

export const meta = {
  id: 'rome.rsshub-yicai-brief',
  name: '第一财经 · 正在',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: '第一财经正在直播的快讯',
  icon: 'https://www.yicai.com/favicon.ico',
}

const ROOT = 'https://www.yicai.com'
const API = `${ROOT}/api/ajax/getbrieflist?type=0&page=1&pagesize=50`

function strip(html) {
  return String(html).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
}

// The id is taken from the article URL when it has one, because the list's
// own id fields are not always the article id.
function articleId(url, fallback) {
  const match = /\/(\d+)\.html/.exec(String(url))
  return match ? match[1] : String(fallback || url)
}

function shanghaiSeconds(text) {
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(String(text).trim())
  if (!match) return undefined
  return Math.floor(Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]) - 8,
    Number(match[5]),
    Number(match[6] || 0),
  ) / 1000)
}

export async function fetch(ctx) {
  const response = await ctx.fetch(API, { headers: { accept: 'application/json' } })

  if (!response.ok) {
    throw new Error(`第一财经返回 ${response.status} ${response.statusText}`)
  }

  const list = await response.json()

  if (!Array.isArray(list)) {
    throw new Error('第一财经正在接口结构已变化')
  }

  const entries = []

  for (const item of list) {
    const url = String(item.url || '')
    if (!url) continue

    const title = strip(item.LiveTitle || '') || strip(item.indexTitle || '')
    if (!title) continue

    const entry = {
      id: `yicai:brief:${articleId(url, item.LiveID || item.id)}`,
      title,
      url: url.startsWith('http') ? url : `${ROOT}${url.startsWith('/') ? '' : '/'}${url}`,
    }

    const summary = strip(item.LiveContent || item.newcontent || '')
    if (summary) entry.summary = summary

    if (typeof item.LiveImages === 'string' && /^https?:\/\//.test(item.LiveImages)) {
      entry.image = item.LiveImages
    }

    let publishedAt = shanghaiSeconds(item.CreateDate)
    if (publishedAt === undefined && item.datekey && item.hm) {
      publishedAt = shanghaiSeconds(`${item.datekey} ${item.hm}`)
    }
    if (publishedAt !== undefined) entry.publishedAt = publishedAt

    entries.push(entry)
  }

  if (entries.length === 0) {
    throw new Error('第一财经正在接口返回为空')
  }

  return { entries }
}

export async function preview(ctx) {
  const url = ctx.item?.url
  if (!url) return null
  const content = await ctx.article(url)
  return content === null ? null : { content }
}
