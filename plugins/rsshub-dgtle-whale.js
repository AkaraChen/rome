// Ported from RSSHub lib/routes/dgtle/whale.ts (AGPL-3.0).
// 数字尾巴鲸图 — /dgtle/whale/category/:category
//
// A picture stream on a different host from the rest of the site: the whale
// API lives on opser.api.dgtle.com and takes the category as a number from 0
// to 11. The category list is fixed and published, so it is a select here.
//
// A post is a caption plus one or more pictures. The caption is often a single
// character, so the category name is used when it is empty, and every picture
// goes into the entry's content — this is a pictures view, and the images are
// the point.

export const meta = {
  id: 'rome.rsshub-dgtle-whale',
  name: '数字尾巴 · 鲸图',
  version: '1.0.0',
  apiVersion: '1',
  view: 'pictures',
  description: '数字尾巴鲸图各分类的图片动态',
  icon: 'https://www.dgtle.com/favicon.ico',
  params: {
    fields: [
      {
        key: 'category',
        type: 'select',
        label: '分类',
        default: '0',
        options: [
          { value: '0', label: '精选' },
          { value: '1', label: '人物' },
          { value: '2', label: '静物' },
          { value: '3', label: '二次元' },
          { value: '4', label: '黑白' },
          { value: '5', label: '自然' },
          { value: '6', label: '美食' },
          { value: '7', label: '电影与游戏' },
          { value: '8', label: '科技与艺术' },
          { value: '9', label: '城市与建筑' },
          { value: '10', label: '萌物' },
          { value: '11', label: '美女' },
        ],
      },
    ],
  },
}

const API = 'https://opser.api.dgtle.com/v1/whale/index'
const HOST = 'https://www.dgtle.com'

const CATEGORIES = ['精选', '人物', '静物', '二次元', '黑白', '自然', '美食', '电影与游戏', '科技与艺术', '城市与建筑', '萌物', '美女']

/// The API returns each picture with a resize query string; the bare file is
/// what an image client should be given.
function picture(url) {
  if (!url) return undefined
  return String(url).split('?')[0]
}

export async function fetch(ctx) {
  const category = Number(ctx.params.category)

  if (!Number.isInteger(category) || category < 0 || category >= CATEGORIES.length) {
    throw new Error('分类必须是 0 到 11 之间的整数')
  }

  const url = new URL(API)
  url.searchParams.set('category_id', String(category))
  url.searchParams.set('page', '1')
  url.searchParams.set('per-page', '10')

  const response = await ctx.fetch(url, { headers: { accept: 'application/json' } })

  if (!response.ok) {
    throw new Error(`数字尾巴返回 ${response.status}（鲸图分类 ${category}）`)
  }

  const items = (await response.json()).items

  if (!Array.isArray(items)) {
    throw new Error('数字尾巴没有返回鲸图列表，接口可能已经变了')
  }

  const entries = items.map((item) => {
    const list = Array.isArray(item.aid_list) && item.aid_list.length > 0 ? item.aid_list : [item.attachment].filter(Boolean)
    const images = list.map((entry) => picture(entry.pic_url)).filter(Boolean)

    const caption = String(item.content ?? '').trim()

    const entry = {
      id: `dgtle-whale:${item.id}`,
      title: caption.length > 1 ? caption.slice(0, 60) : `鲸图 · ${CATEGORIES[category]}`,
      url: images[0] || HOST,
      author: item.author?.username || undefined,
    }

    if (images[0]) entry.image = images[0]

    if (images.length > 0) {
      entry.content = images.map((src) => `<img src="${src}">`).join('')
    }

    const publishedAt = Number(item.created_at)
    if (Number.isFinite(publishedAt)) entry.publishedAt = Math.floor(publishedAt)

    return entry
  })

  ctx.log.info(`dgtle-whale: ${entries.length} 条（${CATEGORIES[category]}）`)

  return { entries }
}
