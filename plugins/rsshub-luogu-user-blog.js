// Ported from RSSHub lib/routes/luogu/user-blog.ts (AGPL-3.0).
// 洛谷用户博客 — the blog page ships the article list and the user as JSON in
// <script id="lentille-context">. The article body is left to preview.

export const meta = {
  id: 'rome.rsshub-luogu-user-blog',
  name: '洛谷 · 用户博客',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: '洛谷用户博客的文章列表',
  icon: 'https://www.luogu.com.cn/favicon.ico',
  params: {
    fields: [
      {
        key: 'name',
        type: 'text',
        label: '博客名称',
        help: '博客地址中 blog 后面的名字，例如 ftiasch',
        required: true,
        default: ''
      }
    ]
  }
}

const BASE = 'https://www.luogu.com.cn'

export function pageData(html) {
  const match = /<script id="lentille-context"[^>]*>([\s\S]*?)<\/script>/.exec(html)

  if (!match) {
    throw new Error('洛谷页面没有找到 lentille-context 数据')
  }

  try {
    return JSON.parse(match[1]).data
  } catch (error) {
    throw new Error(`洛谷页面数据不是合法 JSON：${error.message}`)
  }
}

export function renderMarkdown(text) {
  const escaped = String(text == null ? '' : text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')

  return escaped
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => `<p>${block.replaceAll('\n', '<br>')}</p>`)
    .join('')
}

async function read(ctx, url) {
  const response = await ctx.fetch(url, { headers: { accept: 'text/html' } })

  if (!response.ok) {
    throw new Error(`洛谷返回 ${response.status} ${response.statusText}`)
  }

  return response.text()
}

export async function fetch(ctx) {
  const name = String(ctx.params.name || '').trim()

  if (!name) {
    throw new Error('洛谷博客名称不能为空，请在博客地址中查找')
  }

  const url = `${BASE}/blog/${encodeURIComponent(name)}/`
  const data = pageData(await read(ctx, url))
  const articles = data?.articles?.result

  if (!Array.isArray(articles)) {
    throw new Error(`洛谷用户 ${name} 没有返回文章列表`)
  }

  const entries = articles.map((article) => {
    const entry = {
      id: `luogu:blog:${article.lid}`,
      title: article.title || '（无标题）',
      url: `${BASE}/article/${article.lid}`,
      params: { articleId: article.lid }
    }

    if (article.author?.name) {
      entry.author = article.author.name
    }

    const publishedAt = Number(article.time)
    if (Number.isFinite(publishedAt) && publishedAt > 0) {
      entry.publishedAt = Math.floor(publishedAt)
    }

    return entry
  })

  return { entries, icon: data?.user?.avatar || undefined }
}

export async function preview(ctx) {
  const articleId = ctx.item?.params?.articleId
  if (!articleId) return null

  const content = pageData(await read(ctx, `${BASE}/article/${articleId}`))?.article?.content
  return content ? { content: renderMarkdown(content) } : null
}
