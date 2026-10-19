// Ported from RSSHub lib/routes/oschina/news.ts (AGPL-3.0).
// OSCHINA — the news and blog feed by category.
//
// One public JSON API with a category-dependent path: the three synthetic
// categories have their own endpoints, and every blog category shares one. The
// category list is fixed by the site, so the mapping is held here instead of
// being fetched on every refresh.

export const meta = {
  id: 'rome.rsshub-oschina-news',
  name: '开源中国 · 资讯',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: '开源中国资讯与博客分类',
  icon: 'https://www.oschina.net/favicon.ico',
  params: {
    fields: [
      {
        key: 'category',
        type: 'select',
        label: '分类',
        help: '资讯或博客分类',
        default: '0',
        options: [
          { value: '0', label: '全部' },
          { value: '9998', label: '开源资讯' },
          { value: '9999', label: '软件资讯' },
          { value: '4', label: 'AI & 大模型' },
          { value: '3', label: '云原生' },
          { value: '12', label: '大前端' },
          { value: '10', label: '软件架构' },
          { value: '11', label: '开发技能' },
          { value: '6', label: '硬件 & IoT' },
          { value: '9', label: 'DevOps' },
          { value: '19', label: '操作系统' },
          { value: '8', label: '程序人生' },
          { value: '5', label: '数据库' },
          { value: '2', label: '区块链 & Web3 & 元宇宙' },
          { value: '14', label: '软件测试 & 运维' },
          { value: '13', label: '信息安全' },
          { value: '15', label: '网络技术' },
          { value: '7', label: '信息安全' },
          { value: '1', label: '开源治理' },
          { value: '16', label: '游戏开发' },
          { value: '17', label: '多媒体处理' },
        ],
      },
    ],
  },
}

const ROOT = 'https://www.oschina.net'
const BLOG = 'https://my.oschina.net'

// Named aliases the upstream route accepts for the synthetic categories.
const ALIASES = {
  all: '0',
  industry: '9998',
  'industry-news': '9998',
  programming: '9998',
  project: '9999',
}

const SYNTHETIC = {
  0: '/homeListByCategoryTime',
  9998: '/homeListByNewType',
  9999: '/homeListByNewType',
}

const BLOG_CATEGORIES = ['4', '3', '12', '10', '11', '6', '9', '19', '8', '5', '2', '14', '13', '15', '7', '1', '16', '17']

export async function fetch(ctx) {
  let category = String(ctx.params.category || '0').trim()
  if (ALIASES[category]) category = ALIASES[category]

  let path = SYNTHETIC[category]
  if (!path) {
    if (!BLOG_CATEGORIES.includes(category)) {
      throw new Error(`未知的资讯分类：${category}`)
    }
    path = '/homeListByBlogTime'
  }

  const query = new URLSearchParams({ page: '1', pageSize: '30', type: category })
  const response = await ctx.fetch(`${ROOT}/ApiHomeNew${path}?${query}`, {
    headers: { accept: 'application/json' },
  })

  if (!response.ok) {
    throw new Error(`开源中国返回 ${response.status} ${response.statusText}`)
  }

  const payload = await response.json()
  const list = payload?.result

  if (!Array.isArray(list)) {
    throw new Error('开源中国资讯接口结构已变化')
  }

  const entries = []

  for (const item of list) {
    if (!item?.obj_id) continue

    // obj_type 4 is a news article; anything else is a blog post.
    const isNews = item.obj_type === 4
    const entry = {
      id: `oschina:${isNews ? 'news' : 'blog'}:${item.obj_id}`,
      title: String(item.obj_title || '').trim(),
      url: isNews
        ? `${ROOT}/news/${item.obj_id}${item.ident ? `/${item.ident}` : ''}`
        : `${BLOG}/u/${item.userVo?.id}/blog/${item.obj_id}`,
    }

    const summary = String(item.detail || '').trim()
    if (summary) entry.summary = summary

    if (item.userVo?.name) entry.author = item.userVo.name
    if (item.image) entry.image = item.image

    const createdAt = Number(item.create_time)
    if (Number.isFinite(createdAt) && createdAt > 0) {
      entry.publishedAt = Math.floor(createdAt / 1000)
    }

    entries.push(entry)
  }

  if (entries.length === 0) {
    throw new Error('开源中国资讯接口没有返回条目')
  }

  return { entries }
}

export async function preview(ctx) {
  const url = ctx.item?.url
  if (!url) return null
  const content = await ctx.article(url)
  return content === null ? null : { content }
}
