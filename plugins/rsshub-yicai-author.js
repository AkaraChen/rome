// Ported from RSSHub lib/routes/yicai/author.ts (AGPL-3.0).
// Yicai — articles by one 一财号 author.
//
// The author id is a path segment; the default is 第一财经研究院, which is the
// account the upstream route documents. A trailing `.html` is accepted and
// trimmed, because the site's own URLs carry it.

export const meta = {
  id: 'rome.rsshub-yicai-author',
  name: '第一财经 · 一财号',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: '第一财经一财号作者的文章',
  icon: 'https://www.yicai.com/favicon.ico',
  params: {
    fields: [
      {
        key: 'id',
        type: 'text',
        label: '作者 id',
        help: '可在作者页网址中找到，默认为第一财经研究院 100005663',
        default: '100005663',
      },
    ],
  },
}

const ROOT = 'https://www.yicai.com'

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
  const id = String(ctx.params.id || '100005663').trim().replace(/\.html$/, '')

  if (!/^\d+$/.test(id)) {
    throw new Error('作者 id 必须是数字，例如 100005663')
  }

  const api = `${ROOT}/api/ajax/getlistbysid?id=${id}&page=1&pagesize=30`
  const response = await ctx.fetch(api, { headers: { accept: 'application/json' } })

  if (!response.ok) {
    throw new Error(`第一财经返回 ${response.status} ${response.statusText}`)
  }

  const list = await response.json()

  if (!Array.isArray(list)) {
    throw new Error('第一财经一财号接口结构已变化')
  }

  const entries = []

  for (const item of list) {
    const url = absolute(item.url, item.AppID)
    if (!url) continue

    const entry = {
      id: `yicai:author:${articleId(url, item.NewsID || item.id)}`,
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
    throw new Error('第一财经一财号接口返回为空')
  }

  return { entries }
}

export async function preview(ctx) {
  const url = ctx.item?.url
  if (!url) return null
  const content = await ctx.article(url)
  return content === null ? null : { content }
}
