// Ported from RSSHub lib/routes/steam/appcommunityfeed.tsx (AGPL-3.0).
// Steam 社区中心动态 — steamcommunity.com 的社区 feed 接口。
//
// 返回的是 JSON，条目混着截图、艺术作品和创意工坊物品；没有标题的物品
// 用类型名兜底。封面图在 full_image_url，预览图是它的缩略版本。

export const meta = {
  id: 'rome.rsshub-steam-appcommunityfeed',
  name: 'Steam · 社区中心动态',
  version: '1.0.0',
  apiVersion: '1',
  view: 'pictures',
  description: 'Steam 游戏社区中心的玩家投稿与创意工坊内容',
  icon: 'https://steamcommunity.com/favicon.ico',
  params: {
    fields: [
      {
        key: 'appid',
        type: 'text',
        label: '游戏 App ID',
        help: 'Steam 商店 URL 中的数字，例如 730',
        default: '',
        required: true,
      },
      {
        key: 'routeParams',
        type: 'text',
        label: '筛选参数',
        help: '可选的查询串，例如 rgSections[]=2&filterLanguage=english',
        default: '',
        required: false,
      },
    ],
  },
}

const BASE = 'https://steamcommunity.com'

const TYPES = {
  0: '社区',
  1: '微交易',
  2: '合集',
  3: '艺术作品',
  4: '视频',
  5: '截图',
  6: '游戏',
  7: '软件',
  8: '概念图',
  9: '网页指南',
  10: '集成指南',
  11: '周边',
  12: '手柄配置',
  13: 'Steamworks 邀请',
  14: 'Steam 视频',
  15: '游戏内物品',
}

function escape(text) {
  return String(text ?? '').replace(/[&<>"]/g, (ch) => {
    if (ch === '&') return '&amp;'
    if (ch === '<') return '&lt;'
    if (ch === '>') return '&gt;'
    return '&quot;'
  })
}

export async function fetch(ctx) {
  const appid = String(ctx.params.appid ?? '').trim()

  if (!appid) {
    throw new Error('请填写游戏 App ID（数字）')
  }
  if (!/^\d+$/.test(appid)) {
    throw new Error(`App ID ${appid} 无效，应为数字`)
  }

  const query = new URLSearchParams(String(ctx.params.routeParams ?? ''))
  // 分页参数固定回第一页，否则每次刷新读到的页不同，会重复插入旧内容。
  if (query.has('p')) query.set('p', '1')

  const url = `${BASE}/library/appcommunityfeed/${appid}${query.size > 0 ? `?${query}` : ''}`

  ctx.log.debug(`steam: GET ${url}`)

  const response = await ctx.fetch(url, { headers: { accept: 'application/json' } })

  if (!response.ok) {
    throw new Error(`Steam 社区中心返回 ${response.status} ${response.statusText}`)
  }

  const body = await response.json()

  if (!Array.isArray(body.hub)) {
    throw new Error('Steam 社区中心接口没有返回 hub 数组，接口可能已经变了')
  }

  const entries = []

  for (const item of body.hub) {
    if (!item.published_file_id) continue

    const title = item.title || TYPES[item.type] || `社区内容 ${item.published_file_id}`
    const entry = {
      // 创意工坊物品的 published_file_id 是永久标识。
      id: `steam:workshop:${item.published_file_id}`,
      title,
      url: `${BASE}/sharedfiles/filedetails/?id=${item.published_file_id}`,
    }

    if (item.creator?.name) entry.author = item.creator.name
    if (item.full_image_url) entry.image = item.full_image_url
    if (item.description) entry.content = `<p>${escape(item.description)}</p>`
    if (TYPES[item.type]) entry.summary = TYPES[item.type]

    entries.push(entry)
  }

  return { entries, icon: 'https://steamcommunity.com/favicon.ico' }
}
