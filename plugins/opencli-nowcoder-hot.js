// Ported from OpenCLI clis/nowcoder/hot.js (Apache-2.0).
// 牛客热搜 — the site's public hot-search endpoint.
//
// A hot-search list has no post id: the query string is the item, and the site
// itself links each one to a search page. So `query` is the stable key here,
// not a rank (which changes on every refresh).
//
// No preview: nowcoder renders the search page in JavaScript and the plugin
// runtime has no DOM.

export const meta = {
  id: 'rome.opencli-nowcoder-hot',
  name: '牛客 · 热搜',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: '抓取牛客网实时热搜关键词。',
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

const HOT = 'https://gw-c.nowcoder.com/api/sparta/hot-search/hot-content'
const SEARCH = 'https://www.nowcoder.com/search/all'

function integer(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10)

  if (!Number.isFinite(parsed)) {
    return fallback
  }

  return Math.min(Math.max(parsed, min), max)
}

export async function fetch(ctx) {
  const limit = integer(ctx.params.limit, 10, 1, 100)

  ctx.log.debug(`nowcoder-hot: GET ${HOT}`)

  const response = await ctx.fetch(HOT, { headers: { accept: 'application/json' } })

  if (!response.ok) {
    throw new Error(`牛客返回 ${response.status} ${response.statusText}`)
  }

  const payload = await response.json()

  if (payload.success === false || payload.code !== 0) {
    throw new Error(`牛客接口返回 ${payload.code ?? '未知错误'}：${payload.msg ?? '没有数据'}`)
  }

  const items = payload.data?.hotQuery

  if (!Array.isArray(items)) {
    throw new Error('牛客没有返回热搜数组，接口可能已经变了')
  }

  const entries = []

  for (const item of items) {
    // The list can carry promoted entries; they are not search results.
    if (item.ad || !item.query) {
      continue
    }

    const url = `${SEARCH}?query=${encodeURIComponent(item.query)}&type=all`

    entries.push({
      id: `nowcoder:hot:${item.query}`,
      title: item.query,
      url,
      summary: `热度 ${item.hotValue ?? 0}`,
    })

    if (entries.length >= limit) {
      break
    }
  }

  if (entries.length === 0) {
    throw new Error('牛客没有返回热搜，接口可能已经变了')
  }

  return { entries }
}
