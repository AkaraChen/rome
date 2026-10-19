// Ported from RSSHub lib/routes/ithome/ranking.ts (AGPL-3.0).
// IT之家 热榜 — RSSHub 的 /ithome/ranking/:type 路由。
//
// 榜单在一个静态块页面上：https://www.ithome.com/block/rank.html 里三个
// <ul id="d-1|d-2|d-3">，分别是日榜、周榜、月榜。列表只有标题和链接，没有
// 时间，正文留给 preview。

export const meta = {
  id: 'rome.rsshub-ithome-ranking',
  name: 'IT之家 / iThome · 热榜',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: 'IT之家 24 小时、7 天与月度的阅读热榜',
  icon: 'https://www.ithome.com/favicon.ico',
  params: {
    fields: [
      {
        key: 'type',
        type: 'select',
        label: '类别',
        help: '榜单的时间范围',
        default: '',
        required: true,
        options: [
          { value: '24h', label: '24 小时阅读榜' },
          { value: '7days', label: '7 天最热' },
          { value: 'monthly', label: '月榜' },
        ],
      },
    ],
  },
}

// 站点自己的区块 id，和榜单一一对应。
const BLOCKS = { '24h': 'd-1', '7days': 'd-2', monthly: 'd-3' }

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

export async function fetch(ctx) {
  const type = ctx.params.type

  if (!type) {
    throw new Error('请填写榜单类别，例如 24h、7days 或 monthly')
  }

  if (!Object.prototype.hasOwnProperty.call(BLOCKS, type)) {
    throw new Error(`不认识的榜单「${type}」，可选：${Object.keys(BLOCKS).join('、')}`)
  }

  const url = 'https://www.ithome.com/block/rank.html'

  ctx.log.debug(`ithome: GET ${url}`)

  const response = await ctx.fetch(url, { headers: { accept: 'text/html' } })

  if (!response.ok) {
    throw new Error(`IT之家返回 ${response.status} ${response.statusText}`)
  }

  const html = await response.text()
  const id = BLOCKS[type]
  const start = html.indexOf(`id="${id}"`)

  if (start < 0) {
    throw new Error(`IT之家榜单页面里没有找到区块 ${id}，页面结构可能已经变了`)
  }

  const end = html.indexOf('</ul>', start)
  const section = html.slice(start, end < 0 ? undefined : end)
  const entries = []

  for (const match of section.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)) {
    const href = /\bhref="([^"]*)"/.exec(match[1])
    const title = /\btitle="([^"]*)"/.exec(match[1])
    const heading = title ? decode(title[1]) : text(match[2])

    if (!href || !heading) continue

    const link = decode(href[1])

    entries.push({
      id: `ithome:${new URL(link).pathname}`,
      title: heading,
      url: link,
    })
  }

  if (entries.length === 0) {
    throw new Error('IT之家榜单里没有读到任何条目，页面结构可能已经变了')
  }

  ctx.log.info(`ithome: 榜单 ${type} ${entries.length} 条`)

  return { entries }
}

export async function preview(ctx) {
  const url = ctx.item?.url

  if (!url) return null

  const content = await ctx.article(url)

  return content === null ? null : { content }
}
