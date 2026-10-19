// Ported from OpenCLI clis/wikipedia/search.js (Apache-2.0).
// 维基百科搜索 — OpenCLI 的 `wikipedia search`.
//
// MediaWiki Action API 的 list=search，公开、无 key。
// 移植自 clis/wikipedia/search.js 与 clis/wikipedia/utils.js。

export const meta = {
  id: 'rome.opencli-wikipedia-search',
  name: '维基百科 · 搜索',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: '按关键词搜索维基百科条目。',
  icon: 'https://www.wikipedia.org/favicon.ico',
  params: {
    fields: [
      {
        key: 'query',
        type: 'text',
        label: '关键词',
        help: '要搜索的词，例如 terraform',
        default: '',
      },
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

function plain(html) {
  return String(html ?? '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

export async function fetch(ctx) {
  const query = String(ctx.params?.query ?? '').trim()

  if (!query) {
    throw new Error('请填写搜索关键词')
  }

  const limit = integer(ctx.params?.limit, 10, 1, 50)
  const lang = language(ctx.params?.lang)

  const url = `https://${lang}.wikipedia.org/w/api.php?action=query&list=search`
    + `&srsearch=${encodeURIComponent(query)}&srlimit=${limit}&format=json&utf8=1`

  ctx.log.debug(`opencli-wikipedia-search: GET ${url}`)

  const response = await ctx.fetch(url, {
    headers: {
      'user-agent': 'opencli/1.0 (https://github.com/jackwener/opencli)',
      accept: 'application/json',
    },
  })

  if (!response.ok) {
    throw new Error(`维基百科返回 HTTP ${response.status}`)
  }

  const data = await response.json()
  const results = data?.query?.search

  if (!Array.isArray(results) || results.length === 0) {
    throw new Error(`维基百科没有找到与 "${query}" 匹配的条目`)
  }

  const entries = []

  for (const result of results.slice(0, limit)) {
    const title = String(result?.title ?? '').trim()

    if (!title) continue

    const entry = {
      // pageid 是条目的永久编号。
      id: `wiki:${lang}:${result.pageid ?? title}`,
      title,
      url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`,
    }

    const snippet = plain(result.snippet).slice(0, 120)
    if (snippet) entry.summary = snippet

    entries.push(entry)
  }

  if (entries.length === 0) {
    throw new Error(`维基百科没有找到与 "${query}" 匹配的条目`)
  }

  ctx.log.info(`opencli-wikipedia-search: ${entries.length} 条（${query}）`)

  return { entries }
}

export async function preview(ctx) {
  const url = ctx.item?.url

  if (!url) return null

  const content = await ctx.article(url)
  return content === null ? null : { content }
}
