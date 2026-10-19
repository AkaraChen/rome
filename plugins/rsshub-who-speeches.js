// Ported from RSSHub lib/routes/who/speeches.ts (AGPL-3.0).
// 世界卫生组织 — 演讲。
//
// 演讲挂两个不同的栏目下：英文在 /news-room/speeches，其它语言在
// /<lang>/director-general/speeches，条目路径也从 item 变成 detail。

export const meta = {
  id: 'rome.rsshub-who-speeches',
  name: 'WHO · 演讲',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: '抓取世界卫生组织的演讲',
  icon: 'https://www.who.int/favicon.ico',
  params: {
    fields: [
      {
        key: 'language',
        type: 'select',
        label: '语言',
        help: '演讲语言，默认为英语',
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
  const english = language === 'en'
  const listUrl = english
    ? `${root}/news-room/speeches`
    : `${root}/${language}/director-general/speeches`
  const url = `${root}/api/hubs/speeches?sf_culture=${encodeURIComponent(language)}&$orderby=PublicationDateAndTime%20desc&$select=Title,PublicationDateAndTime,ItemDefaultUrl`

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
      id: `who-speeches:${language}:${slug}`,
      title: item.Title,
      url: `${listUrl}/${english ? 'item' : 'detail'}/${slug}`,
    }

    const publishedAt = seconds(item.PublicationDateAndTime)
    if (publishedAt !== undefined) entry.publishedAt = publishedAt

    entries.push(entry)
  }

  if (entries.length === 0) {
    throw new Error('世界卫生组织接口没有返回任何演讲')
  }

  ctx.log.info(`who: ${entries.length} 篇演讲`)

  return { entries }
}

export async function preview(ctx) {
  const url = ctx.item?.url
  if (!url) return null

  const content = await ctx.article(url)
  return content === null ? null : { content }
}
