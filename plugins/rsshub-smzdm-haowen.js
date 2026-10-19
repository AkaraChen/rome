// Ported from RSSHub lib/routes/smzdm/haowen.ts (AGPL-3.0).
// SMZDM — popular community posts (好文).
//
// A public JSON list keyed by a day span. The API returns the wall-clock time
// without a zone; the site is in Asia/Shanghai, so the offset is applied by
// hand rather than trusting the host's locale.

export const meta = {
  id: 'rome.rsshub-smzdm-haowen',
  name: '什么值得买 · 好文',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: '什么值得买热门社区好文',
  icon: 'https://www.smzdm.com/favicon.ico',
  params: {
    fields: [
      {
        key: 'day',
        type: 'select',
        label: '时间跨度',
        help: '以天为单位的统计范围',
        default: '1',
        options: [
          { value: '1', label: '今日热门' },
          { value: '7', label: '周热门' },
          { value: '30', label: '月热门' },
        ],
      },
    ],
  },
}

const API = 'https://post.smzdm.com/rank/json_more/'

function strip(html) {
  return String(html).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
}

// `2026-10-18 22:41:55` is Asia/Shanghai wall-clock time.
function shanghaiSeconds(text) {
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(String(text).trim())
  if (!match) return undefined
  return Math.floor(Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]) - 8,
    Number(match[5]),
    Number(match[6] || 0),
  ) / 1000)
}

export async function fetch(ctx) {
  const day = String(ctx.params.day || '1').trim()

  if (!['1', '7', '30'].includes(day)) {
    throw new Error('时间跨度只能是 1、7 或 30 天')
  }

  const query = new URLSearchParams({ unit: day })
  const response = await ctx.fetch(`${API}?${query}`, {
    headers: { accept: 'application/json, text/javascript, */*; q=0.01' },
  })

  if (!response.ok) {
    throw new Error(`什么值得买返回 ${response.status} ${response.statusText}`)
  }

  const payload = await response.json()
  const list = payload?.data

  if (!Array.isArray(list)) {
    throw new Error('什么值得买好文接口结构已变化')
  }

  const entries = []

  for (const item of list) {
    if (!item || !item.article_url) continue

    const entry = {
      id: `smzdm:haowen:${item.article_id || item.article_show_id || item.article_url}`,
      title: strip(item.title),
      url: item.article_url,
    }

    if (item.nickname) entry.author = String(item.nickname)

    const summary = strip(item.content || '')
    if (summary) entry.summary = summary

    if (item.pic_url) entry.image = item.pic_url

    const publishedAt = shanghaiSeconds(item.publish_time)
    if (publishedAt !== undefined) entry.publishedAt = publishedAt

    entries.push(entry)
  }

  if (entries.length === 0) {
    throw new Error('什么值得买好文接口返回为空')
  }

  return { entries }
}

export async function preview(ctx) {
  const url = ctx.item?.url
  if (!url) return null
  const content = await ctx.article(url)
  return content === null ? null : { content }
}
