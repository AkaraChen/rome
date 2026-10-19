// Ported from RSSHub lib/routes/bbc/topic-zhongwen.ts (AGPL-3.0).
// BBC 中文网话题 — the topic page ships its data in a __NEXT_DATA__ JSON blob,
// so the whole listing is one page fetch and one JSON.parse.

export const meta = {
  id: 'rome.rsshub-bbc-topic-zhongwen',
  name: 'BBC · Topics - 中文',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: 'BBC 中文网话题页的最新报道',
  icon: 'https://www.bbc.com/favicon.ico',
  params: {
    fields: [
      {
        key: 'topic',
        type: 'text',
        label: '话题 id',
        help: '可在话题页 URL 中找到，例如 ckr7mn6r003t',
        required: true,
        default: ''
      },
      {
        key: 'variant',
        type: 'select',
        label: '语言变体',
        help: '选择简体或繁体。',
        default: 'trad',
        options: [
          { value: 'simp', label: '简' },
          { value: 'trad', label: '繁' }
        ]
      }
    ]
  }
}

function seconds(value) {
  const milliseconds = Date.parse(String(value))
  return Number.isFinite(milliseconds) ? Math.floor(milliseconds / 1000) : undefined
}

function readNextData(html) {
  const match = /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/.exec(html)
  if (!match) {
    throw new Error('BBC 中文话题页没有找到 __NEXT_DATA__')
  }
  try {
    return JSON.parse(match[1])
  } catch (error) {
    throw new Error(`BBC 中文话题页数据不是合法 JSON：${error.message}`)
  }
}

export async function fetch(ctx) {
  const topic = String(ctx.params.topic || '').trim()
  const variant = String(ctx.params.variant || '').trim() || 'trad'

  if (!topic) {
    throw new Error('BBC 中文话题 id 不能为空，请在话题页 URL 中查找')
  }

  const url = `https://www.bbc.com/zhongwen/topics/${encodeURIComponent(topic)}/${variant}`
  const response = await ctx.fetch(url, { headers: { accept: 'text/html' } })

  if (!response.ok) {
    throw new Error(`BBC 中文话题返回 ${response.status} ${response.statusText}`)
  }

  const html = await response.text()
  const pageData = readNextData(html)?.props?.pageProps?.pageData
  const summaries = pageData?.curations?.[0]?.summaries

  if (!Array.isArray(summaries)) {
    throw new Error(`BBC 中文话题 ${topic} 没有返回文章列表`)
  }

  const entries = summaries.map((item) => {
    const entry = {
      id: `bbc:zhongwen:${item.id || item.link}`,
      title: item.title || '（无标题）',
      url: item.link
    }

    if (item.description) {
      entry.summary = item.description
    }

    const publishedAt = seconds(item.firstPublished)
    if (publishedAt !== undefined) {
      entry.publishedAt = publishedAt
    }

    if (item.imageUrl) {
      entry.image = String(item.imageUrl).replace('/{width}/', '/1536/')
    }

    return entry
  })

  return { entries }
}

export async function preview(ctx) {
  const url = ctx.item?.url
  if (!url) return null
  const content = await ctx.article(url)
  return content === null ? null : { content }
}
