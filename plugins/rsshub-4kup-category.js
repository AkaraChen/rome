// Ported from RSSHub lib/routes/4kup/category.ts (AGPL-3.0).
// 4KUP — 分类图集。
//
// 分类先按 slug 查出数字 id，再拿该分类下的文章。正文里的缩略图被懒加载
// 的占位图挡着，换成 a.thumb-photo 指向的大图。

export const meta = {
  id: 'rome.rsshub-4kup-category',
  name: '4KUP · 分类',
  version: '1.0.0',
  apiVersion: '1',
  view: 'pictures',
  description: '抓取 4KUP 某个分类下的图集',
  icon: 'https://4kup.net/favicon.ico',
  params: {
    fields: [
      {
        key: 'category',
        type: 'text',
        label: '分类',
        help: '分类 slug，即分类页 URL 中的名字，例如 coser',
        default: '',
      },
    ],
  },
}

const ROOT = 'https://4kup.net/'

function seconds(dateGmt) {
  const milliseconds = Date.parse(`${dateGmt}Z`)
  return Number.isFinite(milliseconds) ? Math.floor(milliseconds / 1000) : undefined
}

/// 懒加载把 img 的 src 换成了占位图，真正的大图在 a.thumb-photo 的 href 上。
function renderContent(html) {
  return String(html ?? '')
    .replace(/<a\b[^>]*class="thumb-photo"[^>]*>[\s\S]*?<\/a>/g, (match) => {
      const href = /href="([^"]+)"/.exec(match)?.[1]
      return href ? `<img src="${href}">` : ''
    })
    .replace(/<div\b[^>]*class="caption"[^>]*>[\s\S]*?<\/div>/g, '')
}

function firstPhoto(html) {
  const tag = /<a\b[^>]*class="thumb-photo"[^>]*>/.exec(String(html ?? ''))
  if (!tag) return undefined
  return /href="([^"]+)"/.exec(tag[0])?.[1]
}

function postToEntry(post) {
  const content = renderContent(post?.content?.rendered)

  const entry = {
    id: `4kup:${post.id}`,
    title: String(post?.title?.rendered ?? '').trim(),
    url: post.link,
    content,
  }

  const publishedAt = seconds(post.date_gmt)
  if (publishedAt !== undefined) entry.publishedAt = publishedAt

  const image = firstPhoto(post?.content?.rendered)
  if (image) entry.image = image

  return entry
}

export async function fetch(ctx) {
  const category = String(ctx.params.category || '').trim()

  if (!category) {
    throw new Error('请填写分类 slug，例如 coser')
  }

  const termUrl = `${ROOT}wp-json/wp/v2/categories?slug=${encodeURIComponent(category)}`

  ctx.log.debug(`4kup: GET ${termUrl}`)

  const termResponse = await ctx.fetch(termUrl, { headers: { accept: 'application/json' } })

  if (!termResponse.ok) {
    throw new Error(`4KUP 返回 ${termResponse.status} ${termResponse.statusText}`)
  }

  const terms = await termResponse.json()

  if (!Array.isArray(terms) || terms.length === 0 || !terms[0]?.id) {
    throw new Error(`4KUP 没有找到分类 ${category}`)
  }

  const url = `${ROOT}wp-json/wp/v2/posts?categories=${terms[0].id}&per_page=20`

  ctx.log.debug(`4kup: GET ${url}`)

  const response = await ctx.fetch(url, { headers: { accept: 'application/json' } })

  if (!response.ok) {
    throw new Error(`4KUP 返回 ${response.status} ${response.statusText}`)
  }

  const posts = await response.json()

  if (!Array.isArray(posts)) {
    throw new Error('4KUP 接口没有返回文章数组，接口可能已经变了')
  }

  const entries = posts.map(postToEntry).filter((entry) => entry.title)

  if (entries.length === 0) {
    throw new Error(`4KUP 分类 ${category} 下没有图集`)
  }

  ctx.log.info(`4kup: ${category} 共 ${entries.length} 个图集`)

  return { entries }
}
