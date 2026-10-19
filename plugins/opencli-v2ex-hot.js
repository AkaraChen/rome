// Ported from OpenCLI clis/v2ex/hot.js (Apache-2.0).
// V2EX 热门话题 — one JSON request, one map.
//
// The API returns the whole list in one response, and the site's own topic id
// is the stable key, so there is no cursor and nothing to scrape.

export const meta = {
  id: 'rome.opencli-v2ex-hot',
  name: 'V2EX · 热门话题',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: '抓取 V2EX 当前的热门话题。',
  icon: 'https://www.v2ex.com/favicon.ico',
  params: {
    fields: [
      {
        key: 'limit',
        type: 'number',
        label: '条数',
        help: '每次抓取的条目数',
        default: 20,
        min: 1,
        max: 100,
      },
    ],
  },
}

const HOT = 'https://www.v2ex.com/api/topics/hot.json'

function integer(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10)

  if (!Number.isFinite(parsed)) {
    return fallback
  }

  return Math.min(Math.max(parsed, min), max)
}

function summary(topic) {
  const parts = []
  const node = topic.node?.title
  const replies = topic.replies ?? 0

  if (node) {
    parts.push(node)
  }

  parts.push(`${replies} 条回复`)

  return parts.join(' · ')
}

export async function fetch(ctx) {
  const limit = integer(ctx.params.limit, 20, 1, 100)

  ctx.log.debug(`v2ex-hot: GET ${HOT}`)

  const response = await ctx.fetch(HOT, { headers: { accept: 'application/json' } })

  if (!response.ok) {
    throw new Error(`V2EX 返回 ${response.status} ${response.statusText}`)
  }

  const topics = await response.json()

  if (!Array.isArray(topics)) {
    throw new Error('V2EX 没有返回话题数组，接口可能已经变了')
  }

  const entries = []

  for (const topic of topics) {
    // A topic without an id would collapse every such item into `v2ex:undefined`.
    if (!topic.id || !topic.title) {
      continue
    }

    const entry = {
      id: `v2ex:${topic.id}`,
      title: topic.title,
      url: topic.url,
      summary: summary(topic),
    }

    if (topic.member?.username) {
      entry.author = topic.member.username
    }

    // V2EX's `created` is already unix seconds.
    if (Number.isFinite(topic.created)) {
      entry.publishedAt = topic.created
    }

    entries.push(entry)

    if (entries.length >= limit) {
      break
    }
  }

  if (entries.length === 0) {
    throw new Error('V2EX 没有返回话题，接口可能已经变了')
  }

  return { entries }
}

// Topic pages are server-rendered, so the host's extractor can turn one into
// the post itself.
export async function preview(ctx) {
  const content = await ctx.article(ctx.item.url)

  return content === null ? null : { content }
}
