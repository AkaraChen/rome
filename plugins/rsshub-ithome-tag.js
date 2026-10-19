// Ported from RSSHub lib/routes/ithome/tag.ts (AGPL-3.0).
// IT之家 标签 — RSSHub 的 /ithome/tag/:name 路由。
//
// 标签页和分类页共用同一套列表标记：<ul class="bl"> 里每条 <li> 带一个
// <div class="c" data-ot="…"> 和一个 class="title" 的标题锚点，所以解析和
// 分类资讯那条路由是同一份。

export const meta = {
  id: 'rome.rsshub-ithome-tag',
  name: 'IT之家 / iThome · 标签',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: 'IT之家某个标签下的全部文章',
  icon: 'https://www.ithome.com/favicon.ico',
  params: {
    fields: [
      {
        key: 'name',
        type: 'text',
        label: '标签名称',
        help: '可从标签页网址 https://www.ithome.com/tag/<标签> 中取得',
        default: '',
        required: true,
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

function text(html) {
  return decode(String(html ?? '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim()
}

function attr(tag, name) {
  const match = new RegExp(`\\b${name}="([^"]*)"`).exec(tag)
  return match ? decode(match[1]) : null
}

function seconds(iso) {
  if (!iso) return undefined

  const milliseconds = Date.parse(iso.replace(/(\.\d{3})\d+/, '$1'))

  return Number.isFinite(milliseconds) ? Math.floor(milliseconds / 1000) : undefined
}

export async function fetch(ctx) {
  const name = ctx.params.name

  if (!name) {
    throw new Error('请填写标签名称，例如 win11')
  }

  const url = `https://www.ithome.com/tag/${encodeURIComponent(name)}`

  ctx.log.debug(`ithome: GET ${url}`)

  const response = await ctx.fetch(url, { headers: { accept: 'text/html' } })

  if (!response.ok) {
    throw new Error(`IT之家返回 ${response.status} ${response.statusText}`)
  }

  const html = await response.text()
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

  if (entries.length === 0) {
    throw new Error(`IT之家标签「${name}」下没有读到任何条目，页面结构可能已经变了`)
  }

  ctx.log.info(`ithome: 标签 ${name} ${entries.length} 条`)

  return { entries }
}

export async function preview(ctx) {
  const url = ctx.item?.url

  if (!url) return null

  const content = await ctx.article(url)

  return content === null ? null : { content }
}
