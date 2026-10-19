// Ported from RSSHub lib/routes/nintendo/eshop-hk.ts (AGPL-3.0).
// Nintendo eShop 港服 — /nintendo/eshop/hk
//
// A static JSON file the Hong Kong software page loads: every Switch title,
// each with its release date and store link. Rows without an https link are
// placeholders and are dropped, and the list is newest first because the file
// is not sorted by date.
//
// RSSHub opens each product page for its description and price. This plugin
// does not — that is a page per item on every refresh for a feed that only
// needs the title and the date.

export const meta = {
  id: 'rome.rsshub-nintendo-eshop-hk',
  name: 'Nintendo · eShop 港服',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: 'Nintendo eShop 港服新上架的游戏',
  icon: 'https://www.nintendo.com.hk/favicon.ico',
}

const API = 'https://www.nintendo.com.hk/data/json/switch_software.json'

/// The file states dates as `2022.6.24` in Hong Kong local time.
function date(value) {
  const match = String(value || '').match(/(\d{4})\.(\d{1,2})\.(\d{1,2})/)
  if (!match) return undefined

  const parsed = Date.parse(`${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}T00:00:00+08:00`)
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : undefined
}

export async function fetch(ctx) {
  const response = await ctx.fetch(API, { headers: { accept: 'application/json' } })

  if (!response.ok) {
    throw new Error(`Nintendo 香港返回 ${response.status}`)
  }

  const list = await response.json()

  if (!Array.isArray(list)) {
    throw new Error('Nintendo 香港没有返回游戏列表，接口可能已经变了')
  }

  const entries = list
    .filter((item) => typeof item.link === 'string' && item.link.startsWith('https://'))
    .map((item) => {
      const entry = {
        id: `nintendo-eshop-hk:${item.link}`,
        title: item.title,
        url: item.link,
        author: item.maker_publisher || 'Nintendo',
        summary: [item.platform, item.release_date ? `发售 ${item.release_date}` : undefined].filter(Boolean).join(' · ') || undefined,
      }

      const publishedAt = date(item.release_date)
      if (publishedAt !== undefined) entry.publishedAt = publishedAt

      return entry
    })
    .sort((a, b) => (b.publishedAt || 0) - (a.publishedAt || 0))
    .slice(0, 30)

  if (entries.length === 0) {
    throw new Error('Nintendo 香港没有可用的游戏条目，数据格式可能已经变了')
  }

  ctx.log.info(`nintendo-eshop-hk: ${entries.length} 款`)

  return { entries }
}

export async function preview(ctx) {
  const content = await ctx.article(ctx.item.url)
  return content ? { content } : null
}
