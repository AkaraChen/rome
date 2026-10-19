// Ported from RSSHub lib/routes/jianshu/collection.ts (AGPL-3.0).
// 简书 — 专题。
//
// 专题页和首页用同一套 `note-list` 结构，所以解析方式一样；不同的是专题 id
// 来自 URL，并且简书要求带上 Referer 才返回完整列表。

export const meta = {
  id: 'rome.rsshub-jianshu-collection',
  name: '简书 · 专题',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: '抓取简书专题下的最新文章',
  icon: 'https://www.jianshu.com/favicon.ico',
  params: {
    fields: [
      {
        key: 'id',
        type: 'text',
        label: '专题 id',
        help: '专题页 URL 中的 id，例如 www.jianshu.com/c/xYuZYD 里的 xYuZYD',
        default: '',
      },
    ],
  },
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

function parseNotes(html, prefix) {
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
    if (author) entry.author = strip(author[1])

    const abstract = /<p class="abstract">([\s\S]*?)<\/p>/.exec(block)
    if (abstract) {
      const summary = strip(abstract[1])
      if (summary) entry.summary = summary
    }

    const image = /<img[^>]*(?:data-echo|src)="([^"]+)"/.exec(block)
    if (image && !image[1].startsWith('data:')) entry.image = decode(image[1])

    entries.push(entry)
  }

  return entries
}

export async function fetch(ctx) {
  const id = String(ctx.params.id || '').trim()

  if (!id) {
    throw new Error('请填写专题 id，它是专题页 URL 里的那一段')
  }

  const url = `https://www.jianshu.com/c/${encodeURIComponent(id)}`

  ctx.log.debug(`jianshu: GET ${url}`)

  const response = await ctx.fetch(url, { headers: { accept: 'text/html', referer: url } })

  if (!response.ok) {
    throw new Error(`简书返回 ${response.status} ${response.statusText}`)
  }

  const entries = parseNotes(await response.text(), `jianshu-collection-${id}`)

  if (entries.length === 0) {
    throw new Error('简书专题页没有文章列表，专题 id 可能不对或页面结构已经变了')
  }

  ctx.log.info(`jianshu: 专题 ${id} 共 ${entries.length} 篇文章`)

  return { entries }
}

export async function preview(ctx) {
  const url = ctx.item?.url
  if (!url) return null

  const content = await ctx.article(url)
  return content === null ? null : { content }
}
