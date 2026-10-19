// Ported from RSSHub lib/routes/steam/sharefile-changelog.ts (AGPL-3.0).
// Steam 创意工坊物品改动说明 — sharedfiles/filedetails/changelog/<id>。
//
// 每条更新的正文是 <p id="<unix 秒>">，id 本身就是发布时间，所以不必去
// 解析页面上那句本地化的「更新于：8 月 8 日 下午 4:04」。正文里的 <br>
// 是站点自己的换行，直接保留。

export const meta = {
  id: 'rome.rsshub-steam-sharefile-changelog',
  name: 'Steam · 创意工坊改动说明',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: 'Steam 创意工坊物品的更新日志',
  icon: 'https://steamcommunity.com/favicon.ico',
  params: {
    fields: [
      {
        key: 'sharefileID',
        type: 'text',
        label: '物品 ID',
        help: '创意工坊物品 URL 中的 id，例如 2851063440',
        default: '',
        required: true,
      },
      {
        key: 'routeParams',
        type: 'text',
        label: '筛选参数',
        help: '可选的查询串，例如 l=schinese',
        default: '',
        required: false,
      },
    ],
  },
}

const BASE = 'https://steamcommunity.com'

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

function decode(text) {
  return String(text).replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity) => {
    if (entity[0] === '#') {
      const code = entity[1] === 'x' || entity[1] === 'X'
        ? Number.parseInt(entity.slice(2), 16)
        : Number.parseInt(entity.slice(1), 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : match
    }
    return Object.prototype.hasOwnProperty.call(ENTITIES, entity) ? ENTITIES[entity] : match
  })
}

function stripTags(html) {
  return decode(String(html).replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim()
}

export async function fetch(ctx) {
  const id = String(ctx.params.sharefileID ?? '').trim()

  if (!id) {
    throw new Error('请填写创意工坊物品 ID（数字）')
  }
  if (!/^\d+$/.test(id)) {
    throw new Error(`物品 ID ${id} 无效，应为数字`)
  }

  const query = new URLSearchParams(String(ctx.params.routeParams ?? ''))
  if (query.has('p')) query.set('p', '1')

  const page = `${BASE}/sharedfiles/filedetails/changelog/${id}${query.size > 0 ? `?${query}` : ''}`

  ctx.log.debug(`steam: GET ${page}`)

  const response = await ctx.fetch(page, { headers: { accept: 'text/html' } })

  if (!response.ok) {
    throw new Error(`Steam 创意工坊返回 ${response.status} ${response.statusText}`)
  }

  const html = await response.text()

  const title = /<div class="workshopItemTitle">([\s\S]*?)<\/div>/.exec(html)
  const itemTitle = title ? stripTags(title[1]) : ''

  const blocks = html.split(/<div class="[^"]*changeLogCtn[^"]*">/).slice(1)

  if (blocks.length === 0) {
    throw new Error(`创意工坊物品 ${id} 没有改动记录，物品可能已删除或页面结构已经改变`)
  }

  const entries = []

  for (const block of blocks) {
    const body = /<p id="(\d+)">([\s\S]*?)<\/p>/.exec(block)
    if (!body) continue

    const timestamp = Number(body[1])
    if (!Number.isFinite(timestamp)) continue

    const headline = /<div class="changelog headline">([\s\S]*?)<\/div>/.exec(block)
    const headlineText = headline ? stripTags(headline[1]) : ''
    const author = /<div class="changelog author">[\s\S]*?<a\b[^>]*>([\s\S]*?)<\/a>/.exec(block)

    const entry = {
      // 更新时间戳不会变，所以「物品 ID + 时间戳」是稳定的。
      id: `steam:changelog:${id}:${timestamp}`,
      title: headlineText ? `${itemTitle || `物品 ${id}`} · ${headlineText}` : `${itemTitle || `物品 ${id}`} 更新`,
      url: page,
      content: body[2].trim(),
      publishedAt: timestamp,
    }

    if (author) {
      const name = stripTags(author[1])
      if (name) entry.author = name
    }

    entries.push(entry)
  }

  if (entries.length === 0) {
    throw new Error(`创意工坊物品 ${id} 没有解析到改动记录，页面结构可能已经改变`)
  }

  return { entries, icon: `${BASE}/favicon.ico` }
}
