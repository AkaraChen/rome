// Ported from RSSHub lib/routes/steam/search.ts (AGPL-3.0).
// Steam 商店搜索 — store.steampowered.com/search/。
//
// 结果是服务端渲染的 <a class="search_result_row">，每行一个游戏。行里有
// 嵌套的 div，但没有嵌套的 a，所以可以按「行开标签 → 第一个 </a>」切。
// 注意 href 必须从行的属性里取：如果先匹配 href 再匹配 class，正则的
// [\s\S]*? 会跨过整行，把页面别处的第一个链接当成结果。

export const meta = {
  id: 'rome.rsshub-steam-search',
  name: 'Steam · 商店搜索',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: 'Steam 商店的搜索结果',
  icon: 'https://store.steampowered.com/favicon.ico',
  params: {
    fields: [
      {
        key: 'params',
        type: 'text',
        label: '搜索参数',
        help: '商店搜索页的查询串，例如 term=half-life&category1=998',
        default: '',
        required: true,
      },
    ],
  },
}

const BASE = 'https://store.steampowered.com'

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

// 商店把日期写成 Oct 18, 2026；没有具体日期的行（即将推出、2027 年）跳过。
function releaseSeconds(text) {
  const clean = text.trim()
  if (!/^[A-Z][a-z]{2} \d{1,2}, \d{4}$/.test(clean)) return undefined
  const milliseconds = Date.parse(`${clean} UTC`)
  return Number.isFinite(milliseconds) ? Math.floor(milliseconds / 1000) : undefined
}

export async function fetch(ctx) {
  // 上游把整段查询串作为一个路径参数，键名照抄：ctx.params.params。
  const query = String(ctx.params.params ?? '').trim().replace(/^\?/, '')

  if (!query) {
    throw new Error('请填写搜索参数，例如 term=half-life')
  }

  const search = new URLSearchParams(query)
  // 固定第一页，否则每次刷新读到的是不同的一页，旧条目会被反复插入。
  if (search.has('page')) search.set('page', '1')
  if (search.has('start')) search.set('start', '0')

  const url = `${BASE}/search/?${search}`

  ctx.log.debug(`steam: GET ${url}`)

  const response = await ctx.fetch(url, { headers: { accept: 'text/html' } })

  if (!response.ok) {
    throw new Error(`Steam 搜索返回 ${response.status} ${response.statusText}`)
  }

  const html = await response.text()
  const row = /<a\b([^>]*\bclass="search_result_row[^"]*"[^>]*)>([\s\S]*?)<\/a>/g

  const entries = []
  let match

  while ((match = row.exec(html))) {
    const attrs = match[1]
    const body = match[2]

    const href = /\bhref="([^"]+)"/.exec(attrs)
    const bundle = /\bdata-ds-bundleid="([^"]+)"/.exec(attrs)
    const title = /<span class="title">([\s\S]*?)<\/span>/.exec(body)

    if (!href || !title) continue

    // href 带着 ?snr=… 的搜索来源标记，去掉它才是干净的商店地址。
    const link = new URL(decode(href[1]), BASE)
    link.searchParams.delete('snr')

    // 以链接里的 App ID 为准：这一行上还有 data-ds-appid，但它是搜索结果
    // 内部用的编号，实测经常和链接指向的 App 不一致。
    const pathApp = /^\/app\/(\d+)\//.exec(link.pathname)

    const entry = {
      // App ID 是永久标识；合集没有 App ID，退回用链接路径。
      id: `steam:app:${pathApp ? pathApp[1] : bundle ? `bundle-${bundle[1]}` : link.pathname}`,
      title: stripTags(title[1]),
      url: link.href,
    }

    const image = /<img src="([^"]+)"/.exec(body)
    if (image) entry.image = decode(image[1])

    const released = /class="search_released[^"]*"[^>]*>([\s\S]*?)<\/div>/.exec(body)
    if (released) {
      const publishedAt = releaseSeconds(stripTags(released[1]))
      if (publishedAt !== undefined) entry.publishedAt = publishedAt
    }

    const parts = []
    const score = /class="search_reviewscore[^"]*"[^>]*>([\s\S]*?)<\/div>/.exec(body)
    if (score) {
      const text = stripTags(score[1])
      if (text) parts.push(text)
    }
    const price = /class="discount_final_price[^"]*"[^>]*>([\s\S]*?)<\/div>/.exec(body)
    if (price) {
      const text = stripTags(price[1])
      if (text) parts.push(text)
    }
    if (parts.length > 0) entry.summary = parts.join(' · ')

    entries.push(entry)
  }

  if (entries.length === 0) {
    throw new Error('Steam 搜索没有解析到结果，搜索参数或页面结构可能已经改变')
  }

  return { entries, icon: `${BASE}/favicon.ico` }
}
