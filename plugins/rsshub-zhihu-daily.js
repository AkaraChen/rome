// Ported from RSSHub lib/routes/zhihu/daily.ts (AGPL-3.0).
// 知乎日报 — two JSON endpoints.
//
// `/api/4/stories/latest` hands back the day's stories with a title, a link, an
// image and a one-line hint, so the list needs no HTML parsing at all. The full
// body lives one request further on, per story, which is exactly what preview
// is for: fetch the listing, and read a body only when someone opens it.
//
// The three stories share the day's `date`, so they share a publishedAt; the
// ids are still what Rome deduplicates on.

export const meta = {
  id: 'rome.rsshub-zhihu-daily',
  name: '知乎 · 日报',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: '知乎日报每天的最新三条，打开后可读全文',
  icon: 'https://daily.zhihu.com/favicon.ico',
}

const LATEST = 'https://daily.zhihu.com/api/4/stories/latest'
const STORY = 'https://daily.zhihu.com/api/4/story/'

function decode(text) {
  return String(text).replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (match, entity) => {
    if (entity[0] === '#') {
      const code = entity[1] === 'x' || entity[1] === 'X'
        ? Number.parseInt(entity.slice(2), 16)
        : Number.parseInt(entity.slice(1), 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : match
    }
    return match
  })
}

function plain(html, limit) {
  const text = decode(String(html ?? '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim()
  if (!limit || text.length <= limit) return text
  return `${text.slice(0, limit).replace(/\s+$/, '')}…`
}

/// The listing's date is `YYYYMMDD` in China Standard Time, and the stories go
/// out at midnight there. Build the instant explicitly rather than letting a
/// date parser guess a timezone.
function midnightChina(value) {
  const match = /^(\d{4})(\d{2})(\d{2})$/.exec(String(value ?? ''))
  if (!match) return undefined

  const milliseconds = Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    0, 0, 0,
  ) - 8 * 60 * 60 * 1000

  return Number.isFinite(milliseconds) ? Math.floor(milliseconds / 1000) : undefined
}

export async function fetch(ctx) {
  ctx.log.debug(`zhihu-daily: GET ${LATEST}`)

  const response = await ctx.fetch(LATEST, {
    headers: { accept: 'application/json', referer: 'https://daily.zhihu.com/' },
  })

  if (!response.ok) {
    throw new Error(`知乎日报返回 ${response.status} ${response.statusText}`)
  }

  const body = await response.json()

  if (!Array.isArray(body.stories)) {
    throw new Error('知乎日报没有返回 stories 数组，接口可能已经变了')
  }

  const publishedAt = midnightChina(body.date)
  const entries = []

  for (const story of body.stories) {
    if (!story?.id || !story.title) continue

    // `hint` is "作者 · N 分钟阅读"; the author is the part before the dot.
    const hint = plain(story.hint)
    const author = hint.split('·')[0].trim()

    const entry = {
      id: `zhihu:daily:${story.id}`,
      title: plain(story.title),
      url: story.url || `https://daily.zhihu.com/story/${story.id}`,
      summary: hint,
      params: { id: String(story.id) },
    }

    if (author) entry.author = author
    if (Array.isArray(story.images) && story.images.length > 0) entry.image = story.images[0]
    if (publishedAt !== undefined) entry.publishedAt = publishedAt

    entries.push(entry)
  }

  if (entries.length === 0) {
    throw new Error('知乎日报返回了 0 条可解析的故事，页面结构可能已经变了')
  }

  ctx.log.info(`zhihu-daily: ${entries.length} 条`)

  return { entries }
}

export async function preview(ctx) {
  const id = ctx.item?.params?.id || String(ctx.item?.id ?? '').replace(/^zhihu:daily:/, '')
  if (!id) return null

  const url = `${STORY}${encodeURIComponent(id)}`
  ctx.log.debug(`zhihu-daily: GET ${url}`)

  const response = await ctx.fetch(url, {
    headers: { accept: 'application/json', referer: 'https://daily.zhihu.com/' },
  })

  if (!response.ok) {
    throw new Error(`知乎日报详情返回 ${response.status} ${response.statusText}`)
  }

  const story = await response.json()
  if (!story?.body) return null

  return { content: story.body }
}
