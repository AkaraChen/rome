// Ported from RSSHub lib/routes/cosplaytele/latest.ts (AGPL-3.0).
// CosplayTele — 最新图集。
//
// 站点是 WordPress，REST 接口一次就把正文（含全部大图）带回来了，所以列表
// 里直接放正文，不再逐篇抓页面。

export const meta = {
  id: 'rome.rsshub-cosplaytele-latest',
  name: 'CosplayTele · 最新',
  version: '1.0.0',
  apiVersion: '1',
  view: 'pictures',
  description: '抓取 CosplayTele 最新发布的图集',
  icon: 'https://cosplaytele.com/favicon.ico',
}

const ROOT = 'https://cosplaytele.com/'

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

function seconds(dateGmt) {
  const milliseconds = Date.parse(`${dateGmt}Z`)
  return Number.isFinite(milliseconds) ? Math.floor(milliseconds / 1000) : undefined
}

function firstImage(html) {
  return /<img\b[^>]*\bsrc="([^"]+)"/.exec(String(html ?? ''))?.[1]
}

function postToEntry(post) {
  const content = String(post?.content?.rendered ?? '')

  const entry = {
    id: `cosplaytele:${post.id}`,
    title: decode(String(post?.title?.rendered ?? '')).replace(/\s+/g, ' ').trim(),
    url: post.link,
    content,
  }

  const publishedAt = seconds(post.date_gmt)
  if (publishedAt !== undefined) entry.publishedAt = publishedAt

  const image = firstImage(content)
  if (image) entry.image = decode(image)

  return entry
}

export async function fetch(ctx) {
  const url = `${ROOT}wp-json/wp/v2/posts?per_page=20`

  ctx.log.debug(`cosplaytele: GET ${url}`)

  const response = await ctx.fetch(url, { headers: { accept: 'application/json' } })

  if (!response.ok) {
    throw new Error(`CosplayTele 返回 ${response.status} ${response.statusText}`)
  }

  const posts = await response.json()

  if (!Array.isArray(posts)) {
    throw new Error('CosplayTele 接口没有返回文章数组，接口可能已经变了')
  }

  const entries = posts.map(postToEntry).filter((entry) => entry.title)

  if (entries.length === 0) {
    throw new Error('CosplayTele 接口没有返回任何图集')
  }

  ctx.log.info(`cosplaytele: ${entries.length} 个图集`)

  return { entries }
}
