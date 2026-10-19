// Ported from RSSHub lib/routes/jinse/catalogue.ts (AGPL-3.0).
// 金色财经 — 分类资讯。
//
// 分类走 v6/www/information/list 接口，文章字段都藏在 `extra` 里。和首页一样，
// 接口给的链接域名已经失效，统一换成 www.jinse.com.cn。

export const meta = {
  id: 'rome.rsshub-jinse-catalogue',
  name: '金色财经 · 分类',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: '抓取金色财经指定分类的最新资讯',
  icon: 'https://www.jinse.com.cn/favicon.ico',
  params: {
    fields: [
      {
        key: 'category',
        type: 'select',
        label: '分类',
        help: '资讯分类，默认为政策',
        default: 'zhengce',
        options: [
          { value: 'zhengce', label: '政策' },
          { value: 'fenxishishuo', label: '行情' },
          { value: 'defi', label: 'DeFi' },
          { value: 'kuang', label: '矿业' },
          { value: '以太坊2.0', label: '以太坊 2.0' },
          { value: 'industry', label: '产业' },
          { value: 'IPFS', label: 'IPFS' },
          { value: 'tech', label: '技术' },
          { value: 'baike', label: '百科' },
          { value: 'capitalmarket', label: '研报' },
        ],
      },
    ],
  },
}

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

function strip(text) {
  return decode(String(text ?? '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim()
}

function normalise(url) {
  if (!url) return null
  return String(url).replace(/\/\/(?:www\.|m\.)?jinse\.com(?:\.cn)?(?=\/)/, '//www.jinse.com.cn')
}

function cover(url) {
  return url ? String(url).replace(/_[^\W_]+(\.\w+)$/, '_true$1') : undefined
}

export async function fetch(ctx) {
  const category = String(ctx.params.category || 'zhengce').trim() || 'zhengce'
  const query = new URLSearchParams({ catelogue_key: category, limit: '50', flag: 'up' })
  const url = `https://api.jinse.com.cn/v6/www/information/list?${query}`

  ctx.log.debug(`jinse: GET ${url}`)

  const response = await ctx.fetch(url, { headers: { accept: 'application/json' } })

  if (!response.ok) {
    throw new Error(`金色财经返回 ${response.status} ${response.statusText}`)
  }

  const body = await response.json()

  if (!Array.isArray(body?.list)) {
    throw new Error('金色财经接口没有返回 list 数组，接口可能已经变了')
  }

  const entries = []

  for (const item of body.list) {
    const extra = item?.extra

    if (!extra || !item.title) continue

    const id = extra.topic_id || item.id
    const link = normalise(extra.topic_url)

    const entry = {
      id: `jinse-catalogue:${id}`,
      title: strip(item.title),
      author: extra.nickname || '金色财经',
      summary: strip(extra.summary),
    }

    if (link) entry.url = link

    const pictures = Array.isArray(extra.thumbnails_pics) ? extra.thumbnails_pics : []
    if (pictures.length > 0) entry.image = cover(pictures[0])

    const publishedAt = Number(extra.published_at)
    if (Number.isFinite(publishedAt) && publishedAt > 0) entry.publishedAt = publishedAt

    entries.push(entry)
  }

  if (entries.length === 0) {
    throw new Error('金色财经接口没有返回任何资讯，分类可能不对')
  }

  ctx.log.info(`jinse: ${entries.length} 条资讯`)

  return { entries }
}

export async function preview(ctx) {
  const url = ctx.item?.url
  if (!url || url.includes('/lives/')) return null

  const content = await ctx.article(url)
  return content === null ? null : { content }
}
