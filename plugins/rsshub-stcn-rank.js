// Ported from RSSHub lib/routes/stcn/rank.ts (AGPL-3.0).
// 证券时报网 热榜 — RSSHub 的 /stcn/article/rank/:id? 路由。
//
// 热榜是一个 AJAX 接口返回的 JSON 数组：标题加详情页地址，没有时间也没有
// 正文，所以列表只给这两样，打开条目时再走 preview 读那一页。

export const meta = {
  id: 'rome.rsshub-stcn-rank',
  name: '证券时报网 · 热榜',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: '证券时报网各分类的新闻热榜',
  icon: 'https://www.stcn.com/favicon.ico',
  params: {
    fields: [
      {
        key: 'id',
        type: 'select',
        label: '分类',
        help: '分类代码，可在对应分类页网址 https://www.stcn.com/article/list/<分类>.html 中找到',
        default: 'yw',
        options: [
          { value: 'yw', label: '要闻' },
          { value: 'gs', label: '股市' },
          { value: 'company', label: '公司' },
          { value: 'fund', label: '基金' },
          { value: 'finance', label: '金融' },
          { value: 'comment', label: '评论' },
          { value: 'cj', label: '产经' },
          { value: 'kcb', label: '科创板' },
          { value: 'xsb', label: '新三板' },
          { value: 'zk', label: 'ESG' },
          { value: 'gd', label: '滚动' },
        ],
      },
    ],
  },
}

const API = 'https://www.stcn.com/article/category-news-rank.html'
const BASE = 'https://www.stcn.com'

const HEADERS = { accept: 'application/json', 'x-requested-with': 'XMLHttpRequest' }

export async function fetch(ctx) {
  const id = ctx.params.id || 'yw'
  const url = `${API}?type=${encodeURIComponent(id)}`

  ctx.log.debug(`stcn: GET ${url}`)

  const response = await ctx.fetch(url, { headers: HEADERS })

  if (!response.ok) {
    throw new Error(`证券时报网返回 ${response.status} ${response.statusText}`)
  }

  const body = await response.json()
  const list = body.data

  if (!Array.isArray(list)) {
    throw new Error('证券时报网热榜接口没有返回 data 数组，接口可能已经变了')
  }

  const entries = []

  for (const item of list) {
    if (!item.title || !item.url) continue

    const link = new URL(item.url, BASE).href

    entries.push({
      id: `stcn:${new URL(link).pathname}`,
      title: item.title,
      url: link,
    })
  }

  if (entries.length === 0) {
    throw new Error(`证券时报网热榜「${id}」里没有读到任何条目，接口可能已经变了`)
  }

  ctx.log.info(`stcn: 热榜 ${id} ${entries.length} 条`)

  return { entries }
}

export async function preview(ctx) {
  const url = ctx.item?.url

  if (!url) return null

  const content = await ctx.article(url)

  return content === null ? null : { content }
}
