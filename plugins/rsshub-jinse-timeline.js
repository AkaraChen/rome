// Ported from RSSHub lib/routes/jinse/timeline.ts (AGPL-3.0).
// 金色财经 — 首页资讯时间线。
//
// 站点有 JSON 接口，所以直接读接口而不是抓 HTML。接口返回的 `object_1` /
// `object_2` 里才是文章本体，且不同条目的域名不一致，统一换成 www.jinse.com.cn。

export const meta = {
  id: 'rome.rsshub-jinse-timeline',
  name: '金色财经 · 首页',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: '抓取金色财经首页的资讯时间线',
  icon: 'https://www.jinse.com.cn/favicon.ico',
  params: {
    fields: [
      {
        key: 'category',
        type: 'select',
        label: '分类',
        help: '资讯分类，默认为头条',
        default: '头条',
        options: [
          { value: '头条', label: '头条' },
          { value: '独家', label: '独家' },
          { value: '铭文', label: '铭文' },
          { value: '产业', label: '产业' },
          { value: '项目', label: '项目' },
          { value: '政策', label: '政策' },
          { value: 'AI', label: 'AI' },
          { value: 'Web 3.0', label: 'Web 3.0' },
          { value: '以太坊 2.0', label: '以太坊 2.0' },
          { value: 'DeFi', label: 'DeFi' },
          { value: 'Layer2', label: 'Layer2' },
          { value: 'NFT', label: 'NFT' },
          { value: 'DAO', label: 'DAO' },
          { value: '百科', label: '百科' },
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

/// 接口会返回 jinse.com、m.jinse.com.cn 等已经失效的域名，统一到 www.jinse.com.cn。
function normalise(url) {
  if (!url) return null
  return String(url).replace(/\/\/(www\.|m\.)?jinse\.com(\.cn)?/, '//www.jinse.com.cn')
}

/// 封面缩略图带 `_small` 后缀，换成 `_true` 拿到原图。
function cover(url) {
  return url ? String(url).replace(/_[^\W_]+(\.\w+)$/, '_true$1') : undefined
}

export async function fetch(ctx) {
  const category = String(ctx.params.category || '头条').trim() || '头条'
  const query = new URLSearchParams({
    catelogue_key: category === '头条' ? 'www' : category,
    limit: '50',
    information_id: '0',
    flag: 'up',
  })
  const url = `https://api.jinse.com.cn/noah/v3/timelines?${query}`

  ctx.log.debug(`jinse: GET ${url}`)

  const response = await ctx.fetch(url, { headers: { accept: 'application/json' } })

  if (!response.ok) {
    throw new Error(`金色财经返回 ${response.status} ${response.statusText}`)
  }

  const body = await response.json()
  const list = body?.data?.list

  if (!Array.isArray(list)) {
    throw new Error('金色财经接口没有返回 data.list 数组，接口可能已经变了')
  }

  const entries = []

  for (const row of list) {
    const item = row.object_1 || row.object_2

    if (!item || !item.id || !item.title) continue

    const link = normalise(item.jump_url)
    const entry = {
      // 接口里两种对象共用同一个 id 空间，所以前缀里带上路由名以免撞车。
      id: `jinse:${item.id}`,
      title: strip(item.title),
      author: item.author?.nickname,
      summary: strip(item.summary),
    }

    if (link) entry.url = link
    if (item.cover) entry.image = cover(item.cover)

    const publishedAt = Number(item.published_at)
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
  // 快讯页没有正文区块，交给列表里的摘要即可。
  if (!url || url.includes('/lives/')) return null

  const content = await ctx.article(url)
  return content === null ? null : { content }
}
