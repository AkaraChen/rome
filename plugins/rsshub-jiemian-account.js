// Ported from RSSHub lib/routes/jiemian/account.ts (AGPL-3.0).
// 界面新闻 界面号 — RSSHub 的 /jiemian/account/main/:id 路由。
//
// 界面号首页的文章来自一个 JSONP 接口，返回的 JSON 里标题、摘要、作者、
// 发布时间和封面都齐全，所以列表一个请求就够，不必再抓正文。

export const meta = {
  id: 'rome.rsshub-jiemian-account',
  name: '界面新闻 · 界面号',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: '界面新闻财经号、城市号与媒体号的首页文章',
  icon: 'https://www.jiemian.com/favicon.ico',
  params: {
    fields: [
      {
        key: 'id',
        type: 'select',
        label: '分类',
        help: '界面号的种类',
        default: '',
        required: true,
        options: [
          { value: '1', label: '财经号' },
          { value: '2', label: '城市号' },
          { value: '3', label: '媒体号' },
        ],
      },
    ],
  },
}

const API = 'https://papi.jiemian.com/page/api/officialAccount/get_index_lists'

// 站点自己的 ckey，和界面号的种类一一对应。
const CATEGORIES = {
  1: { ckey: 'finance_config_index', name: '财经号' },
  2: { ckey: 'city_config_index', name: '城市号' },
  3: { ckey: 'media_config_index', name: '媒体号' },
}

export async function fetch(ctx) {
  const id = String(ctx.params.id ?? '').trim()

  if (!id) {
    throw new Error('请填写分类：1（财经号）、2（城市号）或 3（媒体号）')
  }

  const category = CATEGORIES[id]

  if (!category) {
    throw new Error(`不认识的分类「${id}」，可选：1、2、3`)
  }

  const query = new URLSearchParams({ ckey: category.ckey, page: '1' })
  const url = `${API}?${query}`

  ctx.log.debug(`jiemian: GET ${url}`)

  const response = await ctx.fetch(url, { headers: { accept: 'application/json' } })

  if (!response.ok) {
    throw new Error(`界面新闻返回 ${response.status} ${response.statusText}`)
  }

  // 接口把 JSON 包在 `jsonpReturn(...)` 里，剥掉外层括号。
  const body = await response.text()
  const start = body.indexOf('(')
  const end = body.lastIndexOf(')')

  if (start < 0 || end <= start) {
    throw new Error('界面新闻接口没有返回预期的 JSONP 包装，接口可能已经变了')
  }

  const list = JSON.parse(body.slice(start + 1, end)).result

  if (!Array.isArray(list)) {
    throw new Error('界面新闻界面号接口没有返回 result 数组，接口可能已经变了')
  }

  const entries = []

  for (const article of list) {
    if (!article.id || !article.title) continue

    const entry = {
      id: `jiemian:${article.id}`,
      title: article.title,
      url: article.url,
    }

    if (article.source_name) entry.author = article.source_name
    if (article.summary) entry.summary = article.summary
    if (article.image) entry.image = article.image

    // 发布时间是秒，直接就是条目要的格式。
    const publishedAt = Number(article.publish_time)

    if (Number.isFinite(publishedAt) && publishedAt > 0) {
      entry.publishedAt = Math.floor(publishedAt)
    }

    entries.push(entry)
  }

  if (entries.length === 0) {
    throw new Error(`界面新闻${category.name}里没有读到任何条目，接口可能已经变了`)
  }

  ctx.log.info(`jiemian: ${category.name} ${entries.length} 条`)

  return { entries }
}
