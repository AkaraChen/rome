// Ported from RSSHub lib/routes/ithome/index.ts (AGPL-3.0).
// IT之家 分类资讯 — RSSHub 的 /ithome/:caty 路由。
//
// 运行时没有 DOM，所以列表靠字符串切分和正则读出来。各分类子站的列表形状
// 是一致的：每条是一个 <li>，正文块 <div class="c" data-ot="…"> 带 ISO 时间，
// 标题锚点带 class="title"，摘要放在 <div class="m"> 里。
//
// 列表本身没有正文，打开条目时再走 preview，用宿主的正文提取器读那一页。

export const meta = {
  id: 'rome.rsshub-ithome-index',
  name: 'IT之家 / iThome · 分类资讯',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: 'IT之家各分类子站的最新资讯列表',
  icon: 'https://www.ithome.com/favicon.ico',
  params: {
    fields: [
      {
        key: 'caty',
        type: 'select',
        label: '类别',
        help: '分类子站，对应网址 https://<类别>.ithome.com/',
        default: '',
        required: true,
        options: [
          { value: 'it', label: 'IT 资讯' },
          { value: 'soft', label: '软件之家' },
          { value: 'win10', label: 'win10 之家' },
          { value: 'win11', label: 'win11 之家' },
          { value: 'iphone', label: 'iphone 之家' },
          { value: 'ipad', label: 'ipad 之家' },
          { value: 'android', label: 'android 之家' },
          { value: 'digi', label: '数码之家' },
          { value: 'next', label: '智能时代' },
        ],
      },
    ],
  },
}

// 站点自己的类别代码，和它的子域名一一对应。
const CATEGORIES = ['it', 'soft', 'win10', 'win11', 'iphone', 'ipad', 'android', 'digi', 'next']

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

function attr(tag, name) {
  const match = new RegExp(`\\b${name}="([^"]*)"`).exec(tag)
  return match ? decode(match[1]) : null
}

/// IT之家把秒写成 7 位小数（…46.8130000+08:00），Date.parse 读不了，先削到 3 位。
function seconds(iso) {
  if (!iso) return undefined

  const milliseconds = Date.parse(iso.replace(/(\.\d{3})\d+/, '$1'))

  return Number.isFinite(milliseconds) ? Math.floor(milliseconds / 1000) : undefined
}

function parseList(html) {
  const entries = []

  for (const chunk of html.split('<li>').slice(1)) {
    const title = /<a\b([^>]*\bclass="title"[^>]*)>([\s\S]*?)<\/a>/.exec(chunk)

    if (!title) continue

    const href = attr(title[1], 'href')
    const heading = text(title[2])

    if (!href || !heading) continue

    const date = /data-ot="([^"]+)"/.exec(chunk)
    const excerpt = /<div class="m">([\s\S]*?)<\/div>/.exec(chunk)
    const image = /<img[^>]*data-original="([^"]+)"/.exec(chunk)

    const entry = {
      // 文章地址里的路径就是它永久的 id，标题改了也不变。
      id: `ithome:${new URL(href).pathname}`,
      title: heading,
      url: href,
    }

    const summary = excerpt ? text(excerpt[1]) : ''
    if (summary) entry.summary = summary

    const publishedAt = seconds(date ? date[1] : null)
    if (publishedAt !== undefined) entry.publishedAt = publishedAt

    if (image) entry.image = decode(image[1])

    entries.push(entry)
  }

  return entries
}

export async function fetch(ctx) {
  const category = ctx.params.caty

  if (!category) {
    throw new Error('请填写类别，例如 it、win11 或 digi')
  }

  if (!CATEGORIES.includes(category)) {
    throw new Error(`不认识的类别「${category}」，可选：${CATEGORIES.join('、')}`)
  }

  const url = `https://${category}.ithome.com/`

  ctx.log.debug(`ithome: GET ${url}`)

  const response = await ctx.fetch(url, { headers: { accept: 'text/html' } })

  if (!response.ok) {
    throw new Error(`IT之家返回 ${response.status} ${response.statusText}`)
  }

  const entries = parseList(await response.text())

  if (entries.length === 0) {
    throw new Error('IT之家列表里没有读到任何条目，页面结构可能已经变了')
  }

  ctx.log.info(`ithome: ${category} ${entries.length} 条`)

  return { entries }
}

/// 条目自己的页面，交给宿主的正文提取器。
export async function preview(ctx) {
  const url = ctx.item?.url

  if (!url) return null

  const content = await ctx.article(url)

  return content === null ? null : { content }
}
