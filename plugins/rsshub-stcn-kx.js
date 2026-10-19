// Ported from RSSHub lib/routes/stcn/kx.ts (AGPL-3.0).
// 证券时报网 快讯 — RSSHub 的 /stcn/article/list/kx 路由。
//
// 快讯不是从页面上抓的：页面把列表交给了一个 AJAX 接口，带上
// x-requested-with 头就返回 JSON。所以这里一个请求、一次 JSON.parse，
// 没有 HTML 要解析。
//
// 正文和日期都在 JSON 里，条目直接给全，不需要 preview。

export const meta = {
  id: 'rome.rsshub-stcn-kx',
  name: '证券时报网 · 快讯',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: '证券时报网 7×24 小时快讯',
  icon: 'https://www.stcn.com/favicon.ico',
}

const API = 'https://www.stcn.com/article/list.html?type=kx'
const BASE = 'https://www.stcn.com'

// 接口对 AJAX 请求和普通页面请求返回不同的东西，这个头是区分它们的开关。
const HEADERS = { accept: 'application/json', 'x-requested-with': 'XMLHttpRequest' }

/// 快讯的时间戳是毫秒，条目要的是秒。
function seconds(milliseconds) {
  const value = Number(milliseconds)

  return Number.isFinite(value) ? Math.floor(value / 1000) : undefined
}

export async function fetch(ctx) {
  ctx.log.debug(`stcn: GET ${API}`)

  const response = await ctx.fetch(API, { headers: HEADERS })

  if (!response.ok) {
    throw new Error(`证券时报网返回 ${response.status} ${response.statusText}`)
  }

  const body = await response.json()
  const list = body.data

  if (!Array.isArray(list)) {
    throw new Error('证券时报网快讯接口没有返回 data 数组，接口可能已经变了')
  }

  const entries = []

  for (const item of list) {
    if (!item.id || !item.title) continue

    const entry = {
      // 快讯自己的 id 就是它在接口里的主键，也是详情页地址里那一段。
      id: `stcn:${item.id}`,
      title: item.title,
      url: item.url ? new URL(item.url, BASE).href : `${BASE}/article/list/kx.html`,
    }

    if (item.source) entry.author = item.source
    if (item.content) entry.summary = item.content

    const image = item.share?.image
    if (image) entry.image = image

    const publishedAt = seconds(item.time)
    if (publishedAt !== undefined) entry.publishedAt = publishedAt

    entries.push(entry)
  }

  if (entries.length === 0) {
    throw new Error('证券时报网快讯里没有读到任何条目，接口可能已经变了')
  }

  ctx.log.info(`stcn: 快讯 ${entries.length} 条`)

  return { entries }
}
