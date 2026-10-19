// Ported from RSSHub lib/routes/jianshu/user.ts (AGPL-3.0).
// 简书 — 作者主页。
//
// 作者页的列表结构和首页一致，作者 id 来自 URL。简书对没有 Referer 的请求会
// 返回不完整的页面，所以请求里带上作者页自身。

export const meta = {
  id: 'rome.rsshub-jianshu-user',
  name: '简书 · 作者',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: '抓取简书作者的最新文章',
  icon: 'https://www.jianshu.com/favicon.ico',
  params: {
    fields: [
      {
        key: 'id',
        type: 'text',
        label: '作者 id',
        help: '作者主页 URL 中的 id，例如 www.jianshu.com/u/yZq3ZV 里的 yZq3ZV',
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
    throw new Error('请填写作者 id，它是作者主页 URL 里的那一段')
  }

  const url = `https://www.jianshu.com/u/${encodeURIComponent(id)}`

  ctx.log.debug(`jianshu: GET ${url}`)

  const response = await ctx.fetch(url, { headers: { accept: 'text/html', referer: url } })

  if (!response.ok) {
    throw new Error(`简书返回 ${response.status} ${response.statusText}`)
  }

  const entries = parseNotes(await response.text(), `jianshu-user-${id}`)

  if (entries.length === 0) {
    throw new Error('简书作者页没有文章列表，作者 id 可能不对或页面结构已经变了')
  }

  ctx.log.info(`jianshu: 作者 ${id} 共 ${entries.length} 篇文章`)

  return { entries }
}

export async function preview(ctx) {
  const url = ctx.item?.url
  if (!url) return null

  const content = await ctx.article(url)
  return content === null ? null : { content }
}
