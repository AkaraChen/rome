// Ported from RSSHub lib/routes/gelonghui/home.ts (AGPL-3.0).
// 格隆汇首页 — one JSON endpoint per channel; each item wraps its payload in a
// `data` field. The article body is left to preview.

export const meta = {
  id: 'rome.rsshub-gelonghui-home',
  name: '格隆汇 · 首页',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: '格隆汇推荐、股票、基金、新股与研报频道的最新文章',
  icon: 'https://www.gelonghui.com/favicon.ico',
  params: {
    fields: [
      {
        key: 'tag',
        type: 'select',
        label: '分类标签',
        help: '选择要订阅的格隆汇频道。',
        default: 'web_home_page',
        options: [
          { value: 'web_home_page', label: '推荐' },
          { value: 'stock', label: '股票' },
          { value: 'fund', label: '基金' },
          { value: 'new_stock', label: '新股' },
          { value: 'research', label: '研报' }
        ]
      }
    ]
  }
}

const API = 'https://www.gelonghui.com/api/channels'

function seconds(value) {
  const number = Number(value)
  return Number.isFinite(number) ? Math.floor(number) : undefined
}

export async function fetch(ctx) {
  const tag = String(ctx.params.tag || '').trim() || 'web_home_page'
  const url = `${API}/${encodeURIComponent(tag)}/articles/v8`
  const response = await ctx.fetch(url, { headers: { accept: 'application/json' } })

  if (!response.ok) {
    throw new Error(`格隆汇返回 ${response.status} ${response.statusText}`)
  }

  const payload = await response.json()
  const list = payload?.result

  if (!Array.isArray(list)) {
    throw new Error(`格隆汇频道 ${tag} 没有返回文章列表`)
  }

  const entries = list
    .map((wrapper) => wrapper?.data)
    .filter((item) => item && item.link)
    .map((item) => {
      const entry = {
        id: `gelonghui:${item.link}`,
        title: item.title || '（无标题）',
        url: item.link
      }

      if (item.nick) {
        entry.author = item.nick
      }

      if (item.summary) {
        entry.summary = item.summary
      }

      if (Array.isArray(item.coverImages) && item.coverImages[0]) {
        entry.image = item.coverImages[0]
      }

      const publishedAt = seconds(item.timestamp)
      if (publishedAt !== undefined) {
        entry.publishedAt = publishedAt
      }

      return entry
    })

  if (entries.length === 0) {
    throw new Error(`格隆汇频道 ${tag} 没有返回文章`)
  }

  return { entries }
}

export async function preview(ctx) {
  const url = ctx.item?.url
  if (!url) return null
  const content = await ctx.article(url)
  return content === null ? null : { content }
}
