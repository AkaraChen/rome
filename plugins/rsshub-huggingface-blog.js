// Ported from RSSHub lib/routes/huggingface/blog.ts (AGPL-3.0).
// Hugging Face 英文博客 — /huggingface/blog
//
// The blog API returns the post list and its authors together — `authorsData`
// is already inside each item — so there is no second request and no join.
//
// The list has no description field; the post's own summary lives in the page,
// which `preview` fetches when the entry is opened.

export const meta = {
  id: 'rome.rsshub-huggingface-blog',
  name: 'Hugging Face · 英文博客',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: 'Hugging Face 英文博客的最新文章',
  icon: 'https://huggingface.co/favicon.ico',
}

const API = 'https://huggingface.co/api/blog'
const HOST = 'https://huggingface.co'

function firstLine(text, limit) {
  const line = String(text ?? '').replace(/\s+/g, ' ').trim()
  if (!line) return undefined
  return line.length > limit ? `${line.slice(0, limit - 1)}…` : line
}

function cover(value) {
  if (!value) return undefined
  return value.startsWith('http') ? value : `${HOST}${value}`
}

export async function fetch(ctx) {
  const url = new URL(API)
  url.searchParams.set('limit', '30')

  const response = await ctx.fetch(url, { headers: { accept: 'application/json' } })

  if (!response.ok) {
    throw new Error(`Hugging Face 返回 ${response.status}`)
  }

  const blogs = (await response.json()).allBlogs

  if (!Array.isArray(blogs)) {
    throw new Error('Hugging Face 没有返回博客数组，接口可能已经变了')
  }

  const entries = blogs.map((blog) => {
    const authors = (blog.authorsData || []).map((author) => author.fullname || author.name).filter(Boolean)

    const entry = {
      id: `huggingface-blog:${blog.slug}`,
      title: blog.title,
      url: `${HOST}${blog.url || `/blog/${blog.slug}`}`,
      author: authors.join(', ') || undefined,
      summary: blog.upvotes ? `${blog.upvotes} 赞` : undefined,
    }

    const image = cover(blog.thumbnail)
    if (image) entry.image = image

    const publishedAt = Date.parse(blog.publishedAt || '')
    if (Number.isFinite(publishedAt)) entry.publishedAt = Math.floor(publishedAt / 1000)

    return entry
  })

  ctx.log.info(`huggingface-blog: ${entries.length} 条`)

  return { entries }
}

export async function preview(ctx) {
  const content = await ctx.article(ctx.item.url)
  return content ? { content } : null
}
