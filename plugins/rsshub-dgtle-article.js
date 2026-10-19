// Ported from RSSHub lib/routes/dgtle/article.ts (AGPL-3.0).
// 数字尾巴文章 — /dgtle/article/:id/:pushed
//
// The category ids are the site's own and are not sequential; the select keeps
// the pairs RSSHub publishes. `pushed` switches the same list between newest
// and home-page picks.
//
// The link is built rather than returned: the list payload carries no URL, and
// the site's article pages are `article-<id>-1.html`.

export const meta = {
  id: 'rome.rsshub-dgtle-article',
  name: '数字尾巴 · 文章',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: '数字尾巴各分类的文章',
  icon: 'https://www.dgtle.com/favicon.ico',
  params: {
    fields: [
      {
        key: 'id',
        type: 'select',
        label: '分类',
        default: '0',
        options: [
          { value: '0', label: '全部' },
          { value: '20', label: '数码' },
          { value: '18', label: '手机' },
          { value: '4', label: '平板' },
          { value: '17', label: '笔电' },
          { value: '5', label: '影音' },
          { value: '401', label: '汽车' },
          { value: '395', label: '视频' },
          { value: '22', label: '摄影' },
          { value: '405', label: '露营' },
          { value: '402', label: '家装' },
          { value: '138', label: '活动' },
          { value: '34', label: '生活' },
          { value: '137', label: '旅行' },
          { value: '412', label: '骑行' },
          { value: '411', label: '游戏' },
          { value: '407', label: '宠物' },
          { value: '406', label: '时尚' },
          { value: '403', label: '运动' },
          { value: '135', label: '应用' },
          { value: '75', label: '玩物' },
          { value: '19', label: '周边' },
          { value: '7', label: '文具' },
          { value: '400', label: '官方' },
        ],
      },
      {
        key: 'pushed',
        type: 'select',
        label: '排序',
        default: '0',
        options: [
          { value: '0', label: '最新发布' },
          { value: '1', label: '首页推荐' },
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
  const pushed = String(ctx.params.pushed || '0').trim() || '0'

  if (!/^\d+$/.test(id)) {
    throw new Error('分类 ID 必须是数字')
  }

  const url = new URL(`${HOST}/article/getList/${id}`)
  url.searchParams.set('page', '1')
  url.searchParams.set('pushed', pushed)

  const response = await ctx.fetch(url, { headers: { accept: 'application/json' } })

  if (!response.ok) {
    throw new Error(`数字尾巴返回 ${response.status}（分类 ${id}）`)
  }

  const list = (await response.json()).data?.dataList

  if (!Array.isArray(list)) {
    throw new Error('数字尾巴没有返回文章列表，接口可能已经变了')
  }

  const entries = list.map((item) => {
    const entry = {
      id: `dgtle:${item.id}`,
      title: item.title || firstLine(item.content, 60) || '数字尾巴文章',
      url: `${HOST}/article-${item.id}-1.html`,
      author: item.user_name || undefined,
      summary: firstLine(item.content, 140) || undefined,
    }

    if (item.cover) entry.image = item.cover

    const publishedAt = Number(item.created_at)
    if (Number.isFinite(publishedAt)) entry.publishedAt = Math.floor(publishedAt)

    return entry
  })

  ctx.log.info(`dgtle-article: ${entries.length} 条（分类 ${id}）`)

  return { entries }
}

export async function preview(ctx) {
  const content = await ctx.article(ctx.item.url)
  return content ? { content } : null
}
