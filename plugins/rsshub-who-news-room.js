// Ported from RSSHub lib/routes/who/news-room.ts (AGPL-3.0).
// 世界卫生组织 — 新闻室。
//
// 特稿和评论各有一个 hub 接口，路径就是把分类里的短横去掉。列表页本身是
// 服务端渲染的，直接读接口更稳。正文留给 preview。

export const meta = {
  id: 'rome.rsshub-who-news-room',
  name: 'WHO · 新闻室',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: '抓取世界卫生组织新闻室的特稿与评论',
  icon: 'https://www.who.int/favicon.ico',
  params: {
    fields: [
      {
        key: 'category',
        type: 'select',
        label: '分类',
        help: '新闻室的栏目，默认为特稿',
        default: 'feature-stories',
        options: [
          { value: 'feature-stories', label: '特稿' },
          { value: 'commentaries', label: '评论' },
        ],
      },
      {
        key: 'language',
        type: 'select',
        label: '语言',
        help: '新闻室语言，留空为英语',
        default: '',
        options: [
          { value: '', label: 'English（默认）' },
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
  const category = String(ctx.params.category || 'feature-stories').trim() || 'feature-stories'
  const language = String(ctx.params.language || '').trim()
  const root = 'https://www.who.int'
  const prefix = language ? `${language}/` : ''
  const listUrl = `${root}/${prefix}news-room/${category}`
  const hub = category.replace(/-/g, '')
  const url = `${root}/api/hubs/${encodeURIComponent(hub)}?sf_culture=${encodeURIComponent(language || 'en')}&$orderby=PublicationDateAndTime%20desc&$select=Title,PublicationDateAndTime,ItemDefaultUrl&$top=30`

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
      id: `who-news-room:${category}:${slug}`,
      title: item.Title,
      url: `${listUrl}/detail/${slug}`,
    }

    const publishedAt = seconds(item.PublicationDateAndTime)
    if (publishedAt !== undefined) entry.publishedAt = publishedAt

    entries.push(entry)
  }

  if (entries.length === 0) {
    throw new Error('世界卫生组织接口没有返回任何内容')
  }

  ctx.log.info(`who: ${category} 共 ${entries.length} 条`)

  return { entries }
}

export async function preview(ctx) {
  const url = ctx.item?.url
  if (!url) return null

  const content = await ctx.article(url)
  return content === null ? null : { content }
}
