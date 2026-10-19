// Ported from RSSHub lib/routes/cosplaytele/category.ts (AGPL-3.0).
// CosplayTele — 分类图集。
//
// 分类先按 slug 查出数字 id，再拿该分类下的文章。REST 接口一次就把正文
// （含全部大图）带回来了，所以列表里直接放正文。

export const meta = {
  id: 'rome.rsshub-cosplaytele-category',
  name: 'CosplayTele · 分类',
  version: '1.0.0',
  apiVersion: '1',
  view: 'pictures',
  description: '抓取 CosplayTele 某个分类下的图集',
  icon: 'https://cosplaytele.com/favicon.ico',
  params: {
    fields: [
      {
        key: 'category',
        type: 'text',
        label: '分类',
        help: '分类 slug，即分类页 URL 中的名字，例如 cosplay',
        default: '',
      },
    ],
  },
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
  const category = String(ctx.params.category || '').trim()

  if (!category) {
    throw new Error('请填写分类 slug，例如 cosplay')
  }

  const termUrl = `${ROOT}wp-json/wp/v2/categories?slug=${encodeURIComponent(category)}`

  ctx.log.debug(`cosplaytele: GET ${termUrl}`)

  const termResponse = await ctx.fetch(termUrl, { headers: { accept: 'application/json' } })

  if (!termResponse.ok) {
    throw new Error(`CosplayTele 返回 ${termResponse.status} ${termResponse.statusText}`)
  }

  const terms = await termResponse.json()

  if (!Array.isArray(terms) || terms.length === 0 || !terms[0]?.id) {
    throw new Error(`CosplayTele 没有找到分类 ${category}`)
  }

  const url = `${ROOT}wp-json/wp/v2/posts?categories=${terms[0].id}&per_page=20`

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
    throw new Error(`CosplayTele 分类 ${category} 下没有图集`)
  }

  ctx.log.info(`cosplaytele: ${category} 共 ${entries.length} 个图集`)

  return { entries }
}
