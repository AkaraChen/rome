// Ported from OpenCLI clis/nowcoder/trending.js (Apache-2.0).
// 牛客热帖 — the site's public top-hot-pc endpoint.
//
// Each item carries a snowflake-like numeric id and a uuid. The numeric id is
// what the site's discussion route takes (`/discuss/<id>`), so it is the stable
// key and the address; the uuid is only a fallback.
//
// No preview: nowcoder renders discussion pages in JavaScript and the plugin
// runtime has no DOM.

export const meta = {
  id: 'rome.opencli-nowcoder-trending',
  name: '牛客 · 热帖',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: '抓取牛客网当前的热门帖子。',
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

const TRENDING = 'https://gw-c.nowcoder.com/api/sparta/hot-search/top-hot-pc'
const DISCUSS = 'https://www.nowcoder.com/discuss'
const FEED = 'https://www.nowcoder.com/feed/main/detail'

function integer(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10)

  if (!Number.isFinite(parsed)) {
    return fallback
  }

  return Math.min(Math.max(parsed, min), max)
}

export async function fetch(ctx) {
  const limit = integer(ctx.params.limit, 10, 1, 100)

  ctx.log.debug(`nowcoder-trending: GET ${TRENDING}`)

  const response = await ctx.fetch(TRENDING, { headers: { accept: 'application/json' } })

  if (!response.ok) {
    throw new Error(`牛客返回 ${response.status} ${response.statusText}`)
  }

  const payload = await response.json()

  if (payload.success === false || payload.code !== 0) {
    throw new Error(`牛客接口返回 ${payload.code ?? '未知错误'}：${payload.msg ?? '没有数据'}`)
  }

  const items = payload.data?.result

  if (!Array.isArray(items)) {
    throw new Error('牛客没有返回帖子数组，接口可能已经变了')
  }

  const entries = []

  for (const item of items) {
    if (!item.title) {
      continue
    }

    const key = item.id || item.uuid

    if (!key) {
      continue
    }

    // The numeric id addresses a discussion; the uuid only addresses a feed
    // item, so prefer the form the site actually serves.
    const url = item.id ? `${DISCUSS}/${item.id}` : `${FEED}/${item.uuid}`

    entries.push({
      id: `nowcoder:trending:${key}`,
      title: item.title,
      url,
      summary: `热度 ${item.hotValueFromDolphin ?? 0}`,
    })

    if (entries.length >= limit) {
      break
    }
  }

  if (entries.length === 0) {
    throw new Error('牛客没有返回帖子，接口可能已经变了')
  }

  return { entries }
}
