// Ported from OpenCLI clis/toutiao/hot.js (Apache-2.0).
// 今日头条热榜 — OpenCLI 的 `toutiao hot`.
//
// 首页热榜背后的公开接口，不需要登录。榜单项带 ClusterIdStr，它是稳定的
// 话题标识；ClusterId 是超出 JS 安全整数范围的数字，不能拿来做 id。
// 移植自 clis/toutiao/hot.js 与 clis/toutiao/utils.js。

export const meta = {
  id: 'rome.opencli-toutiao-hot',
  name: '今日头条 · 热榜',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: '今日头条首页热榜，公开接口无需登录。',
  icon: 'https://www.toutiao.com/favicon.ico',
  params: {
    fields: [
      {
        key: 'limit',
        type: 'number',
        label: '条数',
        help: '1 到 50 条',
        default: 30,
        min: 1,
        max: 50,
      },
    ],
  },
}

const HOT_BOARD = 'https://www.toutiao.com/hot-event/hot-board/?origin=toutiao_pc'

function integer(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(Math.max(parsed, min), max)
}

function compact(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return null
  if (number >= 1e8) return `${(number / 1e8).toFixed(2)}亿`
  if (number >= 1e4) return `${(number / 1e4).toFixed(2)}万`
  return number.toFixed(0)
}

function imageFrom(item) {
  const direct = item?.Image?.url
  if (typeof direct === 'string' && direct) return direct

  const list = Array.isArray(item?.Image?.url_list) ? item.Image.url_list : []
  const entry = list.map((item) => (typeof item === 'string' ? item : item?.url)).find(Boolean)
  return entry || null
}

export async function fetch(ctx) {
  const limit = integer(ctx.params?.limit, 30, 1, 50)

  ctx.log.debug(`opencli-toutiao-hot: GET ${HOT_BOARD}`)

  const response = await ctx.fetch(HOT_BOARD, {
    headers: {
      'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      accept: 'application/json',
      referer: 'https://www.toutiao.com/',
    },
  })

  if (!response.ok) {
    throw new Error(`今日头条热榜返回 HTTP ${response.status}`)
  }

  const payload = await response.json()

  if (payload?.status && payload.status !== 'success') {
    throw new Error(`今日头条热榜返回 status=${payload.status}`)
  }

  if (payload?.error || payload?.message) {
    throw new Error(`今日头条热榜返回错误：${payload.error || payload.message}`)
  }

  const list = Array.isArray(payload?.data) ? payload.data : []

  if (list.length === 0) {
    throw new Error('今日头条热榜返回了空列表')
  }

  const entries = []

  for (const item of list) {
    const groupId = String(item?.ClusterIdStr ?? '').trim()
    const title = String(item?.Title ?? '').trim()

    if (!groupId || !title) continue

    const parts = []
    const heat = compact(item.HotValue)
    if (heat !== null) parts.push(`热度 ${heat}`)
    if (item.Label) parts.push(String(item.Label))

    const query = String(item.QueryWord ?? '').trim()
    if (query && query !== title) parts.push(`搜索词 ${query}`)

    const entry = {
      id: `tt:${groupId}`,
      title,
      url: item.Url || `https://www.toutiao.com/trending/${groupId}/`,
    }

    if (parts.length > 0) entry.summary = parts.join(' · ')

    const image = imageFrom(item)
    if (image) entry.image = image

    entries.push(entry)

    if (entries.length >= limit) break
  }

  if (entries.length === 0) {
    throw new Error('今日头条热榜返回的条目都缺少稳定标识或标题')
  }

  // 上游偶有空位；截断后按输出顺序重新编号，让摘要里的名次是连续的。
  const ranked = entries.map((entry, index) => ({
    ...entry,
    summary: entry.summary ? `#${index + 1} · ${entry.summary}` : `#${index + 1}`,
  }))

  ctx.log.info(`opencli-toutiao-hot: ${ranked.length} 条`)

  return { entries: ranked }
}
