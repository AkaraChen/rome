// Ported from RSSHub lib/routes/dcfever/reviews.ts (AGPL-3.0).
// DCFever 測試報告 — RSSHub 的 /dcfever/reviews/:type? 路由。
//
// 和新聞中心同一個列表結構，只是分類路徑不同（/<type>/reviews.php）。
// 第一條常常是重複的頭條，所以按連結去重。
//
// 日期這裡是「10 月 12 日」這種沒有年份的寫法，按香港當下日期補年份。

export const meta = {
  id: 'rome.rsshub-dcfever-reviews',
  name: 'DCFever · 測試報告',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: 'DCFever 的相機鏡頭、手機平板與試車報告',
  icon: 'https://www.dcfever.com/favicon.ico',
  params: {
    fields: [
      {
        key: 'type',
        type: 'select',
        label: '分類',
        help: '要看的測試報告種類，預設為相機及鏡頭',
        default: 'cameras',
        options: [
          { value: 'cameras', label: '相機及鏡頭' },
          { value: 'phones', label: '手機平板' },
          { value: 'cars', label: '試車報告' },
        ],
      },
    ],
  },
}

const BASE = 'https://www.dcfever.com'

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

function decode(text) {
  return String(text ?? '').replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity) => {
    if (entity[0] === '#') {
      const code = entity[1] === 'x' || entity[1] === 'X'
        ? Number.parseInt(entity.slice(2), 16)
        : Number.parseInt(entity.slice(1), 10)

      return Number.isFinite(code) ? String.fromCodePoint(code) : match
    }

    return Object.prototype.hasOwnProperty.call(ENTITIES, entity) ? ENTITIES[entity] : match
  })
}

function text(html) {
  return decode(String(html ?? '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim()
}

const RELATIVE = /(\d+)\s*(分鐘|小時|天|日|星期|週|個月)\s*前/

const UNITS = {
  分鐘: 60,
  小時: 3600,
  天: 86400,
  日: 86400,
  星期: 604800,
  週: 604800,
  個月: 2592000,
}

/// 站點在 +08:00，「10 月 12 日」這種寫法沒有年份，按香港當下日期補。
function seconds(input) {
  const value = String(input ?? '').trim()

  if (!value) return undefined

  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)

  if (iso) {
    return Math.floor(Date.parse(`${iso[1]}-${iso[2]}-${iso[3]}T00:00:00+08:00`) / 1000)
  }

  const relative = RELATIVE.exec(value)

  if (relative) {
    return Math.floor(Date.now() / 1000) - Number(relative[1]) * UNITS[relative[2]]
  }

  const absolute = /(\d{1,2})\s*月\s*(\d{1,2})\s*日/.exec(value)

  if (absolute) {
    const now = new Date(Date.now() + 8 * 3600 * 1000)
    let year = now.getUTCFullYear()
    const month = absolute[1].padStart(2, '0')
    const day = absolute[2].padStart(2, '0')
    let at = Date.parse(`${year}-${month}-${day}T00:00:00+08:00`)

    // 沒有年份的日期落在未來，說明是去年的。
    if (at - Date.now() > 86400 * 1000) {
      year -= 1
      at = Date.parse(`${year}-${month}-${day}T00:00:00+08:00`)
    }

    return Number.isFinite(at) ? Math.floor(at / 1000) : undefined
  }

  return undefined
}

/// 列表項在兩種頁面上一個用 div 一個用 span，所以標籤名放開。
function field(block, name) {
  const match = new RegExp(`<(?:div|span) class="${name}">([\\s\\S]*?)</(?:div|span)>`).exec(block)

  return match ? match[1] : null
}

export async function fetch(ctx) {
  const type = String(ctx.params.type ?? '').trim() || 'cameras'
  const link = `${BASE}/${encodeURIComponent(type)}/reviews.php`

  ctx.log.debug(`dcfever: GET ${link}`)

  const response = await ctx.fetch(link, { headers: { accept: 'text/html' } })

  if (!response.ok) {
    throw new Error(`DCFever 返回 ${response.status} ${response.statusText}`)
  }

  const html = await response.text()
  const seen = new Set()
  const entries = []

  for (const block of html.split(/<div class="article_div\b/).slice(1)) {
    const anchor = /<a\b[^>]*\bhref="([^"]+)"/.exec(block)

    if (!anchor) continue

    const title = text(field(block, 'title'))

    if (!title) continue

    const url = new URL(decode(anchor[1]), link).href

    if (seen.has(url)) continue

    seen.add(url)

    const entry = {
      id: `dcfever:${new URL(url).pathname}${new URL(url).search}`,
      title,
      url,
    }

    const image = /<img\b[^>]*\bsrc="([^"]+)"/.exec(block)

    if (image && !image[1].endsWith('/images/s.gif')) entry.image = decode(image[1])

    const excerpt = text(field(block, 'introduction'))

    if (excerpt) entry.summary = excerpt.replace(/\(繼續閱讀\)$/, '').trim()

    const publishedAt = seconds(text(field(block, 'date')))

    if (publishedAt !== undefined) entry.publishedAt = publishedAt

    entries.push(entry)
  }

  if (entries.length === 0) {
    throw new Error(`DCFever「${type}」測試報告頁裡沒有讀到任何條目，頁面結構可能已經變了`)
  }

  ctx.log.info(`dcfever: 測試報告 ${type} ${entries.length} 條`)

  return { entries }
}

export async function preview(ctx) {
  const url = ctx.item?.url

  if (!url) return null

  const content = await ctx.article(url)

  return content === null ? null : { content }
}
