// 每日精选 — a computed plugin, and a different computation from `aggregate`.
//
// aggregate adds up raw scores, which quietly assumes that Hacker News' points
// and Lobsters' points are the same unit. They are not: 300 points on Hacker
// News and 30 on Lobsters can be the same amount of attention. This one ranks
// by *position within its own source* instead, so every source contributes its
// own best and no single site can flood the feed, and it only looks at a recent
// window -- a digest of what happened, not an all-time leaderboard.
//
// That is the whole argument for computed feeds: no RSS feed and no RSSHub
// route can rank three different sites against each other this way.

export const meta = {
  id: 'rome.digest',
  name: '每日精选',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: '合并 Hacker News、Lobsters 与 V2EX 的近期热帖，按站内名次而非原始分数排序',
}

export const settings = {
  fields: [
    { key: 'hours', type: 'number', label: '时间窗口（小时）', default: 48, min: 1, max: 336 },
    { key: 'perSource', type: 'number', label: '每个来源最多几条', default: 6, min: 1, max: 20 },
    { key: 'limit', type: 'number', label: '最终条数', default: 24, min: 1, max: 100 },
    { key: 'mute', type: 'string', label: '屏蔽关键词', placeholder: '用逗号分隔', default: '' },
  ],
}

const HN = 'https://hn.algolia.com/api/v1'
const LOBSTERS = 'https://lobste.rs'
const V2EX = 'https://www.v2ex.com/api'

function integer(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(Math.max(parsed, min), max)
}

function seconds(iso) {
  const milliseconds = Date.parse(iso)
  return Number.isFinite(milliseconds) ? Math.floor(milliseconds / 1000) : undefined
}

/// Normalize a URL so the same article posted to two sites compares equal.
/// Without this the digest spends its per-source quota showing one link twice.
function canonical(url) {
  if (!url) return ''
  try {
    const parsed = new URL(url)
    parsed.hash = ''
    parsed.hostname = parsed.hostname.replace(/^www\./, '')
    for (const key of [...parsed.searchParams.keys()]) {
      if (key.startsWith('utm_') || key === 'ref' || key === 'source') parsed.searchParams.delete(key)
    }
    return parsed.toString().replace(/\/$/, '')
  } catch {
    return ''
  }
}

async function fromHackerNews(ctx, cutoff) {
  const url = new URL(`${HN}/search_by_date`)
  url.searchParams.set('tags', 'story')
  url.searchParams.set('hitsPerPage', '100')
  // Algolia applies the window and the score floor server-side, so the filter
  // travels in the request instead of the plugin downloading the firehose and
  // throwing most of it away. `search_by_date` rather than `search`, because
  // relevance ranking would surface a 2018 story with a huge score.
  url.searchParams.set('numericFilters', `points>0,created_at_i>${cutoff}`)

  const response = await ctx.fetch(url, { headers: { accept: 'application/json' } })

  if (!response.ok) {
    throw new Error(`Hacker News (Algolia) 返回 ${response.status} ${response.statusText}`)
  }

  const body = await response.json()

  if (!Array.isArray(body.hits)) {
    throw new Error('Hacker News (Algolia) 没有返回 hits 数组，接口可能已经变了')
  }

  return body.hits
    // `objectID` is the id below; a hit without one would collapse into
    // `hn:undefined` alongside every other such hit.
    .filter((hit) => hit.title && hit.objectID && Number.isFinite(Number(hit.created_at_i)))
    .map((hit) => ({
      id: `hn:${hit.objectID}`,
      title: hit.title,
      url: hit.url || `https://news.ycombinator.com/item?id=${hit.objectID}`,
      author: hit.author,
      publishedAt: Number(hit.created_at_i),
      score: hit.points ?? 0,
      label: `${hit.points ?? 0} 分 · ${hit.num_comments ?? 0} 条评论`,
      origin: 'Hacker News',
    }))
}

async function fromLobsters(ctx, cutoff) {
  const response = await ctx.fetch(`${LOBSTERS}/hottest.json`, { headers: { accept: 'application/json' } })

  if (!response.ok) {
    throw new Error(`Lobsters 返回 ${response.status} ${response.statusText}`)
  }

  const stories = await response.json()

  if (!Array.isArray(stories)) {
    throw new Error('Lobsters 没有返回故事数组，接口可能已经变了')
  }

  return stories
    .map((story) => ({
      id: `lobsters:${story.short_id}`,
      title: story.title,
      url: story.url || story.short_id_url,
      author: story.submitter_user,
      publishedAt: seconds(story.created_at),
      score: story.score ?? 0,
      label: `${story.score ?? 0} 分 · ${story.comment_count ?? 0} 条评论`,
      origin: 'Lobsters',
    }))
    // This endpoint has no filter, so the window is applied here. An unparseable
    // timestamp lands on `undefined` and drops out, which is the safe way round.
    // The guard is on `id`, not `short_id`: this runs after the map, which has
    // already turned the source field into the namespaced id.
    .filter((story) => story.title && story.id && story.publishedAt >= cutoff)
}

