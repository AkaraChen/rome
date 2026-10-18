// Bluesky — a fetcher plugin for a social timeline.
//
// The public AppView at public.api.bsky.app answers unauthenticated reads,
// which is rare for a social network and is the whole reason this can ship
// without a login: a source that needed a key would be broken for everyone who
// has not set one up. Point `actor` at any handle or DID.
//
// The cursor is the AppView's own. Returning it means each refresh walks
// further back through the account's history -- a backfill -- rather than
// re-reading the same newest posts. When the history runs out the API returns
// no cursor, this returns null, and the next refresh starts at the top again.

export const meta = {
  id: 'rome.bluesky',
  name: 'Bluesky',
  version: '1.0.0',
  apiVersion: '1',
  view: 'socialMedia',
  description: '任意 Bluesky 账号的公开动态时间线',
}

export const settings = {
  fields: [
    {
      key: 'actor',
      type: 'string',
      label: '账号',
      description: 'handle（如 bsky.app）或 DID',
      default: 'bsky.app',
    },
    {
      key: 'filter',
      type: 'select',
      label: '内容',
      default: 'posts_no_replies',
      options: [
        { value: 'posts_no_replies', label: '不含回复' },
        { value: 'posts_with_replies', label: '含回复' },
        { value: 'posts_with_media', label: '仅带媒体' },
      ],
    },
    { key: 'limit', type: 'number', label: '每次抓取条数', default: 30, min: 1, max: 100 },
  ],
}

const API = 'https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed'

// The API's filter values, not labels; an unknown one is a 400, so a typo in a
// hand-edited setting should not reach the wire.
const FILTERS = new Set(['posts_no_replies', 'posts_with_replies', 'posts_with_media'])

function integer(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(Math.max(parsed, min), max)
}

/// A post's `at://` URI ends in its record key, which is the last segment of
/// the web URL too -- that is how the two forms are made to address one thing.
function postUrl(post) {
  const key = String(post.uri).split('/').pop()
  return `https://bsky.app/profile/${post.author.handle}/post/${key}`
}

/// A social view still wants a title, and the first line of a post is the
/// closest thing it has to one. An image-only post has no text at all.
function titleOf(text) {
  const firstLine = String(text).split('\n').map((line) => line.trim()).find((line) => line !== '')
  if (!firstLine) return '（无文字）'
  return firstLine.length > 80 ? `${firstLine.slice(0, 79)}…` : firstLine
}

/// The first image in a post's embed, if it has one. Two embed shapes carry
/// images -- a gallery and a link card -- and only the gallery is worth
/// reaching into for a thumbnail.
function imageOf(embed) {
  const images = embed?.images
  return Array.isArray(images) && images.length > 0 ? images[0].thumb : undefined
}

export async function fetch(ctx) {
  const actor = String(ctx.settings.actor || 'bsky.app').trim()
  const filter = FILTERS.has(ctx.settings.filter) ? ctx.settings.filter : 'posts_no_replies'
  const limit = integer(ctx.settings.limit, 30, 1, 100)

  const url = new URL(API)
  url.searchParams.set('actor', actor)
  url.searchParams.set('limit', String(limit))
  url.searchParams.set('filter', filter)

  if (ctx.cursor) {
    url.searchParams.set('cursor', ctx.cursor)
  }

  ctx.log.debug(`bluesky: GET ${url.href}`)

  const response = await ctx.fetch(url, { headers: { accept: 'application/json' } })

  if (!response.ok) {
    // The AppView explains itself in `{ error, message }`, and that text is far
    // more useful than a bare status when the actor handle is the problem.
    const detail = await response.json().catch(() => null)
    const reason = detail?.message ?? detail?.error ?? response.statusText
    throw new Error(`Bluesky 返回 ${response.status}：${reason}（actor=${actor}）`)
  }

  const body = await response.json()

  if (!Array.isArray(body.feed)) {
    throw new Error('Bluesky 没有返回 feed 数组，接口可能已经变了')
  }

  // The post URI is the id below and the handle is in the URL; an item missing
  // either is not a post this plugin can represent, and quietly emitting
  // `bluesky:undefined` would collapse all such items into one entry.
  const malformed = body.feed.find((item) => !item?.post?.uri || !item?.post?.author?.handle)

  if (malformed) {
    throw new Error('Bluesky 返回了一条没有 uri 或作者的动态，接口可能已经变了')
  }

  const entries = body.feed.map(({ post }) => {
    const text = post.record?.text ?? ''

    const entry = {
      // The post's `at://` URI is its permanent address on the network, so it is
      // the one thing here that cannot change.
      id: `bluesky:${post.uri}`,
      title: titleOf(text),
      url: postUrl(post),
      author: post.author.displayName || post.author.handle,
      summary: `${post.likeCount ?? 0} 赞 · ${post.repostCount ?? 0} 转发 · ${post.replyCount ?? 0} 回复`,
      content: text,
    }

    const image = imageOf(post.embed)
    if (image) entry.image = image

    const publishedAt = Date.parse(post.record?.createdAt ?? post.indexedAt)
    if (Number.isFinite(publishedAt)) entry.publishedAt = Math.floor(publishedAt / 1000)

    return entry
  })

  ctx.log.info(`bluesky: ${entries.length} 条 (${actor})`)

  return { entries, cursor: body.cursor ?? null }
}
