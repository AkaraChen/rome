// Ported from RSSHub lib/routes/gelonghui/keyword.ts (AGPL-3.0).
// 格隆汇搜索 — the site's own search API. Titles come back with <hl> highlight
// tags around the matched words, which are stripped.

export const meta = {
  id: 'rome.rsshub-gelonghui-keyword',
  name: '格隆汇 · 搜索关键字',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: '按关键字搜索格隆汇的文章',
  icon: 'https://www.gelonghui.com/favicon.ico',
  params: {
    fields: [
      {
        key: 'keyword',
        type: 'text',
        label: '搜索关键字',
        help: '要搜索的关键字，例如 早报',
        required: true,
        default: ''
      }
    ]
  }
}

const API = 'https://www.gelonghui.com/api/post/search/v4'
const COUNT = 20

function decode(text) {
  const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }
  return String(text).replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity) => {
    if (entity[0] === '#') {
      const code = entity[1] === 'x' || entity[1] === 'X'
        ? Number.parseInt(entity.slice(2), 16)
        : Number.parseInt(entity.slice(1), 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : match
    }
    return Object.prototype.hasOwnProperty.call(entities, entity) ? entities[entity] : match
  })
}

function strip(html) {
  return decode(String(html).replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim()
}

export async function fetch(ctx) {
  const keyword = String(ctx.params.keyword || '').trim()

  if (!keyword) {
    throw new Error('搜索关键字不能为空')
  }

  const url = `${API}?keyword=${encodeURIComponent(keyword)}&isVipArticle=false&count=${COUNT}&page=1&searchArea=all`
  const response = await ctx.fetch(url, { headers: { accept: 'application/json' } })

  if (!response.ok) {
    throw new Error(`格隆汇返回 ${response.status} ${response.statusText}`)
  }

  const payload = await response.json()
  const list = payload?.result

  if (!Array.isArray(list)) {
    throw new Error(`格隆汇搜索 ${keyword} 没有返回结果`)
  }

  const entries = list
    .filter((item) => item && item.link)
    .map((item) => {
      const entry = {
        id: `gelonghui:${item.link}`,
        title: strip(item.title) || '（无标题）',
        url: item.link
      }

      if (item.source) {
        entry.author = item.source
      }

      if (item.summary) {
        entry.summary = strip(item.summary)
      }

      const publishedAt = Number(item.timestamp)
      if (Number.isFinite(publishedAt) && publishedAt > 0) {
        entry.publishedAt = Math.floor(publishedAt)
      }

      return entry
    })

  if (entries.length === 0) {
    throw new Error(`格隆汇搜索 ${keyword} 没有返回文章`)
  }

  return { entries }
}

export async function preview(ctx) {
  const url = ctx.item?.url
  if (!url) return null
  const content = await ctx.article(url)
  return content === null ? null : { content }
}
