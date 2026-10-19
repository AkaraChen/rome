// Ported from OpenCLI clis/wikipedia/trending.js (Apache-2.0).
// 维基百科热门条目 — OpenCLI 的 `wikipedia trending`.
//
// 使用维基百科的公开聚合 feed，取昨天（UTC）的 mostread 榜单。
// 移植自 clis/wikipedia/trending.js 与 clis/wikipedia/utils.js。

export const meta = {
  id: 'rome.opencli-wikipedia-trending',
  name: '维基百科 · 热门条目',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: '维基百科昨天阅读量最高的条目。',
  icon: 'https://www.wikipedia.org/favicon.ico',
  params: {
    fields: [
      {
        key: 'limit',
        type: 'number',
        label: '条数',
        help: '最多 50 条',
        default: 10,
        min: 1,
        max: 50,
      },
      {
        key: 'lang',
        type: 'text',
        label: '语言',
        help: '语言代码，例如 en、zh、ja',
        default: 'en',
      },
    ],
  },
}

const DESC_MAX_LEN = 80

function integer(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(Math.max(parsed, min), max)
}

function language(value) {
  const code = String(value ?? 'en').trim().toLowerCase() || 'en'

  if (!/^[a-z][a-z0-9-]*$/.test(code)) {
    throw new Error(`维基百科语言代码不合法：${code}`)
  }

  return code
}

function articleUrl(lang, article) {
  const page = article?.content_urls?.desktop?.page
  if (typeof page === 'string' && page) return page

  const title = String(article?.title ?? '').replace(/ /g, '_')
  return `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(title)}`
}

export async function fetch(ctx) {
  const limit = integer(ctx.params?.limit, 10, 1, 50)
  const lang = language(ctx.params?.lang)

  // 从昨天开始往前找。Wikipedia 的 featured feed 通常要滞后两三天才
  // 生成 mostread，只请求昨天会稳定地拿到空榜。
  let articles = null

  for (let offset = 1; offset <= 4; offset++) {
    const date = new Date(Date.now() - offset * 86_400_000)
    const year = date.getUTCFullYear()
    const month = String(date.getUTCMonth() + 1).padStart(2, '0')
    const day = String(date.getUTCDate()).padStart(2, '0')

    const url = `https://${lang}.wikipedia.org/api/rest_v1/feed/featured/${year}/${month}/${day}`

    ctx.log.debug(`opencli-wikipedia-trending: GET ${url}`)

    const response = await ctx.fetch(url, {
      headers: {
        'user-agent': 'opencli/1.0 (https://github.com/jackwener/opencli)',
        accept: 'application/json',
      },
    })

    if (response.status === 404) continue

    if (!response.ok) {
      throw new Error(`维基百科返回 HTTP ${response.status}，请检查语言代码 ${lang}`)
    }

    const data = await response.json()
    const found = data?.mostread?.articles

    if (Array.isArray(found) && found.length > 0) {
      articles = found
      break
    }
  }

  if (articles === null) {
    throw new Error(`维基百科没有 ${lang} 的热门条目，换一个语言试试`)
  }

  const selected = articles.slice(0, limit)

  for (const article of selected) {
    if (!String(article?.title ?? '').trim()) {
      throw new Error('维基百科热门榜单里有条目缺少标题，接口可能已经变了')
    }
  }

  const entries = selected.map((article, index) => {
    const title = String(article.title).trim()
    const description = String(article.description ?? '').slice(0, DESC_MAX_LEN)
    const views = Number(article.views ?? 0)

    const parts = [`#${index + 1}`]
    if (description) parts.push(description)
    parts.push(`${Number.isFinite(views) ? views : 0} 次浏览`)

    const entry = {
      // pageid 是维基百科给条目的永久编号，重命名也不会变。
      id: `wiki:${lang}:${article.pageid ?? title}`,
      title,
      url: articleUrl(lang, article),
      summary: parts.join(' · '),
    }

    const image = article.thumbnail?.source
    if (image) entry.image = image

    return entry
  })

  ctx.log.info(`opencli-wikipedia-trending: ${entries.length} 条（${lang}）`)

  return { entries }
}

export async function preview(ctx) {
  const url = ctx.item?.url

  if (!url) return null

  const content = await ctx.article(url)
  return content === null ? null : { content }
}
