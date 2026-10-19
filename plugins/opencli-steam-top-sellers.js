// Ported from OpenCLI clis/steam/top-sellers.js (Apache-2.0).
// Steam 热销榜 — OpenCLI 的 `steam top-sellers`.
//
// store 的公开 featured categories 接口，top_sellers 就是商店首页的榜单。
// 移植自 clis/steam/top-sellers.js。

export const meta = {
  id: 'rome.opencli-steam-top-sellers',
  name: 'Steam · 热销榜',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: 'Steam 商店当前的热销游戏。',
  icon: 'https://store.steampowered.com/favicon.ico',
  params: {
    fields: [
      {
        key: 'limit',
        type: 'number',
        label: '条数',
        help: '返回多少个游戏',
        default: 10,
        min: 1,
        max: 100,
      },
    ],
  },
}

const CATEGORIES = 'https://store.steampowered.com/api/featuredcategories/'

function integer(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(Math.max(parsed, min), max)
}

function money(cents, currency) {
  const number = Number(cents)
  if (!Number.isFinite(number)) return null
  return `${(number / 100).toFixed(2)} ${String(currency ?? '').toUpperCase()}`.trim()
}

export async function fetch(ctx) {
  const limit = integer(ctx.params?.limit, 10, 1, 100)

  ctx.log.debug(`opencli-steam-top-sellers: GET ${CATEGORIES}`)

  const response = await ctx.fetch(CATEGORIES, {
    headers: { accept: 'application/json' },
  })

  if (!response.ok) {
    throw new Error(`Steam 返回 HTTP ${response.status}`)
  }

  const data = await response.json()
  const items = data?.top_sellers?.items

  if (!Array.isArray(items)) {
    throw new Error('Steam 没有返回 top_sellers 列表，接口可能已经变了')
  }

  if (items.length === 0) {
    throw new Error('Steam 热销榜没有返回游戏')
  }

  const entries = []

  for (const [index, item] of items.slice(0, limit).entries()) {
    if (item?.id == null || !item?.name) continue

    const parts = [`#${index + 1}`]

    const price = money(item.final_price, item.currency)
    if (price) parts.push(price)

    if (Number(item.discount_percent) > 0) parts.push(`折扣 ${item.discount_percent}%`)

    const entry = {
      // app id 是 Steam 商店的永久标识。
      id: `steam:${item.id}`,
      title: String(item.name),
      url: `https://store.steampowered.com/app/${item.id}`,
      summary: parts.join(' · '),
      params: { appId: String(item.id) },
    }

    const image = item.header_image || item.large_capsule_image
    if (image) entry.image = image

    entries.push(entry)
  }

  if (entries.length === 0) {
    throw new Error('Steam 热销榜返回的游戏都缺少 id 或名称')
  }

  ctx.log.info(`opencli-steam-top-sellers: ${entries.length} 条`)

  return { entries }
}
