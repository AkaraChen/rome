// Ported from RSSHub lib/routes/weibo/search/hot.tsx (AGPL-3.0).
// Weibo — the hot search board.
//
// The upstream route drives a browser and needs cookies. This port reads the
// public JSON endpoint the site's own sidebar uses, which needs no account but
// does require the site's referer: without it the endpoint answers 403.
//
// The upstream `fulltext` switch expands each entry with a summary, which needs
// the same browser session; it is accepted here and has no effect.

export const meta = {
  id: 'rome.rsshub-weibo-search-hot',
  name: '微博 · 热搜榜',
  version: '1.0.0',
  apiVersion: '1',
  view: 'socialMedia',
  description: '微博热搜榜',
  icon: 'https://weibo.com/favicon.ico',
  params: {
    fields: [
      {
        key: 'fulltext',
        type: 'checkbox',
        label: '展开摘要',
        help: '上游需要浏览器会话才能获取摘要，本插件不支持，开关无效',
        default: false,
      },
    ],
  },
}

const API = 'https://weibo.com/ajax/side/hotSearch'

export async function fetch(ctx) {
  const response = await ctx.fetch(API, {
    headers: {
      accept: 'application/json',
      referer: 'https://weibo.com/',
    },
  })

  if (!response.ok) {
    throw new Error(`微博返回 ${response.status} ${response.statusText}`)
  }

  const payload = await response.json()

  if (payload?.ok !== 1) {
    throw new Error('微博热搜接口返回失败')
  }

  const list = payload?.data?.realtime

  if (!Array.isArray(list)) {
    throw new Error('微博热搜接口结构已变化')
  }

  const entries = []

  for (const item of list) {
    if (item?.is_ad) continue

    const word = String(item.word || item.note || '').trim()
    if (!word) continue

    const entry = {
      id: `weibo:hot:${word}`,
      title: word,
      url: `https://s.weibo.com/weibo?q=${encodeURIComponent(word)}`,
    }

    const rank = Number(item.realpos)
    const notes = []
    if (Number.isFinite(rank) && rank > 0) notes.push(`热搜第 ${rank} 位`)
    if (item.num) notes.push(`${item.num} 次讨论`)
    if (notes.length > 0) entry.summary = notes.join(' · ')

    entries.push(entry)
  }

  if (entries.length === 0) {
    throw new Error('微博热搜接口没有返回条目')
  }

  return { entries }
}
