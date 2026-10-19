// Ported from RSSHub lib/routes/nowcoder/recommend.ts (AGPL-3.0).
// Nowcoder — the recommendation banner on the jobs page.
//
// A public JSON API. Campaign names embed a line break as markup, which is
// reduced to a space for the title.

export const meta = {
  id: 'rome.rsshub-nowcoder-recommend',
  name: '牛客网 · 求职推荐',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: '牛客网求职页面的推荐活动',
  icon: 'https://www.nowcoder.com/favicon.ico',
}

const API = 'https://www.nowcoder.com/recommand/activity'

function strip(html) {
  return String(html).replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
}

export async function fetch(ctx) {
  const query = new URLSearchParams({ token: '', type: '3', _: String(Date.now()) })
  const response = await ctx.fetch(`${API}?${query}`, { headers: { accept: 'application/json' } })

  if (!response.ok) {
    throw new Error(`牛客网返回 ${response.status} ${response.statusText}`)
  }

  const payload = await response.json()

  if (payload?.code !== 0) {
    throw new Error(`牛客网接口错误：${payload?.code} ${payload?.msg || ''}`)
  }

  const list = payload?.data?.activitys
  if (!Array.isArray(list)) {
    throw new Error('牛客网推荐接口结构已变化')
  }

  const entries = []

  for (const item of list) {
    if (!item?.url) continue

    const entry = {
      id: `nowcoder:recommend:${item.url}`,
      title: strip(item.name),
      url: `https://www.nowcoder.com${item.url}`,
    }

    if (item.img) entry.image = item.img
    if (item.companyName) entry.author = item.companyName
    if (item.time) entry.summary = String(item.time)

    entries.push(entry)
  }

  if (entries.length === 0) {
    throw new Error('牛客网推荐接口没有返回条目')
  }

  return { entries }
}

export async function preview(ctx) {
  const url = ctx.item?.url
  if (!url) return null
  const content = await ctx.article(url)
  return content === null ? null : { content }
}
