// Ported from RSSHub lib/routes/nintendo/eshop-jp.ts (AGPL-3.0).
// Nintendo eShop 日服 — /nintendo/eshop/jp
//
// Nintendo's own search backend, asked for what is on sale or on preorder and
// sorted by release date. It is a GET with the filters in the query string and
// answers with plain JSON, no key.
//
// The cover is addressed by the item's `iurl` on the eShop image CDN, and the
// price and copy lines come from the same record.

export const meta = {
  id: 'rome.rsshub-nintendo-eshop-jp',
  name: 'Nintendo · eShop 日服',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: 'Nintendo eShop 日服新上架的游戏',
  icon: 'https://www.nintendo.co.jp/favicon.ico',
}

const API = 'https://search.nintendo.jp/nintendo_soft/search.json'
const IMAGE = 'https://img-eshop.cdn.nintendo.net/i/'

function firstLine(text, limit) {
  const line = String(text ?? '').replace(/\s+/g, ' ').trim()
  if (!line) return undefined
  return line.length > limit ? `${line.slice(0, limit - 1)}…` : line
}

/// `pdate` is `2026-10-16 00:00:00` in Japan Standard Time, and the space is
/// not something Date.parse accepts.
function date(value) {
  const match = String(value || '').match(/(\d{4})-(\d{2})-(\d{2})/)
  if (!match) return undefined

  const parsed = Date.parse(`${match[1]}-${match[2]}-${match[3]}T00:00:00+09:00`)
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : undefined
}

export async function fetch(ctx) {
  const url = new URL(API)
  url.searchParams.set('opt_sshow', '1')
  url.searchParams.set('fq', 'ssitu_s:onsale OR ssitu_s:preorder OR memo_bg:forced')
  url.searchParams.set('limit', '24')
  url.searchParams.set('page', '1')
  url.searchParams.set('c', '50310840317994813')
  url.searchParams.set('opt_osale', '1')
  url.searchParams.set('opt_hard', '1_HAC')
  url.searchParams.set('sort', 'sodate desc,score')

  const response = await ctx.fetch(url, { headers: { accept: 'application/json' } })

  if (!response.ok) {
    throw new Error(`Nintendo 返回 ${response.status}`)
  }

  const items = (await response.json()).result?.items

  if (!Array.isArray(items)) {
    throw new Error('Nintendo 没有返回游戏列表，接口可能已经变了')
  }

  const entries = items.map((item) => {
    const entry = {
      id: `nintendo-eshop-jp:${item.id}`,
      title: item.title,
      url: `https://ec.nintendo.com/JP/ja/titles/${item.id}`,
      author: 'Nintendo',
      summary: [item.dprice ? `${item.dprice} 日元` : undefined, (item.hcopy || []).join(' · ') || undefined]
        .filter(Boolean)
        .join(' · ') || undefined,
    }

    if (item.iurl) entry.image = `${IMAGE}${item.iurl}.jpg`

    const publishedAt = date(item.pdate)
    if (publishedAt !== undefined) entry.publishedAt = publishedAt

    // The store blurb is plain text with newlines; the list wants one line.
    const blurb = firstLine(item.text, 140)
    if (blurb) entry.summary = [entry.summary, blurb].filter(Boolean).join(' · ')

    return entry
  })

  ctx.log.info(`nintendo-eshop-jp: ${entries.length} 款`)

  return { entries }
}
