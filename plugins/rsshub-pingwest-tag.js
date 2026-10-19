// Ported from RSSHub lib/routes/pingwest/tag.ts (AGPL-3.0).
// 品玩 — 话题动态。
//
// 话题页只用来拿话题的数字 id，真正的列表来自 /api/tag_article_list。接口返回
// 的同样是 HTML 字符串，所以按 `<article id>` 切块。type 是站点的排序参数：
// 1 最新、2 热门，接口里对应 0 和 1。

export const meta = {
  id: 'rome.rsshub-pingwest-tag',
  name: '品玩 · 话题动态',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: '抓取品玩某个话题下的文章和快讯',
  icon: 'https://www.pingwest.com/favicon.ico',
  params: {
    fields: [
      {
        key: 'tag',
        type: 'text',
        label: '话题',
        help: '话题名或话题 id，可从话题页 URL 中得到',
        default: '',
      },
      {
        key: 'type',
        type: 'select',
        label: '内容类型',
        help: '1 为最新，2 为热门',
        default: '',
        options: [
          { value: '1', label: '最新' },
          { value: '2', label: '热门' },
        ],
      },
      {
        key: 'option',
        type: 'select',
        label: '输出方式',
        help: 'fulltext 表示打开条目时抓取全文',
        default: '',
        options: [
          { value: '', label: '摘要' },
          { value: 'fulltext', label: '全文' },
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

function absolute(href) {
  if (!href) return null
  try {
    return new URL(decode(href), 'https://www.pingwest.com/').href
  } catch {
    return null
  }
}

function image(url) {
  return url ? decode(url).split('?x-', 1)[0] : undefined
}

/// 站点的日期是「2025年8月1日」，也有相对时间，两种都要认。
function chineseDate(text) {
  const value = strip(text)

  let match = /(\d{4})年(\d{1,2})月(\d{1,2})日/.exec(value)
  if (match) return Math.floor(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / 1000)

  match = /(\d{4})-(\d{1,2})-(\d{1,2})/.exec(value)
  if (match) return Math.floor(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / 1000)

  match = /(\d+)\s*(分钟|小时|天)前/.exec(value)
  if (match) {
    const unit = match[2] === '分钟' ? 60 : match[2] === '小时' ? 3600 : 86400
    return Math.floor(Date.now() / 1000) - Number(match[1]) * unit
  }

  return undefined
}

export function parseArticles(html, prefix) {
  const entries = []

  for (const match of html.matchAll(/<article id="(\d+)"[^>]*>([\s\S]*?)<\/article>/g)) {
    const block = match[2]
    const title = /<a[^>]*class="title"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(block)
      || /<a[^>]*href="([^"]+)"[^>]*class="title"[^>]*>([\s\S]*?)<\/a>/.exec(block)

    if (!title) continue

    const heading = strip(title[2])
    if (!heading) continue

    const entry = {
      id: `${prefix}:${match[1]}`,
      title: heading,
      url: absolute(title[1]),
    }

    const description = /<p class="desc">([\s\S]*?)<\/p>/.exec(block)
    if (description) {
      const summary = strip(description[1])
      if (summary) entry.summary = summary
    }

    const picture = /<section class="news-img">[\s\S]*?<img[^>]*src="([^"]+)"/.exec(block)
    if (picture) entry.image = image(picture[1])

    const date = /<span class="time">([\s\S]*?)<\/span>/.exec(block)
    if (date) {
      const publishedAt = chineseDate(date[1])
      if (publishedAt !== undefined) entry.publishedAt = publishedAt
    }

    entries.push(entry)
  }

  return entries
}

export async function fetch(ctx) {
  const tag = String(ctx.params.tag || '').trim()
  const type = String(ctx.params.type || '').trim()
  const option = String(ctx.params.option || '').trim()

  if (!tag) {
    throw new Error('请填写话题名或话题 id')
  }

  if (type !== '1' && type !== '2') {
    throw new Error('内容类型只能是 1（最新）或 2（热门）')
  }

  const tagUrl = `https://www.pingwest.com/tag/${encodeURIComponent(tag)}`

  ctx.log.debug(`pingwest: GET ${tagUrl}`)

  const tagResponse = await ctx.fetch(tagUrl, { headers: { accept: 'text/html' } })

  if (!tagResponse.ok) {
    throw new Error(`品玩话题页返回 ${tagResponse.status} ${tagResponse.statusText}`)
  }

  const tagHtml = await tagResponse.text()
  const detail = /<[^>]*class="[^"]*tag-detail[^"]*"[^>]*data-id="(\d+)"/.exec(tagHtml)
    || /<[^>]*data-id="(\d+)"[^>]*class="[^"]*tag-detail[^"]*"/.exec(tagHtml)
  const tagId = detail?.[1]

  if (!tagId) {
    throw new Error('品玩话题页没有找到话题 id，话题可能不存在')
  }

  const url = `https://www.pingwest.com/api/tag_article_list?id=${tagId}&type=${Number(type) - 1}`

  ctx.log.debug(`pingwest: GET ${url}`)

  const response = await ctx.fetch(url, { headers: { accept: 'application/json' } })

  if (!response.ok) {
    throw new Error(`品玩返回 ${response.status} ${response.statusText}`)
  }

  const body = await response.json()
  const html = body?.data?.list

  if (typeof html !== 'string' || html === '') {
    throw new Error('品玩话题接口没有返回内容，话题可能没有文章')
  }

  const entries = parseArticles(html, `pingwest-tag-${tagId}`)

  if (entries.length === 0) {
    throw new Error('品玩话题接口没有返回任何条目，页面结构可能已经变了')
  }

  for (const entry of entries) {
    entry.params = { fulltext: option === 'fulltext' }
  }

  ctx.log.info(`pingwest: 话题 ${tag} 共 ${entries.length} 条`)

  return { entries }
}

export async function preview(ctx) {
  if (!ctx.item?.params?.fulltext) return null

  const url = ctx.item?.url
  if (!url) return null

  const content = await ctx.article(url)
  return content === null ? null : { content }
}
