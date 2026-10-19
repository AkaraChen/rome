// Ported from OpenCLI clis/nowcoder/topics.js (Apache-2.0).
// 牛客热门话题 — the site's public hot-subject endpoint.
//
// A subject has both a numeric id and a uuid; the uuid is what the site's own
// subject route takes, so it is the stable key.
//
// No preview: nowcoder renders subject pages in JavaScript and the plugin
// runtime has no DOM.

export const meta = {
  id: 'rome.opencli-nowcoder-topics',
  name: '牛客 · 热门话题',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: '抓取牛客网当前的热门讨论话题。',
  icon: 'https://www.nowcoder.com/favicon.ico',
  params: {
    fields: [
      {
        key: 'limit',
        type: 'number',
        label: '条数',
        help: '每次抓取的条目数',
        default: 10,
        min: 1,
        max: 100,
      },
    ],
  },
}

const HOT = 'https://gw-c.nowcoder.com/api/sparta/subject/hot-subject'
const SUBJECT = 'https://www.nowcoder.com/creation/subject'

function integer(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10)

  if (!Number.isFinite(parsed)) {
    return fallback
  }

  return Math.min(Math.max(parsed, min), max)
}

export async function fetch(ctx) {
  const limit = integer(ctx.params.limit, 10, 1, 100)

  ctx.log.debug(`nowcoder-topics: GET ${HOT}`)

  const response = await ctx.fetch(HOT, { headers: { accept: 'application/json' } })

  if (!response.ok) {
    throw new Error(`牛客返回 ${response.status} ${response.statusText}`)
  }

  const payload = await response.json()

  if (payload.success === false || payload.code !== 0) {
    throw new Error(`牛客接口返回 ${payload.code ?? '未知错误'}：${payload.msg ?? '没有数据'}`)
  }

  const items = payload.data?.result

  if (!Array.isArray(items)) {
    throw new Error('牛客没有返回话题数组，接口可能已经变了')
  }

  const entries = []

  for (const item of items) {
    if (!item.uuid || !item.content) {
      continue
    }

    entries.push({
      id: `nowcoder:topic:${item.uuid}`,
      title: item.content,
      url: `${SUBJECT}/${item.uuid}`,
      summary: `${item.viewCount ?? 0} 次浏览 · ${item.momentCount ?? 0} 条动态 · 热度 ${item.hotValue ?? 0}`,
    })

    if (entries.length >= limit) {
      break
    }
  }

  if (entries.length === 0) {
    throw new Error('牛客没有返回话题，接口可能已经变了')
  }

  return { entries }
}
