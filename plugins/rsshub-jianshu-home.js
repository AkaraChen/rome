// Ported from RSSHub lib/routes/jianshu/home.ts (AGPL-3.0).
// 简书 — 首页信息流。
//
// 列表是服务端渲染的，一次请求就够。每篇的 `note-<id>` 就是文章 id，标题改了
// 也不会变，所以条目 id 取自它。列表里没有发布时间，正文留给 preview 去读。

export const meta = {
  id: 'rome.rsshub-jianshu-home',
  name: '简书 · 首页',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: '抓取简书首页的最新文章',
  icon: 'https://www.jianshu.com/favicon.ico',
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

function decode(text) {
  return String(text ?? '').replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity) => {
    if (entity[0] === '#') {
      const code = entity[1] === 'x' || entity[1] === 'X'
        ? Number.parseInt(entity.slice(2), 16)
        : Number.parseInt(entity.slice(1), 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : match
    }
    return Object.prototype.hasOwnProperty.call(ENTITIES, entity) ? ENTITIES[entity] : match
  })
}

function strip(text) {
  return decode(String(text ?? '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim()
}

function absolute(href) {
  try {
    return new URL(decode(href), 'https://www.jianshu.com/').href
  } catch {
    return null
  }
}

/// 列表项里没有嵌套的 li，所以一个 li 就是一篇。
export function parseNotes(html, prefix) {
  const entries = []

  for (const match of html.matchAll(/<li id="note-(\d+)"[^>]*>([\s\S]*?)<\/li>/g)) {
    const noteId = match[1]
    const block = match[2]
    const title = /<a[^>]*class="title"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(block)
      || /<a[^>]*href="([^"]+)"[^>]*class="title"[^>]*>([\s\S]*?)<\/a>/.exec(block)

    if (!title) continue

    const heading = strip(title[2])
    const url = absolute(title[1])

    if (!heading || !url) continue

    const entry = {
      id: `${prefix}:${noteId}`,
      title: heading,
      url,
    }

    const author = /<a[^>]*class="nickname"[^>]*>([\s\S]*?)<\/a>/.exec(block)
    if (author) {
      entry.author = strip(author[1])
    }

    const abstract = /<p class="abstract">([\s\S]*?)<\/p>/.exec(block)
    if (abstract) {
      const summary = strip(abstract[1])
      if (summary) entry.summary = summary
    }

    const image = /<img[^>]*(?:data-echo|src)="([^"]+)"/.exec(block)
    if (image && !image[1].startsWith('data:')) {
      entry.image = decode(image[1])
    }

    entries.push(entry)
  }

  return entries
}

export async function fetch(ctx) {
  const url = 'https://www.jianshu.com/'

  ctx.log.debug(`jianshu: GET ${url}`)

  const response = await ctx.fetch(url, { headers: { accept: 'text/html' } })

  if (!response.ok) {
    throw new Error(`简书返回 ${response.status} ${response.statusText}`)
  }

  const entries = parseNotes(await response.text(), 'jianshu')

  if (entries.length === 0) {
    throw new Error('简书首页没有文章列表，页面结构可能已经变了')
  }

  ctx.log.info(`jianshu: ${entries.length} 篇文章`)

  return { entries }
}

export async function preview(ctx) {
  const url = ctx.item?.url
  if (!url) return null

  const content = await ctx.article(url)
  return content === null ? null : { content }
}
