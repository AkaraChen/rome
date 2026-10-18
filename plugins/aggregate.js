// Aggregate — a *computed* plugin.
//
// This is the shape that justifies running JavaScript at all. A fetcher plugin
// is just an RSS reader with a harder authoring story; a computed plugin
// produces a feed that no RSS feed and no RSSHub route can produce, because the
// item stream is assembled rather than read off a page.
//
// Here that means: read two communities, fold them into one shape, drop
// duplicates that both communities linked, rank, and cut. Change the ranking
// line and you have a different feed — no scraping, nothing that breaks when
// either site redesigns, and a reader could reasonably write this themselves.

export const meta = {
  id: 'rome.aggregate',
  name: '聚合热榜',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: '合并 Hacker News 与 Lobsters，去重后按热度排序',
}

export const settings = {
  fields: [
    { key: 'limit', type: 'number', label: '最终条数', default: 25, min: 1, max: 100 },
    { key: 'minPoints', type: 'number', label: '最低分数', default: 20, min: 0 },
    {
      key: 'mute',
      type: 'string',
      label: '屏蔽关键词',
      placeholder: '用逗号分隔',
      default: '',
    },
  ],
}

const HN = 'https://hacker-news.firebaseio.com/v0'
const LOBSTERS = 'https://lobste.rs'

/// Normalize a URL so the same article posted to both sites compares equal.
/// Without this the dedupe misses on trailing slashes, `www.`, and the
/// tracking parameters both sites add.
function canonical(url) {
  if (!url) return ''
  try {
    const parsed = new URL(url)
    parsed.hash = ''
    parsed.hostname = parsed.hostname.replace(/^www\./, '')
    for (const key of [...parsed.searchParams.keys()]) {
      if (key.startsWith('utm_') || key === 'ref' || key === 'source') {
        parsed.searchParams.delete(key)
      }
    }
    return parsed.toString().replace(/\/$/, '')
  } catch {
    // One malformed link is not worth failing the whole feed over; the entry
    // keeps its id as the dedupe key instead of its URL.
    return ''
  }
}

async function fromHackerNews(ctx, count) {
  const top = await ctx.fetch(`${HN}/topstories.json`)

  if (!top.ok) {
    throw new Error(`Hacker News 返回 ${top.status} ${top.statusText}`)
  }

  const ids = (await top.json()).slice(0, count)

  const stories = await Promise.all(
    ids.map(async (id) => {
      const response = await ctx.fetch(`${HN}/item/${id}.json`)
      return response.json()
    }),
  )

  return stories
    .filter((story) => story && !story.deleted && !story.dead)
    .map((story) => ({
      id: `hn:${story.id}`,
      title: story.title,
      url: story.url ?? `https://news.ycombinator.com/item?id=${story.id}`,
      author: story.by,
      publishedAt: story.time,
      points: story.score ?? 0,
      comments: story.descendants ?? 0,
      origin: 'Hacker News',
    }))
}

async function fromLobsters(ctx, count) {
  const response = await ctx.fetch(`${LOBSTERS}/hottest.json`)

  if (!response.ok) {
    throw new Error(`Lobsters 返回 ${response.status} ${response.statusText}`)
  }

  const stories = (await response.json()).slice(0, count)

  return stories.map((story) => {
    const entry = {
      id: `lobsters:${story.short_id}`,
      title: story.title,
      // Text-only posts carry an empty `url`; their story page is the link.
      url: story.url || story.short_id_url,
      // A plain string on this endpoint, not the `{ username }` object the /u/
      // endpoints return.
      author: story.submitter_user,
      points: story.score ?? 0,
      comments: story.comment_count ?? 0,
      origin: 'Lobsters',
    }

    // A non-finite `publishedAt` fails the whole fetch in the harness, so a
    // malformed timestamp is better left off than passed through as NaN.
    const milliseconds = Date.parse(story.created_at)
    if (Number.isFinite(milliseconds)) entry.publishedAt = Math.floor(milliseconds / 1000)

    return entry
  })
}

function integer(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(Math.max(parsed, min), max)
}

export async function fetch(ctx) {
  const limit = integer(ctx.settings.limit, 25, 1, 100)
  const minPoints = integer(ctx.settings.minPoints, 20, 0, Number.MAX_SAFE_INTEGER)
  const muted = String(ctx.settings.mute ?? '')
    .split(',')
    .map((word) => word.trim().toLowerCase())
    .filter(Boolean)

  ctx.log.debug(`aggregate: 取回两个来源各 ${limit * 2} 条`)

  // Ask for more than we will return, because the dedupe below removes some.
  const [hackerNews, lobsters] = await Promise.all([
    fromHackerNews(ctx, limit * 2),
    fromLobsters(ctx, limit * 2),
  ])

  const seen = new Set()
  const entries = []

  for (const story of [...hackerNews, ...lobsters]) {
    if (!story.title || story.points < minPoints) continue

    const key = canonical(story.url) || story.id
    if (seen.has(key)) continue
    seen.add(key)

    const haystack = story.title.toLowerCase()
    if (muted.some((word) => haystack.includes(word))) continue

    entries.push({
      id: story.id,
      title: story.title,
      url: story.url,
      author: story.author,
      publishedAt: story.publishedAt,
      summary: `${story.points} 分 · ${story.comments} 条评论 · ${story.origin}`,
      // Ranking lives here and nowhere else. This is the line a reader would
      // change to make the feed their own.
      _rank: story.points + story.comments * 0.5,
    })
  }

  entries.sort((a, b) => b._rank - a._rank)

  ctx.log.info(`aggregate: 去重后 ${entries.length} 条，取前 ${Math.min(limit, entries.length)} 条`)

  return {
    // Underscore-prefixed fields are ours; Rome stores what it recognises and
    // ignores the rest.
    entries: entries.slice(0, limit).map(({ _rank, ...entry }) => entry),
  }
}
