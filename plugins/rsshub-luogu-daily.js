// Ported from RSSHub lib/routes/luogu/daily.ts (AGPL-3.0).
// 洛谷日报 — the index is a discussion post whose content links to the article
// collection; that collection then lists every issue. Both pages carry their
// data as JSON in <script id="lentille-context">. The article body is left to
// preview.

export const meta = {
  id: 'rome.rsshub-luogu-daily',
  name: '洛谷 · 日报',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: '洛谷日报的文章列表',
  icon: 'https://www.luogu.com.cn/favicon.ico',
  params: {
    fields: [
      {
        key: 'id',
        type: 'text',
        label: '年度日报帖子 id',
        help: '年度日报所在帖子 id，可在 URL 中找到，留空默认为 47327',
        default: '47327'
      }
    ]
  }
}

const BASE = 'https://www.luogu.com.cn'
const DEFAULT_ID = '47327'

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
  const id = String(ctx.params.id || '').trim() || DEFAULT_ID
  const indexUrl = `${BASE}/discuss/${id}`
  const post = pageData(await read(ctx, indexUrl))?.post?.content

  if (!post) {
    throw new Error(`洛谷帖子 ${id} 没有内容，无法找到日报目录`)
  }

  const link = /<(https?:\/\/[^>]+)>/.exec(post)?.[1]

  if (!link) {
    throw new Error('洛谷日报目录里没有文章或合集链接，请检查帖子 id')
  }

  const data = pageData(await read(ctx, link))
  const articles = data?.articles?.result ?? (data?.article ? [data.article] : undefined)

  if (!Array.isArray(articles)) {
    throw new Error('洛谷日报目录指向的页面不是文章或合集')
  }

  const entries = articles.map((article) => {
    const entry = {
      id: `luogu:daily:${article.lid}`,
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

  return { entries }
}

export async function preview(ctx) {
  const articleId = ctx.item?.params?.articleId
  if (!articleId) return null

  const content = pageData(await read(ctx, `${BASE}/article/${articleId}`))?.article?.content
  return content ? { content: renderMarkdown(content) } : null
}
