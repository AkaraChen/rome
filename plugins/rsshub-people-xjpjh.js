// Ported from RSSHub lib/routes/people/xjpjh.ts (AGPL-3.0).
// 习近平系列重要讲话数据库 — jhsjk.people.cn。
//
// 结果页的 #news_list 是每篇一个 <li>（标题、来源、日期），紧跟着一个
// <li> 放摘要。摘要在列表里就有，所以 fetch 不用打开文章；正文留给
// preview。
//
// 日期写作 [2026-10-17]，是来源标注的日期而不是时刻，按 UTC 零点算。

export const meta = {
  id: 'rome.rsshub-people-xjpjh',
  name: '人民网 · 习近平系列重要讲话',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: '习近平系列重要讲话数据库的最新文章',
  icon: 'https://jhsjk.people.cn/favicon.ico',
  params: {
    fields: [
      {
        key: 'keyword',
        type: 'text',
        label: '关键词',
        help: '留空表示不限',
        default: '',
        required: false,
      },
      {
        key: 'year',
        type: 'text',
        label: '年份',
        help: '例如 2026；填 all 或留空表示不限',
        default: 'all',
        required: false,
      },
    ],
  },
}

const HOST = 'https://jhsjk.people.cn'
const LIMIT = 10

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

function decode(text) {
  return String(text).replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity) => {
    if (entity[0] === '#') {
      const code = entity[1] === 'x' || entity[1] === 'X'
        ? Number.parseInt(entity.slice(2), 16)
        : Number.parseInt(entity.slice(1), 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : match
    }
    return Object.prototype.hasOwnProperty.call(ENTITIES, entity) ? ENTITIES[entity] : match
  })
}

function stripTags(html) {
  return decode(String(html).replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim()
}

// 取出某个 <div> 的内层 HTML：从它的开始标签起数 div 的开合，
// 数回零就是它的结束标签。没有 DOM，只能这样配平。
function innerDiv(html, marker) {
  const at = html.indexOf(marker)
  if (at < 0) return null

  const open = html.indexOf('>', at)
  if (open < 0) return null

  const tag = /<(\/?)div\b[^>]*>/gi
  tag.lastIndex = open + 1

  let depth = 1
  let match

  while ((match = tag.exec(html))) {
    depth += match[1] ? -1 : 1
    if (depth === 0) return html.slice(open + 1, match.index).trim()
  }

  return null
}

function daySeconds(text) {
  const match = /(\d{4})-(\d{2})-(\d{2})/.exec(text)
  if (!match) return undefined
  return Math.floor(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / 1000)
}

export async function fetch(ctx) {
  const rawKeyword = String(ctx.params.keyword ?? '').trim()
  const rawYear = String(ctx.params.year ?? 'all').trim() || 'all'

  if (rawYear !== 'all' && !/^\d{4}$/.test(rawYear)) {
    throw new Error(`年份 ${rawYear} 无效，应为四位数字或 all`)
  }

  const keyword = rawKeyword === 'all' ? '' : rawKeyword
  const year = rawYear === 'all' ? '0' : rawYear

  const url = new URL('/result', HOST)
  url.searchParams.set('keywords', keyword)
  url.searchParams.set('year', year)

  ctx.log.debug(`people: GET ${url.href}`)

  const response = await ctx.fetch(url.href, { headers: { accept: 'text/html' } })

  if (!response.ok) {
    throw new Error(`习近平系列重要讲话数据库返回 ${response.status} ${response.statusText}`)
  }

  const html = await response.text()
  const start = html.indexOf('id="news_list"')
  const end = start < 0 ? -1 : html.indexOf('</ul>', start)

  if (start < 0 || end < 0) {
    throw new Error('结果页里没有 #news_list，页面结构可能已经改变')
  }

  const entries = []
  let current

  for (const block of html.slice(start, end).split(/<li\b/i).slice(1)) {
    if (entries.length >= LIMIT) break

    const anchor = /<a\b([^>]*)>([\s\S]*?)<\/a>/.exec(block)

    if (anchor) {
      const href = /\bhref="([^"]+)"/.exec(anchor[1])
      const title = stripTags(anchor[2])
      if (!href || !title) continue

      const link = new URL(decode(href[1]), url.href)
      const id = /article\/(\d+)/.exec(link.pathname)
      const date = /\[(\d{4}-\d{2}-\d{2})\]/.exec(block)

      current = {
        // 文章编号是站内的永久标识。
        id: `people:xjpjh:${id ? id[1] : link.pathname}`,
        title,
        url: link.href,
      }

      const publishedAt = date ? daySeconds(date[1]) : undefined
      if (publishedAt !== undefined) current.publishedAt = publishedAt

      entries.push(current)
      continue
    }

    // 摘要那一格紧跟在标题后面，取到就补进上一条。
    const summary = /<p[^>]*>([\s\S]*?)<\/p>/.exec(block)
    if (summary && current && current.summary === undefined) {
      const text = stripTags(summary[1]).replace(/\.{3}$/, '…')
      if (text) current.summary = text
    }
  }

  if (entries.length === 0) {
    throw new Error('习近平系列重要讲话数据库没有解析到文章，关键词或页面结构可能已经改变')
  }

  return { entries, icon: `${HOST}/favicon.ico` }
}

export async function preview(ctx) {
  const url = ctx.item?.url
  if (!url) return null

  const response = await ctx.fetch(url, { headers: { accept: 'text/html' } })

  if (!response.ok) {
    throw new Error(`文章页返回 ${response.status} ${response.statusText}`)
  }

  const html = await response.text()
  const content = innerDiv(html, 'class="d2txt_con')

  if (!content) {
    throw new Error('文章页里没有 div.d2txt_con，页面结构可能已经改变')
  }

  return { content }
}
