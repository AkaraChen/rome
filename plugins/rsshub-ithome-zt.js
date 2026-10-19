// Ported from RSSHub lib/routes/ithome/zt.tsx (AGPL-3.0).
// IT之家 专题 — RSSHub 的 /ithome/zt/:id? 路由。
//
// 专题页把每篇文章放进 <div class="newsbody">：一个带 href 的锚点包着 <h2>
// 标题，后面跟着摘要 <p class="hidden-xs"> 和作者 <div class="editor">。缩略图
// 在同一个 <li> 里、newsbody 之前，所以按 <li> 切分再取。

export const meta = {
  id: 'rome.rsshub-ithome-zt',
  name: 'IT之家 / iThome · 专题',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: 'IT之家专题页面下的文章列表',
  icon: 'https://www.ithome.com/favicon.ico',
  params: {
    fields: [
      {
        key: 'id',
        type: 'text',
        label: '专题 id',
        help: '可在专题页网址 https://www.ithome.com/zt/<专题 id> 中找到，默认 xijiayi（喜加一）',
        default: 'xijiayi',
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

/// 发布时间不在标签里，而是一段 jsDateDiff('2026/10/15 23:00:33') 的脚本，
/// 按站点的 +08:00 换算。
function seconds(input) {
  const match = /(\d{4})\/(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2}):(\d{2})/.exec(String(input ?? ''))

  if (!match) return undefined

  const [, year, month, day, hour, minute, second] = match
  const at = Date.parse(
    `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T${hour.padStart(2, '0')}:${minute}:${second}+08:00`,
  )

  return Number.isFinite(at) ? Math.floor(at / 1000) : undefined
}

export async function fetch(ctx) {
  const id = ctx.params.id || 'xijiayi'
  const url = `https://www.ithome.com/zt/${encodeURIComponent(id)}`

  ctx.log.debug(`ithome: GET ${url}`)

  const response = await ctx.fetch(url, { headers: { accept: 'text/html' } })

  if (!response.ok) {
    throw new Error(`IT之家返回 ${response.status} ${response.statusText}`)
  }

  const html = await response.text()
  const entries = []

  for (const chunk of html.split('<li>').slice(1)) {
    if (!chunk.includes('newsbody')) continue

    const heading = /<a\b([^>]*)>\s*<h2>([\s\S]*?)<\/h2>/.exec(chunk)

    if (!heading) continue

    const href = /\bhref="([^"]*)"/.exec(heading[1])
    const title = text(heading[2])

    if (!href || !title) continue

    const link = decode(href[1])
    const excerpt = /<p class="hidden-xs">([\s\S]*?)<\/p>/.exec(chunk)
    const editor = /<div class="editor">([\s\S]*?)<span/.exec(chunk)
    const image = /<img[^>]*data-original="([^"]+)"/.exec(chunk)

    const entry = {
      id: `ithome:${new URL(link).pathname}`,
      title,
      url: link,
    }

    const summary = excerpt ? text(excerpt[1]) : ''
    if (summary) entry.summary = summary

    const author = editor ? text(editor[1]) : ''
    if (author) entry.author = author

    if (image) entry.image = decode(image[1])

    const publishedAt = seconds(/jsDateDiff\('([^']+)'\)/.exec(chunk)?.[1])

    if (publishedAt !== undefined) entry.publishedAt = publishedAt

    entries.push(entry)
  }

  if (entries.length === 0) {
    throw new Error(`IT之家专题「${id}」里没有读到任何条目，页面结构可能已经变了`)
  }

  ctx.log.info(`ithome: 专题 ${id} ${entries.length} 条`)

  return { entries }
}

export async function preview(ctx) {
  const url = ctx.item?.url

  if (!url) return null

  const content = await ctx.article(url)

  return content === null ? null : { content }
}
