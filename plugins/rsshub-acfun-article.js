// Ported from RSSHub lib/routes/acfun/article.ts (AGPL-3.0).
// AcFun 文章 — /v/list<分区>/index.htm 背后的文章 feed 接口。
//
// 这是一个 POST 接口，而且必须带上分区列表页作 referer，否则会被挡回来。
// 列表响应里只有标题和封面，正文要打开文章页才拿得到，所以正文留给
// preview：文章页是 JS 壳子，正文藏在 window.articleInfo 里。

export const meta = {
  id: 'rome.rsshub-acfun-article',
  name: 'AcFun · 文章',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: 'AcFun 指定分区的文章列表',
  icon: 'https://www.acfun.cn/favicon.ico',
  params: {
    fields: [
      {
        key: 'categoryId',
        type: 'select',
        label: '分区',
        help: '要读哪个分区的文章',
        default: '',
        required: true,
        options: [
          { value: '184', label: '二次元画师' },
          { value: '110', label: '综合' },
          { value: '73', label: '生活情感' },
          { value: '164', label: '游戏' },
          { value: '74', label: '动漫文化' },
          { value: '75', label: '漫画文学' },
        ],
      },
      {
        key: 'sortType',
        type: 'select',
        label: '排序',
        help: '按什么排序',
        default: 'createTime',
        required: false,
        options: [
          { value: 'createTime', label: '最新发表' },
          { value: 'lastCommentTime', label: '最新动态' },
          { value: 'hotScore', label: '最热文章' },
        ],
      },
      {
        key: 'timeRange',
        type: 'select',
        label: '时间范围',
        help: '只在按最热排序时有效',
        default: 'all',
        required: false,
        options: [
          { value: 'all', label: '时间不限' },
          { value: 'oneDay', label: '24 小时' },
          { value: 'threeDay', label: '三天' },
          { value: 'oneWeek', label: '一周' },
          { value: 'oneMonth', label: '一个月' },
        ],
      },
    ],
  },
}

const BASE = 'https://www.acfun.cn'

// realmId 是分区下若干子分区的编号，必须按原样重复拼接，不能合并。
const CATEGORIES = {
  184: { title: '二次元画师', realms: 'realmId=18&realmId=14&realmId=51' },
  110: { title: '综合', realms: 'realmId=5&realmId=22&realmId=28&realmId=3&realmId=4' },
  73: { title: '生活情感', realms: 'realmId=50&realmId=25&realmId=34&realmId=7&realmId=6&realmId=17&realmId=1&realmId=2&realmId=49' },
  164: { title: '游戏', realms: 'realmId=8&realmId=53&realmId=52&realmId=11&realmId=43&realmId=44&realmId=45&realmId=46&realmId=47' },
  74: { title: '动漫文化', realms: 'realmId=13&realmId=31&realmId=48' },
  75: { title: '漫画文学', realms: 'realmId=15&realmId=23&realmId=16' },
}

const SORTS = new Set(['createTime', 'lastCommentTime', 'hotScore'])
const RANGES = new Set(['all', 'oneDay', 'threeDay', 'oneWeek', 'oneMonth'])

// 页面把 JSON 直接写在 <script> 里，用括号配平把它整段取出来，
// 比用正则截到第一个 ; 更稳。
function extractJson(html, marker) {
  const at = html.indexOf(marker)
  if (at < 0) return null

  const start = html.indexOf('{', at)
  if (start < 0) return null

  let depth = 0
  let inString = false
  let escaped = false

  for (let i = start; i < html.length; i++) {
    const ch = html[i]

    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }

    if (ch === '"') inString = true
    else if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) {
        try {
          return JSON.parse(html.slice(start, i + 1))
        } catch {
          return null
        }
      }
    }
  }

  return null
}

function seconds(milliseconds) {
  const parsed = Number(milliseconds)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed / 1000) : undefined
}

export async function fetch(ctx) {
  const categoryId = String(ctx.params.categoryId ?? '').trim()

  if (!categoryId) {
    throw new Error('请选择分区')
  }
  if (!Object.prototype.hasOwnProperty.call(CATEGORIES, categoryId)) {
    throw new Error(`分区 ${categoryId} 无效`)
  }

  const sortType = String(ctx.params.sortType ?? 'createTime').trim() || 'createTime'
  if (!SORTS.has(sortType)) {
    throw new Error(`排序方式 ${sortType} 无效`)
  }

  const timeRange = String(ctx.params.timeRange ?? 'all').trim() || 'all'
  if (!RANGES.has(timeRange)) {
    throw new Error(`时间范围 ${timeRange} 无效`)
  }

  const category = CATEGORIES[categoryId]
  // referer 必须是分区列表页，接口会校验。
  const referer = `${BASE}/v/list${categoryId}/index.htm`
  const api = `${BASE}/rest/pc-direct/article/feed?cursor=first_page&onlyOriginal=false&limit=10&sortType=${sortType}&timeRange=${sortType === 'hotScore' ? timeRange : 'all'}&${category.realms}`

  ctx.log.debug(`acfun: POST ${api}`)

  const response = await ctx.fetch(api, {
    method: 'POST',
    headers: { referer, accept: 'application/json' },
  })

  if (!response.ok) {
    throw new Error(`AcFun 文章接口返回 ${response.status} ${response.statusText}`)
  }

  const body = await response.json()

  if (body.result !== 0 || !Array.isArray(body.data)) {
    throw new Error(`AcFun 文章接口返回异常（result=${body.result}），接口可能已经变了`)
  }

  const entries = body.data.map((item) => {
    const entry = {
      // articleId 是文章在站内的编号。
      id: `acfun:article:${item.articleId}`,
      title: item.title,
      url: `${BASE}/a/ac${item.articleId}`,
    }

    if (item.userName) entry.author = item.userName

    const publishedAt = seconds(item.createTime)
    if (publishedAt !== undefined) entry.publishedAt = publishedAt

    const views = item.formatViewCount ?? item.viewCount
    const comments = item.formatCommentCount ?? item.commentCount
    const parts = [item.realmName, `${views} 浏览`, `${comments} 评论`].filter(Boolean)
    if (parts.length > 0) entry.summary = parts.join(' · ')

    if (item.coverImgInfo?.thumbnailImageCdnUrl) entry.image = item.coverImgInfo.thumbnailImageCdnUrl

    // 文章页同样要求 referer，preview 时要用。
    entry.params = { referer }

    return entry
  })

  if (entries.length === 0) {
    throw new Error(`AcFun 分区 ${categoryId} 没有返回任何文章`)
  }

  return { entries, icon: `${BASE}/favicon.ico` }
}

export async function preview(ctx) {
  const url = ctx.item?.url
  if (!url) return null

  const referer = ctx.item.params?.referer ?? url
  const response = await ctx.fetch(url, { headers: { referer, accept: 'text/html' } })

  if (!response.ok) {
    throw new Error(`AcFun 文章页返回 ${response.status} ${response.statusText}`)
  }

  const html = await response.text()
  const info = extractJson(html, 'window.articleInfo')

  if (!info) {
    throw new Error('AcFun 文章页里没有 window.articleInfo，页面结构可能已经改变')
  }

  const content = info.parts?.[0]?.content
  if (!content) return null

  return { content }
}
