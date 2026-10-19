// Ported from RSSHub lib/routes/who/news.ts (AGPL-3.0).
// 世界卫生组织 — 新闻。
//
// 站点给新闻列表开了 OData 接口，直接读 JSON 就够。正文在条目页里，交给
// preview 用宿主的正文提取器去读。

export const meta = {
  id: 'rome.rsshub-who-news',
  name: 'WHO · 新闻',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: '抓取世界卫生组织的新闻',
  icon: 'https://www.who.int/favicon.ico',
  params: {
    fields: [
      {
        key: 'language',
        type: 'select',
        label: '语言',
        help: '新闻语言，默认为英语',
        default: 'en',
        options: [
          { value: 'en', label: 'English' },
          { value: 'ar', label: 'العربية' },
          { value: 'zh', label: '中文' },
          { value: 'fr', label: 'Français' },
          { value: 'ru', label: 'Русский' },
          { value: 'es', label: 'Español' },
          { value: 'pt', label: 'Português' },
        ],
      },
    ],
  },
}

function seconds(value) {
  const milliseconds = Date.parse(value)
  return Number.isFinite(milliseconds) ? Math.floor(milliseconds / 1000) : undefined
}

/// 限流时接口会用 200 回一句纯文本，直接 response.json() 只会得到语法错误。
async function readJson(response) {
  const text = await response.text()
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(`世界卫生组织接口返回了非 JSON 内容：${text.slice(0, 80)}`)
  }
}

export async function fetch(ctx) {
  const language = String(ctx.params.language || 'en').trim() || 'en'
  const root = 'https://www.who.int'
  const url = `${root}/api/news/newsitems?sf_culture=${encodeURIComponent(language)}&$orderby=PublicationDateAndTime%20desc&$select=Title,PublicationDateAndTime,ItemDefaultUrl`
  const prefix = language === 'en' ? '' : `${language}/`

  ctx.log.debug(`who: GET ${url}`)

  const response = await ctx.fetch(url, { headers: { accept: 'application/json' } })

  if (!response.ok) {
    throw new Error(`世界卫生组织返回 ${response.status} ${response.statusText}`)
  }

  const body = await readJson(response)

  if (!Array.isArray(body?.value)) {
    throw new Error('世界卫生组织接口没有返回 value 数组，接口可能已经变了')
  }

  const entries = []

  for (const item of body.value) {
    const slug = String(item.ItemDefaultUrl || '').replace(/^\/+/, '')
    if (!slug || !item.Title) continue

    const entry = {
      id: `who-news:${slug}`,
      title: item.Title,
      url: `${root}/${prefix}news/item/${slug}`,
    }

    const publishedAt = seconds(item.PublicationDateAndTime)
    if (publishedAt !== undefined) entry.publishedAt = publishedAt

    entries.push(entry)
  }

  if (entries.length === 0) {
    throw new Error('世界卫生组织接口没有返回任何新闻')
  }

  ctx.log.info(`who: ${entries.length} 条新闻`)

  return { entries }
}

export async function preview(ctx) {
  const url = ctx.item?.url
  if (!url) return null

  const content = await ctx.article(url)
  return content === null ? null : { content }
}
