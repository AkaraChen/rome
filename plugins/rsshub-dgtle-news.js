// Ported from RSSHub lib/routes/dgtle/news.ts (AGPL-3.0).
// 数字尾巴鲸闻 — /dgtle/news/:id
//
// The short-news stream, where an item may have no title at all and the text
// lives in `content` — the "每日一言" category is exactly that. The link is
// built from the id, as in the article route, but with the `news` prefix.

export const meta = {
  id: 'rome.rsshub-dgtle-news',
  name: '数字尾巴 · 鲸闻',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: '数字尾巴的短资讯',
  icon: 'https://www.dgtle.com/favicon.ico',
  params: {
    fields: [
      {
        key: 'id',
        type: 'select',
        label: '分类',
        default: '0',
        options: [
          { value: '0', label: '最新' },
          { value: '395', label: '直播' },
          { value: '396', label: '资讯' },
          { value: '388', label: '每日一言' },
        ],
      },
    ],
  },
}

const HOST = 'https://www.dgtle.com'

function firstLine(text, limit) {
  const line = String(text ?? '').replace(/\s+/g, ' ').trim()
  if (!line) return undefined
  return line.length > limit ? `${line.slice(0, limit - 1)}…` : line
}

export async function fetch(ctx) {
  const id = String(ctx.params.id || '0').trim() || '0'

  if (!/^\d+$/.test(id)) {
    throw new Error('分类 ID 必须是数字')
  }

  const response = await ctx.fetch(`${HOST}/news/getNewsIndexList/${id}`, { headers: { accept: 'application/json' } })

  if (!response.ok) {
    throw new Error(`数字尾巴返回 ${response.status}（分类 ${id}）`)
  }

  const list = (await response.json()).data?.dataList

  if (!Array.isArray(list)) {
    throw new Error('数字尾巴没有返回鲸闻列表，接口可能已经变了')
  }

  const entries = list.map((item) => {
    const entry = {
      id: `dgtle:${item.id}`,
      title: item.title || firstLine(item.content, 60) || '数字尾巴鲸闻',
      url: `${HOST}/news-${item.id}-1.html`,
      author: item.user_name || item.user?.username || undefined,
      summary: [item.column, item.from].filter(Boolean).join(' · ') || undefined,
    }

    if (item.cover) entry.image = item.cover

    const publishedAt = Number(item.created_at)
    if (Number.isFinite(publishedAt)) entry.publishedAt = Math.floor(publishedAt)

    return entry
  })

  ctx.log.info(`dgtle-news: ${entries.length} 条（分类 ${id}）`)

  return { entries }
}

export async function preview(ctx) {
  const content = await ctx.article(ctx.item.url)
  return content ? { content } : null
}
