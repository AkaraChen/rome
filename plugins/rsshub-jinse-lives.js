// Ported from RSSHub lib/routes/jinse/lives.ts (AGPL-3.0).
// 金色财经 — 快讯。
//
// 快讯走另一个接口（noah/v2/lives），按天分组，所以先按天展开再取条目。
// 每条快讯本身就是一条消息，没有正文页可读，所以 view 用默认的 articles。

export const meta = {
  id: 'rome.rsshub-jinse-lives',
  name: '金色财经 · 快讯',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: '抓取金色财经的实时快讯',
  icon: 'https://www.jinse.com.cn/favicon.ico',
  params: {
    fields: [
      {
        key: 'category',
        type: 'select',
        label: '分类',
        help: '快讯分类，默认为全部',
        default: '0',
        options: [
          { value: '0', label: '全部' },
          { value: '1', label: '精选' },
          { value: '2', label: '政策' },
          { value: '3', label: '数据' },
          { value: '4', label: 'NFT' },
          { value: '5', label: '项目' },
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

function cover(url) {
  return url ? String(url).replace(/_[^\W_]+(\.\w+)$/, '_true$1') : undefined
}

export async function fetch(ctx) {
  const category = String(ctx.params.category || '0').trim() || '0'
  const query = new URLSearchParams({
    limit: '100',
    reading: 'false',
    source: 'web',
    flag: 'up',
    id: '0',
    category,
  })
  const url = `https://api.jinse.com.cn/noah/v2/lives?${query}`

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

  for (const group of body.list) {
    for (const item of group.lives || []) {
      if (!item || !item.id) continue

      const text = strip(item.content) || strip(item.content_prefix)
      if (!text) continue

      const entry = {
        id: `jinse-lives:${item.id}`,
        title: strip(item.content_prefix) || text.slice(0, 60),
        url: `https://www.jinse.com.cn/lives/${item.id}.html`,
        author: item.show_source_name || '金色财经',
        summary: text,
      }

      const images = Array.isArray(item.images) ? item.images : []
      if (images.length > 0 && images[0].url) {
        entry.image = cover(images[0].url)
      }

      const publishedAt = Number(item.created_at)
      if (Number.isFinite(publishedAt) && publishedAt > 0) entry.publishedAt = publishedAt

      entries.push(entry)
    }
  }

  if (entries.length === 0) {
    throw new Error('金色财经快讯接口没有返回任何内容，分类可能不对')
  }

  ctx.log.info(`jinse: ${entries.length} 条快讯`)

  return { entries }
}

export async function preview(ctx) {
  const url = ctx.item?.url
  if (!url) return null

  const content = await ctx.article(url)
  return content === null ? null : { content }
}
