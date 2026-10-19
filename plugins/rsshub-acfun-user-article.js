// Ported from RSSHub lib/routes/acfun/user-article.ts (AGPL-3.0).
// AcFun 用户文章 — /u/<uid>。
//
// 文章列表是服务端渲染的：每篇一个 <article class="ac-space-article
// weblog-item">，编号在 data-wbinfo 里。正文同样在文章页的
// window.articleInfo 里，所以留给 preview。

export const meta = {
  id: 'rome.rsshub-acfun-user-article',
  name: 'AcFun · 用户文章',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: 'AcFun 用户发表过的文章',
  icon: 'https://www.acfun.cn/favicon.ico',
  params: {
    fields: [
      {
        key: 'uid',
        type: 'text',
        label: '用户 UID',
        help: '个人主页 URL 里的数字，例如 www.acfun.cn/u/1384329 就填 1384329',
        default: '',
        required: true,
      },
    ],
  },
}

const BASE = 'https://www.acfun.cn'

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

// 页面把 JSON 直接写在 <script> 里，用括号配平把它整段取出来，
// 比用正则截到第一个 ; 更稳。
function extractJson(html, marker) {
  const at = html.indexOf(marker)
  if (at < 0) return null

  const start = html.indexOf('{', at)
  if (start < 0) return null

  let depth = 0
  let inString = false
  let escaped = false

  for (let i = start; i < html.length; i++) {
    const ch = html[i]

    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }

    if (ch === '"') inString = true
    else if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) {
        try {
          return JSON.parse(html.slice(start, i + 1))
        } catch {
          return null
        }
      }
    }
  }

  return null
}

function daySeconds(text) {
  const match = /(\d{4})\/(\d{1,2})\/(\d{1,2})/.exec(text)
  if (!match) return undefined
  const [, year, month, day] = match
  const pad = (value) => String(value).padStart(2, '0')
  const milliseconds = Date.parse(`${year}-${pad(month)}-${pad(day)}T00:00:00+08:00`)
  return Number.isFinite(milliseconds) ? Math.floor(milliseconds / 1000) : undefined
}

export async function fetch(ctx) {
  const uid = String(ctx.params.uid ?? '').trim()

  if (!uid) {
    throw new Error('请填写用户 UID（数字）')
  }
  if (!/^\d+$/.test(uid)) {
    throw new Error(`用户 UID ${uid} 无效，应为数字`)
  }

  const page = `${BASE}/u/${uid}`

  ctx.log.debug(`acfun: GET ${page}`)

  const response = await ctx.fetch(page, { headers: { accept: 'text/html' } })

  if (!response.ok) {
    throw new Error(`AcFun 个人主页返回 ${response.status} ${response.statusText}`)
  }

  const html = await response.text()

  // 用户名是页面里唯一带 data-username 的元素。
  const username = /data-username="([^"]*)"/.exec(html) ?? /data-username=([^\s>]+)/.exec(html)

  const signature = /<div class="complete">([\s\S]*?)<\/div>/.exec(html)

  const article = /<article\b([^>]*\bclass="[^"]*weblog-item[^"]*"[^>]*)>([\s\S]*?)<\/article>/g

  const entries = []
  let match

  while ((match = article.exec(html))) {
    const attrs = match[1]
    const body = match[2]

    const atomid = /"atomid":(\d+)/.exec(attrs)
    const anchor = /<a\b([^>]*\bclass="title[^"]*"[^>]*)>([\s\S]*?)<\/a>/.exec(body)
    if (!anchor) continue

    const href = /\bhref="([^"]+)"/.exec(anchor[1])
    if (!href) continue

    const link = new URL(decode(href[1]), BASE)
    const info = /<p class="info">([\s\S]*?)<\/p>/.exec(body)
    const infoText = info ? stripTags(info[1]) : ''

    const entry = {
      // 文章编号和「文章」插件用的是同一个，两处读到同一篇时不会重复。
      id: `acfun:article:${atomid ? atomid[1] : link.pathname}`,
      title: stripTags(anchor[2]),
      url: link.href,
    }

    if (username) {
      const name = stripTags(username[1])
      if (name) entry.author = name
    }

    const publishedAt = daySeconds(infoText)
    if (publishedAt !== undefined) entry.publishedAt = publishedAt

    const views = /(\d+)人围观/.exec(infoText)
    const comments = /(\d+)条评论/.exec(infoText)
    const parts = []
    if (views) parts.push(`${views[1]} 浏览`)
    if (comments) parts.push(`${comments[1]} 评论`)
    if (parts.length > 0) entry.summary = parts.join(' · ')

    // 列表里的 <p class="desc"> 是文章摘要，多数人留的是站点默认的那句
    // 「这个人很懒」，所以不放进来，正文交给 preview。

    // 文章页要求 referer，preview 时要用。
    entry.params = { referer: page }

    entries.push(entry)
  }

  if (entries.length === 0) {
    throw new Error(`AcFun 用户 ${uid} 的主页没有解析到文章，用户可能没有投稿或页面结构已经改变`)
  }

  return { entries, icon: `${BASE}/favicon.ico` }
}

export async function preview(ctx) {
  const url = ctx.item?.url
  if (!url) return null

  const referer = ctx.item.params?.referer ?? url
  const response = await ctx.fetch(url, { headers: { referer, accept: 'text/html' } })

  if (!response.ok) {
    throw new Error(`AcFun 文章页返回 ${response.status} ${response.statusText}`)
  }

  const html = await response.text()
  const info = extractJson(html, 'window.articleInfo')

  if (!info) {
    throw new Error('AcFun 文章页里没有 window.articleInfo，页面结构可能已经改变')
  }

  const content = info.parts?.[0]?.content
  if (!content) return null

  return { content }
}
