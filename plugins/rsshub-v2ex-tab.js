// Ported from RSSHub lib/routes/v2ex/tab.ts (AGPL-3.0).
// V2EX 标签 — www.v2ex.com/?tab=<tabid>。
//
// 列表页每条都是 <div class="cell item">，标题、节点、作者和绝对时间都在
// 里面，所以 fetch 不用打开每个帖子；正文交给 preview。

export const meta = {
  id: 'rome.rsshub-v2ex-tab',
  name: 'V2EX · 标签',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: 'V2EX 指定标签下的主题',
  icon: 'https://www.v2ex.com/favicon.ico',
  params: {
    fields: [
      {
        key: 'tabid',
        type: 'text',
        label: '标签',
        help: '首页标签名，例如 hot、tech、creative、qna、jobs',
        default: '',
        required: true,
      },
    ],
  },
}

const BASE = 'https://www.v2ex.com'
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
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
function divInner(html, open) {
  if (open < 0) return null

  const close = html.indexOf('>', open)
  if (close < 0) return null

  const tag = /<(\/?)div\b[^>]*>/gi
  tag.lastIndex = close + 1

  let depth = 1
  let match

  while ((match = tag.exec(html))) {
    depth += match[1] ? -1 : 1
    if (depth === 0) return html.slice(close + 1, match.index).trim()
  }

  return null
}

// 列表里的时间写成 2026-10-19 14:14:28 +08:00，带时区偏移。
function stampSeconds(text) {
  const match = /(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})\s*([+-]\d{2}:\d{2})/.exec(text)
  if (!match) return undefined
  const milliseconds = Date.parse(`${match[1]}T${match[2]}${match[3]}`)
  return Number.isFinite(milliseconds) ? Math.floor(milliseconds / 1000) : undefined
}

export async function fetch(ctx) {
  const tabid = String(ctx.params.tabid ?? '').trim()

  if (!tabid) {
    throw new Error('请填写标签，例如 hot')
  }
  if (/[/?#&=]/.test(tabid)) {
    throw new Error(`标签 ${tabid} 无效，不能包含 / ? # & =`)
  }

  const url = `${BASE}/?tab=${encodeURIComponent(tabid)}`

  ctx.log.debug(`v2ex: GET ${url}`)

  const response = await ctx.fetch(url, { headers: { accept: 'text/html', 'user-agent': UA } })

  if (!response.ok) {
    throw new Error(`V2EX 标签页返回 ${response.status} ${response.statusText}`)
  }

  const html = await response.text()
  const entries = []

  for (const block of html.split('<div class="cell item">').slice(1)) {
    if (entries.length >= LIMIT) break

    // href 写在 class 前面，所以先在属性里找 class，再从同一组属性里取 href。
    const anchor = /<a\b([^>]*\bclass="topic-link"[^>]*)>([\s\S]*?)<\/a>/.exec(block)
    if (!anchor) continue

    const href = /\bhref="([^"]+)"/.exec(anchor[1])
    if (!href) continue

    // 链接带 #reply91 之类的回复锚点，去掉它才是主题地址。
    const link = new URL(decode(href[1]), BASE)
    link.hash = ''

    const node = /<a class="node"[^>]*>([\s\S]*?)<\/a>/.exec(block)
    const author = /<strong><a href="\/member\/[^"]*">([\s\S]*?)<\/a><\/strong>/.exec(block)
    const stamp = /<span title="([^"]+)">/.exec(block)

    const entry = {
      // /t/1249874 里的编号就是主题编号。
      id: `v2ex:topic:${/\/t\/(\d+)/.exec(link.pathname)?.[1] ?? link.pathname}`,
      title: stripTags(anchor[2]),
      url: link.href,
    }

    if (author) entry.author = stripTags(author[1])
    if (node) entry.summary = stripTags(node[1])

    const publishedAt = stamp ? stampSeconds(decode(stamp[1])) : undefined
    if (publishedAt !== undefined) entry.publishedAt = publishedAt

    entries.push(entry)
  }

  if (entries.length === 0) {
    throw new Error(`V2EX 标签 ${tabid} 没有解析到主题，标签名或页面结构可能已经改变`)
  }

  return { entries, icon: `${BASE}/favicon.ico` }
}

export async function preview(ctx) {
  const url = ctx.item?.url
  if (!url) return null

  const response = await ctx.fetch(url, { headers: { accept: 'text/html', 'user-agent': UA } })

  if (!response.ok) {
    throw new Error(`V2EX 主题页返回 ${response.status} ${response.statusText}`)
  }

  const html = await response.text()
  const open = html.indexOf('<div class="topic_content"')

  if (open < 0) return null

  const content = divInner(html, open)
  return content ? { content } : null
}
