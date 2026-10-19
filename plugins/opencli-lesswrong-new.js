// Ported from OpenCLI clis/lesswrong/new.js (Apache-2.0).
// LessWrong 最新 — the site's own GraphQL endpoint, view "new".

export const meta = {
  id: 'rome.opencli-lesswrong-new',
  name: 'LessWrong · 最新',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: '抓取 LessWrong 最新发布的文章。',
  icon: 'https://www.lesswrong.com/favicon.ico',
  params: {
    fields: [
      {
        key: 'limit',
        type: 'number',
        label: '条数',
        help: '每次抓取的条目数',
        default: 10,
        min: 1,
        max: 100,
      },
    ],
  },
}

const DOMAIN = 'www.lesswrong.com'
const GRAPHQL_URL = `https://${DOMAIN}/graphql`

function integer(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10)

  if (!Number.isFinite(parsed)) {
    return fallback
  }

  return Math.min(Math.max(parsed, min), max)
}

/// Unix seconds, or undefined for a timestamp the API did not give in a shape
/// `Date.parse` understands.
function seconds(iso) {
  const milliseconds = Date.parse(iso)

  return Number.isFinite(milliseconds) ? Math.floor(milliseconds / 1000) : undefined
}

function summary(post) {
  const parts = [`${post.baseScore ?? 0} 分`, `${post.commentCount ?? 0} 条评论`]
  const tags = Array.isArray(post.tags)
    ? post.tags.map((tag) => tag.name).filter(Boolean)
    : []

  if (tags.length > 0) {
    parts.push(tags.map((tag) => `#${tag}`).join(' '))
  }

  return parts.join(' · ')
}

export async function fetch(ctx) {
  const limit = integer(ctx.params.limit, 10, 1, 100)

  const query = `query PostsList {
    posts(input: {terms: {view: "new", limit: ${limit}}}) {
      results { _id title user { displayName } baseScore commentCount slug postedAt tags { name } }
    }
  }`

  ctx.log.debug(`lesswrong-new: POST ${GRAPHQL_URL}`)

  const response = await ctx.fetch(GRAPHQL_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ query }),
  })

  if (!response.ok) {
    throw new Error(`LessWrong 返回 ${response.status} ${response.statusText}`)
  }

  const payload = await response.json()

  if (Array.isArray(payload.errors) && payload.errors.length > 0) {
    throw new Error(`LessWrong GraphQL 返回错误：${payload.errors[0]?.message ?? '未知错误'}`)
  }

  const posts = payload.data?.posts?.results

  if (!Array.isArray(posts)) {
    throw new Error('LessWrong 没有返回文章列表，接口可能已经变了')
  }

  const entries = posts
    .filter((post) => post._id && post.title)
    .map((post) => {
      const entry = {
        id: `lw:${post._id}`,
        title: post.title,
        url: post.slug
          ? `https://${DOMAIN}/posts/${post._id}/${post.slug}`
          : `https://${DOMAIN}/posts/${post._id}`,
        summary: summary(post),
      }

      if (post.user?.displayName) {
        entry.author = post.user.displayName
      }

      const publishedAt = seconds(post.postedAt)

      if (publishedAt !== undefined) {
        entry.publishedAt = publishedAt
      }

      return entry
    })

  if (entries.length === 0) {
    throw new Error('LessWrong 没有返回文章，接口可能已经变了')
  }

  return { entries }
}

// LessWrong renders post pages on the server, so the host's extractor can read
// the body when the entry is opened.
export async function preview(ctx) {
  const content = await ctx.article(ctx.item.url)

  return content === null ? null : { content }
}
