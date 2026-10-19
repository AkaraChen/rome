// Ported from RSSHub lib/routes/pingwest/status.ts (AGPL-3.0).
// 品玩 — 实时要闻。
//
// 接口 /api/state/list 返回的是一段 HTML 字符串而不是 JSON 结构，所以这里按
// 站点自己的 `<section data-id data-t>` 标记切块。data-t 是发布时间戳，
// data-id 是文章 id，两者都比标题稳定。

export const meta = {
  id: 'rome.rsshub-pingwest-status',
  name: '品玩 · 实时要闻',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: '抓取品玩的实时要闻',
  icon: 'https://www.pingwest.com/favicon.ico',
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

function absolute(href) {
  if (!href) return null
  try {
    return new URL(decode(href), 'https://www.pingwest.com/').href
  } catch {
    return null
  }
}

/// 站点的缩略图带 `?x-oss-process=` 参数，去掉才是原图。
function image(url) {
  return url ? decode(url).split('?x-', 1)[0] : undefined
}

export async function fetch(ctx) {
  const url = 'https://www.pingwest.com/api/state/list?page=1'

  ctx.log.debug(`pingwest: GET ${url}`)

  const response = await ctx.fetch(url, { headers: { accept: 'application/json' } })

  if (!response.ok) {
    throw new Error(`品玩返回 ${response.status} ${response.statusText}`)
  }

  const body = await response.json()
  const html = body?.data?.list

  if (typeof html !== 'string') {
    throw new Error('品玩接口没有返回列表 HTML，接口可能已经变了')
  }

  const starts = [...html.matchAll(/<section\b[^>]*\bdata-id="(\d+)"[^>]*\bdata-t="(\d+)"[^>]*>/g)]
  const entries = []

  for (const [index, match] of starts.entries()) {
    const id = match[1]
    const block = html.slice(match.index + match[0].length, starts[index + 1]?.index ?? html.length)
    const title = /<p class="title">[\s\S]*?<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(block)
    const tag = /<a[^>]*class="tag"[^>]*>[\s\S]*?<span>([\s\S]*?)<\/span>/.exec(block)
    const heading = title ? strip(title[2]) : strip(tag?.[1] ?? '')

    if (!heading) continue

    const entry = {
      id: `pingwest:${id}`,
      title: heading,
      url: title ? absolute(title[1]) : null,
      summary: strip(tag?.[1] ?? ''),
    }

    const description = /<p class="description">([\s\S]*?)<\/p>/.exec(block)
    if (description) {
      const text = strip(description[1])
      if (text) entry.summary = entry.summary ? `${entry.summary} · ${text}` : text
    }

    const picture = /<section class="news-img">[\s\S]*?<img[^>]*src="([^"]+)"/.exec(block)
    if (picture) entry.image = image(picture[1])

    const publishedAt = Number(match[2])
    if (Number.isFinite(publishedAt) && publishedAt > 0) entry.publishedAt = publishedAt

    entries.push(entry)
  }

  if (entries.length === 0) {
    throw new Error('品玩接口没有返回任何要闻，页面结构可能已经变了')
  }

  ctx.log.info(`pingwest: ${entries.length} 条要闻`)

  return { entries }
}

export async function preview(ctx) {
  const url = ctx.item?.url
  if (!url) return null

  const content = await ctx.article(url)
  return content === null ? null : { content }
}
