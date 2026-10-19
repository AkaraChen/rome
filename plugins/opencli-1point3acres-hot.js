// Ported from OpenCLI clis/1point3acres/hot.js (Apache-2.0).
// 一亩三分地今日热门 — Discuz guide view=hot.
//
// The site is a Discuz!X BBS. There is no DOM in the runtime, so the listing is
// read with the same stable markers the adapter used: one <tbody> per thread,
// its `xst` title link, its forum link, its `by` cells and its `num` cell.
//
// Encoding: Discuz serves GBK, and Rome's host decodes a response body with the
// charset from Content-Type (encoding_rs knows `gbk`) before handing it to the
// plugin. `text()` is therefore already UTF-8 and the browser-side
// `TextDecoder("gbk")` in the original helper is unnecessary here.

export const meta = {
  id: 'rome.opencli-1point3acres-hot',
  name: '一亩三分地 · 热门帖',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: '抓取一亩三分地论坛的今日热门帖子。',
  icon: 'https://www.1point3acres.com/favicon.ico',
  params: {
    fields: [
      {
        key: 'limit',
        type: 'number',
        label: '条数',
        help: '返回条数（默认 20，最多 50）',
        default: 20,
        min: 1,
        max: 50,
      },
    ],
  },
}

const BASE = 'https://www.1point3acres.com/bbs'
const URL = `${BASE}/forum.php?mod=guide&view=hot`
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0 Safari/537.36'

const ENTITIES = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

function integer(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10)

  if (!Number.isFinite(parsed)) {
    return fallback
  }

  return Math.min(Math.max(parsed, min), max)
}

function decodeEntities(text) {
  if (!text) {
    return ''
  }

  return String(text).replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (match, entity) => {
    if (entity[0] === '#') {
      const code = entity[1] === 'x' || entity[1] === 'X'
        ? Number.parseInt(entity.slice(2), 16)
        : Number.parseInt(entity.slice(1), 10)

      return Number.isFinite(code) ? String.fromCodePoint(code) : match
    }

    return Object.prototype.hasOwnProperty.call(ENTITIES, entity) ? ENTITIES[entity] : match
  })
}

/// Discuz prints an absolute timestamp in the `title` attribute of the time
/// span, in China Standard Time. "3 天前" cannot be turned into an instant, so
/// it yields undefined and the entry sorts by when Rome first saw it.
function seconds(text) {
  const match = String(text ?? '').match(/^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/)

  if (match) {
    const [, year, month, day, hour, minute, second] = match
    const milliseconds = Date.UTC(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour) - 8,
      Number(minute),
      Number(second ?? 0),
    )

    return Number.isFinite(milliseconds) ? Math.floor(milliseconds / 1000) : undefined
  }

  const milliseconds = Date.parse(text)
  return Number.isFinite(milliseconds) ? Math.floor(milliseconds / 1000) : undefined
}

/// Every thread row is a <tbody id="normalthread_<tid>"> (or `stickthread`),
/// which is the one marker Discuz keeps across themes.
function parseThreadRows(html) {
  const rows = []
  const pattern = /<tbody id="(normalthread|stickthread)_(\d+)"[^>]*>([\s\S]*?)<\/tbody>/g

  for (const match of html.matchAll(pattern)) {
    rows.push({ kind: match[1], tid: match[2], inner: match[3] })
  }

  return rows
}

function readCite(block) {
  const match = block.match(/<cite[^>]*>([\s\S]*?)<\/cite>/)

  if (!match) {
    return ''
  }

  return decodeEntities(match[1].replace(/<[^>]+>/g, '').trim())
}

function readTime(block) {
  const titled = block.match(/<span [^>]*title="([^"]+)"[^>]*>/)

  if (titled) {
    return titled[1].trim()
  }

  const linked = block.match(/<em>[\s\S]*?<a [^>]*>\s*([^<]+?)\s*<\/a>/)

  if (linked) {
    return decodeEntities(linked[1].trim())
  }

  const spanned = block.match(/<em>[\s\S]*?<span[^>]*>\s*([^<]+?)\s*<\/span>/)

  if (spanned) {
    return decodeEntities(spanned[1].trim())
  }

  const bare = block.match(/<em>\s*([^<]+?)\s*<\/em>/)
  return bare ? decodeEntities(bare[1].trim()) : ''
}

function parseThreadRow(row) {
  const inner = row.inner
  const titles = [...inner.matchAll(/<a [^>]*class="[^"]*\bxst\b[^"]*"[^>]*>([^<]+)<\/a>/g)]
  const title = titles.length
    ? decodeEntities(titles[titles.length - 1][1].trim())
    : ''

  if (!title) {
    return null
  }

  const forumMatch = inner.match(/<a href="forum-(\d+)-1\.html"[^>]*target="_blank"[^>]*>([^<]+)<\/a>/)
  const forum = forumMatch ? decodeEntities(forumMatch[2].trim()) : ''

  // The first `by` cell with a <cite> is the author; the last one is the most
  // recent reply. When they are the same cell, the thread has no reply yet.
  const cells = [...inner.matchAll(/<td class="by"[^>]*>([\s\S]*?)<\/td>/g)].map((match) => match[1])
  let authorCell = ''
  let lastCell = ''

  for (const cell of cells) {
    if (/<cite/.test(cell)) {
      if (!authorCell) {
        authorCell = cell
      }

      lastCell = cell
    }
  }

  const author = authorCell ? readCite(authorCell) : ''
  const postTime = authorCell ? readTime(authorCell) : ''
  const lastReplyTime = lastCell && lastCell !== authorCell ? readTime(lastCell) : ''

  const stats = inner.match(/<td class="num"[^>]*>\s*<a[^>]*class="xi2"[^>]*>(\d+)<\/a>(?:\s*<em>(\d+)<\/em>)?/)
  const replies = stats ? Number(stats[1]) : 0
  const views = stats && stats[2] ? Number(stats[2]) : 0

  return {
    tid: row.tid,
    title,
    forum,
    author,
    replies,
    views,
    lastReplyTime,
    postTime,
    url: `${BASE}/thread-${row.tid}-1-1.html`,
  }
}

export async function fetch(ctx) {
  const limit = integer(ctx.params.limit, 20, 1, 50)

  ctx.log.debug(`1point3acres-hot: GET ${URL}`)

  const response = await ctx.fetch(URL, {
    headers: {
      'user-agent': UA,
      accept: 'text/html,application/xhtml+xml',
      'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
    },
  })

  if (!response.ok) {
    throw new Error(`一亩三分地返回 ${response.status} ${response.statusText}`)
  }

  const html = await response.text()
  const entries = []

  for (const row of parseThreadRows(html)) {
    const thread = parseThreadRow(row)

    if (!thread) {
      continue
    }

    const parts = []

    if (thread.forum) {
      parts.push(thread.forum)
    }

    parts.push(`${thread.replies} 条回复`, `${thread.views} 次浏览`)

    const entry = {
      id: `1p3a:${thread.tid}`,
      title: thread.title,
      url: thread.url,
      summary: parts.join(' · '),
    }

    if (thread.author) {
      entry.author = thread.author
    }

    const publishedAt = seconds(thread.lastReplyTime || thread.postTime)

    if (publishedAt !== undefined) {
      entry.publishedAt = publishedAt
    }

    entries.push(entry)

    if (entries.length >= limit) {
      break
    }
  }

  if (entries.length === 0) {
    throw new Error('一亩三分地没有解析出帖子，页面结构可能已经变了')
  }

  return { entries }
}
