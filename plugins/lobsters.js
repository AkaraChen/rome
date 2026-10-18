// Lobsters — a fetcher plugin.
//
// The smallest correct shape: one JSON request, one array, one map. Lobsters
// serves its hot list as JSON, so there is nothing to scrape and nothing that
// breaks the day the site is redesigned -- which is the reason to prefer a JSON
// API over HTML whenever the site has one.
//
// Only the hot list is offered, even though the site has newest/active pages:
// their JSON forms answered 500 when this was written, and a bundled source
// should not ship options that fail. Add them back when they serve JSON again.
//
// There is no cursor here on purpose. `hottest` is a ranked list that churns,
// so re-reading the top of it every refresh is right, and Rome works out what
// is new by comparing ids.

export const meta = {
  id: 'rome.lobsters',
  name: 'Lobsters',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: 'Lobsters 技术社区的热门故事',
}

export const settings = {
  fields: [
    { key: 'limit', type: 'number', label: '每次抓取条数', default: 25, min: 1, max: 100 },
    { key: 'minScore', type: 'number', label: '最低分数', default: 0, min: 0 },
  ],
}

const HOTTEST = 'https://lobste.rs/hottest.json'

function integer(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(Math.max(parsed, min), max)
}

/// Unix seconds, or undefined for a timestamp the API did not give in a shape
/// `Date.parse` understands. The harness rejects a non-finite `publishedAt`, so
/// this is the difference between a missing date and a failed fetch.
function seconds(iso) {
  const milliseconds = Date.parse(iso)
  return Number.isFinite(milliseconds) ? Math.floor(milliseconds / 1000) : undefined
}

function summary(story) {
  const parts = [`${story.score ?? 0} 分`, `${story.comment_count ?? 0} 条评论`]
  if (Array.isArray(story.tags) && story.tags.length > 0) {
    parts.push(story.tags.map((tag) => `#${tag}`).join(' '))
  }
  return parts.join(' · ')
}

export async function fetch(ctx) {
  const limit = integer(ctx.settings.limit, 25, 1, 100)
  const minScore = integer(ctx.settings.minScore, 0, 0, Number.MAX_SAFE_INTEGER)

  ctx.log.debug(`lobsters: GET ${HOTTEST}`)

  const response = await ctx.fetch(HOTTEST, { headers: { accept: 'application/json' } })

  if (!response.ok) {
    throw new Error(`Lobsters 返回 ${response.status} ${response.statusText}`)
  }

  const stories = await response.json()

  if (!Array.isArray(stories)) {
    throw new Error('Lobsters 没有返回故事数组，接口可能已经变了')
  }

  const entries = []

  for (const story of stories) {
    // `short_id` is the id below; skipping an item without one is better than
    // emitting `lobsters:undefined` for every such item and collapsing them.
    if (!story.title || !story.short_id || (story.score ?? 0) < minScore) continue

    const entry = {
      // `short_id` is permanent -- it is the slug in `lobste.rs/s/<short_id>` --
      // so it survives a retitle, which a title-derived id would not.
      id: `lobsters:${story.short_id}`,
      title: story.title,
      // Text-only posts carry an empty `url`; their story page is the link.
      url: story.url || story.short_id_url,
      // A plain string here, not the `{ username }` object the /u/ endpoints use.
      author: story.submitter_user,
      summary: summary(story),
    }

    const publishedAt = seconds(story.created_at)
    if (publishedAt !== undefined) entry.publishedAt = publishedAt

    entries.push(entry)
    if (entries.length >= limit) break
  }

  ctx.log.info(`lobsters: ${entries.length} 条`)

  return { entries }
}