async function fromV2EX(ctx, cutoff) {
  const response = await ctx.fetch(`${V2EX}/topics/hot.json`, { headers: { accept: 'application/json' } })

  if (!response.ok) {
    throw new Error(`V2EX 返回 ${response.status} ${response.statusText}`)
  }

  const topics = await response.json()

  if (!Array.isArray(topics)) {
    throw new Error('V2EX 没有返回主题数组，接口可能已经变了')
  }

  return topics
    // The window is judged on `last_touched`, not `created`: V2EX's hot list is
    // about what is being discussed now, and a topic started last month with
    // eighty replies today is exactly that. `publishedAt` still reports the
    // creation time, because that is what the field means.
    .filter((topic) => topic.title && topic.id && (topic.last_touched ?? topic.created) >= cutoff)
    .map((topic) => ({
      id: `v2ex:${topic.id}`,
      title: topic.title,
      url: topic.url || `https://www.v2ex.com/t/${topic.id}`,
      author: topic.member?.username,
      publishedAt: topic.created,
      // V2EX publishes no score. Replies are the only signal it has, so the
      // label says "条回复" rather than dressing it up as points.
      score: topic.replies ?? 0,
      label: `${topic.replies ?? 0} 条回复 · ${topic.node?.title ?? ''}`.trim(),
      origin: 'V2EX',
    }))
}

/// Rank inside one source, then turn the rank into a 0..1 weight. This is the
/// line that makes the feed mixed: "the best story on V2EX" and "the best story
/// on Hacker News" end up worth the same, and the raw scores only decide the
/// order within a source, which is the one comparison where they mean the same
/// thing.
function rankWithin(items) {
  const sorted = [...items].sort((a, b) => b.score - a.score || b.publishedAt - a.publishedAt)
  const total = sorted.length || 1

  return sorted.map((item, index) => ({ ...item, weight: (total - index) / total }))
}

function toEntry(item) {
  return {
    id: item.id,
    title: item.title,
    url: item.url,
    author: item.author,
    publishedAt: item.publishedAt,
    summary: `${item.origin} · ${item.label}`,
  }
}

export async function fetch(ctx) {
  const hours = integer(ctx.settings.hours, 48, 1, 336)
  const perSource = integer(ctx.settings.perSource, 6, 1, 20)
  const limit = integer(ctx.settings.limit, 24, 1, 100)
  const muted = String(ctx.settings.mute ?? '')
    .split(',')
    .map((word) => word.trim().toLowerCase())
    .filter(Boolean)

  const cutoff = Math.floor(Date.now() / 1000) - hours * 3600

  // Three requests, in parallel. `Promise.all` rather than a partial-success
  // fold: a source that is down should fail the digest loudly and name itself,
  // not silently vanish from the feed.
  const [hackerNews, lobsters, v2ex] = await Promise.all([
    fromHackerNews(ctx, cutoff),
    fromLobsters(ctx, cutoff),
    fromV2EX(ctx, cutoff),
  ])

  // The window does most of the filtering, so the counts after it are the
  // numbers worth having in the log when a source looks absent from the feed.
  ctx.log.debug(`digest: 候选 Hacker News ${hackerNews.length}，Lobsters ${lobsters.length}，V2EX ${v2ex.length}`)

  // The same article posted to two of the three is one entry; keep the copy the
  // source ranked higher.
  const best = new Map()

  for (const item of [hackerNews, lobsters, v2ex].flatMap(rankWithin)) {
    const key = canonical(item.url) || item.id
    const previous = best.get(key)

    if (!previous || item.weight > previous.weight) {
      best.set(key, item)
    }
  }

  const ordered = [...best.values()]
    .filter((item) => !muted.some((word) => item.title.toLowerCase().includes(word)))
    .sort((a, b) => b.weight - a.weight || b.publishedAt - a.publishedAt)

  // The per-source quota, applied as the list is built. This is what stops the
  // site that simply posts the most from filling the digest on volume alone.
  const used = new Map()
  const chosen = []

  for (const item of ordered) {
    const taken = used.get(item.origin) ?? 0
    if (taken >= perSource) continue

    used.set(item.origin, taken + 1)
    chosen.push(item)

    if (chosen.length >= limit) break
  }

  const tally = [...used].map(([origin, count]) => `${origin} ${count}`).join('，')
  ctx.log.info(`digest: ${chosen.length} 条（${tally}）`)

  return { entries: chosen.map(toEntry) }
}
