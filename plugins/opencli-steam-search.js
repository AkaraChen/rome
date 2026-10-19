// Ported from OpenCLI clis/steam/search.js (Apache-2.0).
// Steam 商店搜索 — OpenCLI 的 `steam search`.
//
// 公开的 storesearch 接口，返回 app id，可以接着打开商店页。
// 移植自 clis/steam/search.js 与 clis/steam/utils.js。

export const meta = {
  id: 'rome.opencli-steam-search',
  name: 'Steam · 搜索游戏',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: '按名称搜索 Steam 商店的游戏。',
  icon: 'https://store.steampowered.com/favicon.ico',
  params: {
    fields: [
      {
        key: 'query',
        type: 'text',
        label: '关键词',
        help: '游戏名片段，例如 portal、stardew',
        default: '',
      },
      {
        key: 'limit',
        type: 'number',
        label: '条数',
        help: '最多 50 条',
        default: 20,
        min: 1,
        max: 50,
      },
      {
        key: 'currency',
        type: 'text',
        label: '区域',
        help: '两位国家代码，例如 us、cn、jp、de',
        default: 'us',
      },
    ],
  },
}

const STORE = 'https://store.steampowered.com'
const UA = 'opencli-steam-adapter (+https://github.com/jackwener/opencli)'

const ENTITIES = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&apos;': "'",
  '&#39;': "'",
  '&nbsp;': ' ',
}

function decodeHtmlEntities(value) {
  return String(value ?? '')
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number.parseInt(dec, 10)))
    .replace(/&(amp|lt|gt|quot|apos|#39|nbsp);/g, (match) => ENTITIES[match] || match)
}

function integer(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(Math.max(parsed, min), max)
}

function country(value) {
  const code = String(value ?? 'us').trim().toLowerCase() || 'us'

  if (!/^[a-z]{2}$/.test(code)) {
    throw new Error(`Steam 区域必须是两位国家代码（当前为 "${value}"），例如 us、cn、jp`)
  }

  return code
}

function price(cents, currency) {
  const number = Number(cents)
  if (!Number.isFinite(number)) return null
  return `${(number / 100).toFixed(2)} ${String(currency ?? '').toUpperCase()}`.trim()
}

function platformList(platforms) {
  if (!platforms || typeof platforms !== 'object') return ''

  return [
    platforms.windows ? 'Windows' : null,
    platforms.mac ? 'macOS' : null,
    platforms.linux ? 'Linux' : null,
  ].filter(Boolean).join(' / ')
}

export async function fetch(ctx) {
  const query = String(ctx.params?.query ?? '').trim()

  if (!query) {
    throw new Error('请填写搜索关键词')
  }

  const limit = integer(ctx.params?.limit, 20, 1, 50)
  const cc = country(ctx.params?.currency)

  const url = `${STORE}/api/storesearch/?term=${encodeURIComponent(query)}&l=en&cc=${encodeURIComponent(cc)}`

  ctx.log.debug(`opencli-steam-search: GET ${url}`)

  const response = await ctx.fetch(url, {
    headers: { 'user-agent': UA, accept: 'application/json' },
  })

  if (response.status === 429) {
    throw new Error('Steam 触发了限流（HTTP 429），请稍后重试')
  }

  if (!response.ok) {
    throw new Error(`Steam 搜索返回 HTTP ${response.status}`)
  }

  const body = await response.json()
  const items = Array.isArray(body?.items) ? body.items : []

  if (items.length === 0) {
    throw new Error(`Steam 没有找到与 "${query}" 匹配的游戏`)
  }

  const entries = []

  for (const [index, item] of items.slice(0, limit).entries()) {
    const name = decodeHtmlEntities(item?.name).trim()

    if (item?.id == null || !name) continue

    const parts = [`#${index + 1}`]

    const amount = price(item?.price?.final, item?.price?.currency)
    if (amount) parts.push(amount)

    if (item.metascore != null && item.metascore !== '') {
      const metascore = Number(item.metascore)
      if (Number.isFinite(metascore)) parts.push(`Metascore ${metascore}`)
    }

    const platforms = platformList(item.platforms)
    if (platforms) parts.push(platforms)

    const entry = {
      id: `steam:${item.id}`,
      title: name,
      url: `${STORE}/app/${item.id}/`,
      params: { appId: String(item.id) },
    }

    if (parts.length > 0) entry.summary = parts.join(' · ')
    if (item.tiny_image) entry.image = item.tiny_image

    entries.push(entry)
  }

  if (entries.length === 0) {
    throw new Error('Steam 搜索返回的结果都缺少 id 或名称')
  }

  ctx.log.info(`opencli-steam-search: ${entries.length} 条（${query}）`)

  return { entries }
}
