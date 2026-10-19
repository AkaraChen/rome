// Ported from RSSHub lib/routes/nowcoder/hots.ts (AGPL-3.0).
// Nowcoder — the hot list.
//
// Two lists behind one route: hot discussion subjects and the site-wide hot
// posts. Both are public JSON APIs answering `code: 0` on success.

export const meta = {
  id: 'rome.rsshub-nowcoder-hots',
  name: '牛客网 · 热榜',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: '牛客网热议话题和全站热帖',
  icon: 'https://www.nowcoder.com/favicon.ico',
  params: {
    fields: [
      {
        key: 'type',
        type: 'select',
        label: '榜单类型',
        help: '选择热议话题或全站热帖',
        default: '1',
        options: [
          { value: '1', label: '热议话题' },
          { value: '2', label: '全站热帖' },
        ],
      },
    ],
  },
}

const SUBJECTS = 'https://gw-c.nowcoder.com/api/sparta/subject/hot-subject'
const POSTS = 'https://gw-c.nowcoder.com/api/sparta/hot-search/top-hot-pc'

export async function fetch(ctx) {
  const type = String(ctx.params.type || '1').trim()

  if (type !== '1' && type !== '2') {
    throw new Error('榜单类型只能是 1 或 2')
  }

  // The APIs take a limit under two different names.
  const query = new URLSearchParams(
    type === '1'
      ? { limit: '20', _: String(Date.now()), t: '' }
      : { size: '20', _: String(Date.now()), t: '' },
  )

  const response = await ctx.fetch(`${type === '1' ? SUBJECTS : POSTS}?${query}`, {
    headers: { accept: 'application/json' },
  })

  if (!response.ok) {
    throw new Error(`牛客网返回 ${response.status} ${response.statusText}`)
  }

  const payload = await response.json()

  if (payload?.code !== 0) {
    throw new Error(`牛客网接口错误：${payload?.code} ${payload?.msg || ''}`)
  }

  const list = payload?.data?.result
  if (!Array.isArray(list)) {
    throw new Error('牛客网热榜接口结构已变化')
  }

  const entries = []

  for (const item of list) {
    if (!item?.uuid) continue

    if (type === '1') {
      const entry = {
        id: `nowcoder:subject:${item.uuid}`,
        title: String(item.content || '').trim(),
        url: `https://www.nowcoder.com/creation/subject/${item.uuid}`,
      }
      if (item.numberIcon) entry.image = item.numberIcon
      if (item.hotValue) entry.summary = `热度 ${item.hotValue}`
      entries.push(entry)
    } else {
      const entry = {
        id: `nowcoder:hot:${item.uuid}`,
        title: String(item.title || '').trim(),
        url: `https://www.nowcoder.com/feed/main/detail/${item.uuid}`,
      }
      if (item.hotValueFromDolphin) entry.summary = `热度 ${item.hotValueFromDolphin}`
      entries.push(entry)
    }
  }

  if (entries.length === 0) {
    throw new Error('牛客网热榜没有返回条目')
  }

  return { entries }
}

export async function preview(ctx) {
  const url = ctx.item?.url
  if (!url) return null
  const content = await ctx.article(url)
  return content === null ? null : { content }
}
