// Ported from RSSHub lib/routes/zcool/top.ts (AGPL-3.0).
// 站酷 作品总榜单 — RSSHub 的 /zcool/top/:type 路由。
//
// 榜单页是服务端渲染的：每张卡片先是一个 rankingCover 封面锚点，紧接着
// rankingInfo 里的 rankingTitleLink 标题锚点，作者在同卡片的 rankingAuthorLink
// 上。两类锚点一一对应、顺序一致，所以按顺序配对即可，不必真的建 DOM。
//
// 列表里没有时间，正文留给 preview。

export const meta = {
  id: 'rome.rsshub-zcool-top',
  name: '站酷 · 作品总榜单',
  version: '1.0.0',
  apiVersion: '1',
  view: 'pictures',
  description: '站酷的作品榜与文章榜',
  icon: 'https://www.zcool.com.cn/favicon.ico',
  params: {
    fields: [
      {
        key: 'type',
        type: 'select',
        label: '推荐类型',
        help: '榜单的种类',
        default: '',
        required: true,
        options: [
          { value: 'design', label: '作品榜单' },
          { value: 'article', label: '文章榜单' },
        ],
      },
    ],
  },
}

const BASE = 'https://www.zcool.com.cn'

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

function attribute(tag, name) {
  const match = new RegExp(`\\b${name}="([^"]*)"`).exec(tag)
  return match ? decode(match[1]) : null
}

export async function fetch(ctx) {
  const type = ctx.params.type

  if (!type) {
    throw new Error('请填写推荐类型：design（作品榜）或 article（文章榜）')
  }

  if (type !== 'design' && type !== 'article') {
    throw new Error(`不认识的推荐类型「${type}」，可选：design、article`)
  }

  const url = type === 'design' ? `${BASE}/top/index.do` : `${BASE}/top/article.do?rankType=8`

  ctx.log.debug(`zcool: GET ${url}`)

  const response = await ctx.fetch(url, { headers: { accept: 'text/html' } })

  if (!response.ok) {
    throw new Error(`站酷返回 ${response.status} ${response.statusText}`)
  }

  const html = await response.text()
  // 类名是 …__rankingCover，下划线是词字符，所以这里不能写 \b。
  const covers = [...html.matchAll(/<a\b([^>]*rankingCover[^>]*)>([\s\S]*?)<\/a>/g)]
  const titles = [...html.matchAll(/<a\b([^>]*rankingTitleLink[^>]*)>([\s\S]*?)<\/a>/g)]
  const entries = []

  for (const [index, match] of titles.entries()) {
    const href = attribute(match[1], 'href')

    if (!href) continue

    const title = attribute(match[1], 'title') || text(match[2])

    if (!title) continue

    // 作者锚点在标题之后、同一张卡片之内，取一小段窗口就够。
    const window = html.slice(match.index, match.index + 4000)
    const author = /class="[^"]*rankingAuthorLink"[^>]*\btitle="([^"]*)"/.exec(window)

    const entry = {
      id: `zcool:${new URL(href).pathname}`,
      title,
      url: href,
    }

    if (author) entry.author = decode(author[1])

    const cover = covers[index]
    const image = cover ? /<img[^>]*\bsrc="([^"]+)"/.exec(cover[2]) : null

    if (image) entry.image = decode(image[1])

    entries.push(entry)
  }

  if (entries.length === 0) {
    throw new Error('站酷榜单里没有读到任何条目，页面结构可能已经变了')
  }

  ctx.log.info(`zcool: 榜单 ${type} ${entries.length} 条`)

  return { entries }
}

export async function preview(ctx) {
  const url = ctx.item?.url

  if (!url) return null

  const content = await ctx.article(url)

  return content === null ? null : { content }
}
