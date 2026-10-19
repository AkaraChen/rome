// Ported from RSSHub lib/routes/yicai/latest.ts (AGPL-3.0).
// Yicai — latest articles.
//
// The news list is a public JSON API returning a bare array. `CreateDate` is a
// wall-clock Asia/Shanghai time with no offset, so the offset is applied here
// rather than left to the host's locale.

export const meta = {
  id: 'rome.rsshub-yicai-latest',
  name: '第一财经 · 最新',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: '第一财经最新资讯',
  icon: 'https://www.yicai.com/favicon.ico',
}

const ROOT = 'https://www.yicai.com'
const API = `${ROOT}/api/ajax/getlatest?page=1&pagesize=30`

function strip(html) {
  return String(html).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
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

// 一财号 articles live under /vip and carry AppID 0.
function absolute(path, appId) {
  const value = String(path || '')
  if (!value) return ''
  if (/^https?:\/\//.test(value)) return value
  return `${ROOT}${appId === 0 ? '/vip' : ''}${value.startsWith('/') ? '' : '/'}${value}`
}

// The list endpoints sometimes carry a NewsID that disagrees with the article
// URL, so the id is taken from the URL when it has one.
function articleId(url, fallback) {
  const match = /\/(\d+)\.html/.exec(String(url))
  return match ? match[1] : String(fallback || url)
}

export async function fetch(ctx) {
  const response = await ctx.fetch(API, { headers: { accept: 'application/json' } })

  if (!response.ok) {
    throw new Error(`第一财经返回 ${response.status} ${response.statusText}`)
  }

  const list = await response.json()

  if (!Array.isArray(list)) {
    throw new Error('第一财经最新接口结构已变化')
  }

  const entries = []

  for (const item of list) {
    const url = absolute(item.url, item.AppID)
    if (!url) continue

    const entry = {
      id: `yicai:latest:${articleId(url, item.NewsID || item.id)}`,
      title: strip(item.NewsTitle),
      url,
    }

    const author = strip(item.NewsAuthor || item.NewsSource || item.CreaterName || '')
    if (author) entry.author = author

    const summary = strip(item.NewsNotes || '')
    if (summary) entry.summary = summary

    if (typeof item.originPic === 'string' && item.originPic) entry.image = item.originPic

    const publishedAt = shanghaiSeconds(item.CreateDate)
    if (publishedAt !== undefined) entry.publishedAt = publishedAt

    entries.push(entry)
  }

  if (entries.length === 0) {
    throw new Error('第一财经最新接口返回为空')
  }

  return { entries }
}

export async function preview(ctx) {
  const url = ctx.item?.url
  if (!url) return null
  const content = await ctx.article(url)
  return content === null ? null : { content }
}
