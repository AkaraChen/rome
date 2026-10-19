// Ported from RSSHub lib/routes/indienova/gamedb.ts (AGPL-3.0).
// indienova GameDB — 最近收录的游戏。
//
// 列表卡片里游戏名是 <span> 的直接文本，后面跟着两个 <small>（收录时间和平台），
// 所以取标题时先把 <small> 去掉再取文本，否则标题会带上时间。

export const meta = {
  id: 'rome.rsshub-indienova-gamedb',
  name: 'indienova 独立游戏 · GameDB 游戏库',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: 'indienova GameDB 最近收录的独立游戏',
  icon: 'https://indienova.com/favicon.ico',
  params: {
    fields: [
      {
        key: 'platform',
        type: 'select',
        label: '平台',
        help: '留空为全部平台',
        default: 'all',
        required: false,
        options: [
          { value: 'all', label: '全部' },
          { value: 'ps4', label: 'PS4' },
          { value: 'xboxone', label: 'XBOX One' },
          { value: 'nintendo-switch', label: 'Nintendo Switch' },
        ],
      },
    ],
  },
}

const BASE = 'https://indienova.com'
const PLATFORMS = new Set(['all', 'ps4', 'xboxone', 'nintendo-switch'])

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

function absolute(href, base) {
  try {
    return new URL(decode(href), base).href
  } catch {
    return null
  }
}

// 收录时间写作「6 小时前 08:00」「昨天 12:30」。只取相对部分，后面的钟点忽略。
function relativeSeconds(text) {
  const now = Math.floor(Date.now() / 1000)
  let match

  if ((match = /(\d+)\s*秒前/.exec(text))) return now - Number(match[1])
  if ((match = /(\d+)\s*分钟前/.exec(text))) return now - Number(match[1]) * 60
  if ((match = /(\d+)\s*小时前/.exec(text))) return now - Number(match[1]) * 3600
  if ((match = /(\d+)\s*天前/.exec(text))) return now - Number(match[1]) * 86400
  if (/昨天/.test(text)) return now - 86400
  if (/前天/.test(text)) return now - 172800
  return undefined
}

function parseList(html) {
  const entries = []

  for (const block of html.split('<div class="related-game">').slice(1)) {
    const link = /<a href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(block)
    if (!link) continue

    const url = absolute(link[1], BASE)
    const span = /<span>([\s\S]*?)<\/span>/.exec(link[2])
    if (!url || !span) continue

    // 标题是 <span> 里除 <small> 之外的那段文本。
    const heading = stripTags(span[1].replace(/<small>[\s\S]*?<\/small>/g, ' '))
    if (!heading) continue

    const image = /<img[^>]+src="([^"]+)"/.exec(link[2])
    const smalls = [...link[2].matchAll(/<small>([\s\S]*?)<\/small>/g)].map((m) => stripTags(m[1]))

    const entry = {
      // 游戏页路径（/game/<slug>）是永久地址。
      id: `indienova:gamedb:${new URL(url).pathname}`,
      title: heading,
      url,
    }

    if (image) entry.image = absolute(image[1], BASE)
    if (smalls[0]) {
      const publishedAt = relativeSeconds(smalls[0])
      if (publishedAt !== undefined) entry.publishedAt = publishedAt
    }
    if (smalls.length > 1 && smalls[1]) entry.summary = smalls[1]

    entries.push(entry)
  }

  return entries
}

export async function fetch(ctx) {
  const platform = String(ctx.params.platform ?? 'all').trim() || 'all'

  if (!PLATFORMS.has(platform)) {
    throw new Error(`不支持的平台 ${platform}，可选 all、ps4、xboxone、nintendo-switch`)
  }

  const url = `${BASE}/gamedb/recent/${platform}/p/1`

  ctx.log.debug(`indienova: GET ${url}`)

  const response = await ctx.fetch(url, { headers: { accept: 'text/html' } })

  if (!response.ok) {
    throw new Error(`indienova GameDB 返回 ${response.status} ${response.statusText}`)
  }

  const html = await response.text()
  const entries = parseList(html)

  if (entries.length === 0) {
    throw new Error('indienova GameDB 没有解析到游戏，页面结构可能已经改变')
  }

  return { entries, icon: `${BASE}/favicon.ico` }
}

export async function preview(ctx) {
  if (!ctx.item?.url) return null
  const content = await ctx.article(ctx.item.url)
  return content === null ? null : { content }
}
