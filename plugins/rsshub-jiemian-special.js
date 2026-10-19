// Ported from RSSHub lib/routes/jiemian/special.ts (AGPL-3.0).
// 界面新闻 专题 — RSSHub 的 /jiemian/special/:id 路由。
//
// 专题页把文章和视频散在整页里，链接形状统一：/article/<数字>.html 或
// /video/<数字>.html，锚点文字就是标题。所以这里扫全页的锚点、按链接去重，
// 不去猜它套在哪一层 div 里 —— 那正是页面改版时最先变的东西。
//
// 列表没有时间也没有正文，打开条目时再走 preview。

export const meta = {
  id: 'rome.rsshub-jiemian-special',
  name: '界面新闻 · 专题',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: '界面新闻专题页面下的文章与视频',
  icon: 'https://www.jiemian.com/favicon.ico',
  params: {
    fields: [
      {
        key: 'id',
        type: 'text',
        label: '专题 id',
        help: '可在专题页网址 https://www.jiemian.com/special/<专题 id>.html 中找到',
        default: '',
        required: true,
      },
    ],
  },
}

const BASE = 'https://www.jiemian.com'

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
  const id = String(ctx.params.id ?? '').trim()

  if (!id) {
    throw new Error('请填写专题 id，可在专题页网址中找到')
  }

  const url = `${BASE}/special/${encodeURIComponent(id)}.html`

  ctx.log.debug(`jiemian: GET ${url}`)

  const response = await ctx.fetch(url, { headers: { accept: 'text/html' } })

  if (!response.ok) {
    throw new Error(`界面新闻返回 ${response.status} ${response.statusText}`)
  }

  const html = await response.text()
  const seen = new Set()
  const entries = []

  for (const match of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)) {
    const href = /\bhref="([^"]*)"/.exec(match[1])

    if (!href) continue

    let link

    try {
      link = new URL(decode(href[1]), BASE).href
    } catch {
      continue
    }

    if (!/\/(?:article|video)\/\w+\.html$/.test(new URL(link).pathname)) continue
    if (seen.has(link)) continue

    const title = text(match[2])

    if (!title) continue

    seen.add(link)

    entries.push({
      id: `jiemian:${new URL(link).pathname}`,
      title,
      url: link,
    })
  }

  if (entries.length === 0) {
    throw new Error(`界面新闻专题「${id}」里没有读到任何条目，页面结构可能已经变了`)
  }

  ctx.log.info(`jiemian: 专题 ${id} ${entries.length} 条`)

  return { entries }
}

export async function preview(ctx) {
  const url = ctx.item?.url

  if (!url) return null

  const content = await ctx.article(url)

  return content === null ? null : { content }
}
