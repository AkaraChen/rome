// Ported from RSSHub lib/routes/stcn/index.ts (AGPL-3.0).
// 证券时报网 列表 — RSSHub 的 /stcn/article/list/:id? 路由。
//
// 分类页是服务端渲染的：<ul class="list infinite-list"> 里每条 <li> 有
// <div class="tt"> 标题锚点、<div class="text"> 摘要、<div class="tags"> 标签、
// <div class="info"> 来源与时间，右侧 <div class="side"> 是缩略图。
// 这里按 <li> 切分再逐块取，正文留给 preview。

export const meta = {
  id: 'rome.rsshub-stcn-index',
  name: '证券时报网 · 列表',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: '证券时报网各分类的文章列表',
  icon: 'https://www.stcn.com/favicon.ico',
  params: {
    fields: [
      {
        key: 'id',
        type: 'select',
        label: '分类',
        help: '分类代码，可在对应分类页网址 https://www.stcn.com/article/list/<分类>.html 中找到',
        default: 'yw',
        options: [
          { value: 'yw', label: '要闻' },
          { value: 'gs', label: '股市' },
          { value: 'company', label: '公司' },
          { value: 'fund', label: '基金' },
          { value: 'finance', label: '金融' },
          { value: 'comment', label: '评论' },
          { value: 'cj', label: '产经' },
          { value: 'kcb', label: '科创板' },
          { value: 'xsb', label: '新三板' },
          { value: 'zk', label: 'ESG' },
          { value: 'gd', label: '滚动' },
        ],
      },
    ],
  },
}

const BASE = 'https://www.stcn.com'

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

/// 列表里的时间只给到分钟，而且可能省略日期：今天的是「14:26」，
/// 今年的是「10-19 14:26」，更早的才带年份。都按东八区补全。
function seconds(value) {
  const stamp = String(value ?? '').trim()
  const now = new Date(Date.now() + 8 * 3600 * 1000)
  const pad = (part) => String(part).padStart(2, '0')
  let iso

  if (/^\d{2}:\d{2}$/.test(stamp)) {
    iso = `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())}T${stamp}:00+08:00`
  } else if (/^\d{2}-\d{2} \d{2}:\d{2}$/.test(stamp)) {
    iso = `${now.getUTCFullYear()}-${stamp.replace(' ', 'T')}:00+08:00`
  } else if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(stamp)) {
    iso = `${stamp.replace(' ', 'T')}${stamp.length === 16 ? ':00' : ''}+08:00`
  } else {
    return undefined
  }

  const milliseconds = Date.parse(iso)

  return Number.isFinite(milliseconds) ? Math.floor(milliseconds / 1000) : undefined
}

export async function fetch(ctx) {
  const id = ctx.params.id || 'yw'
  const url = `${BASE}/article/list/${encodeURIComponent(id)}.html`

  ctx.log.debug(`stcn: GET ${url}`)

  const response = await ctx.fetch(url, { headers: { accept: 'text/html' } })

  if (!response.ok) {
    throw new Error(`证券时报网返回 ${response.status} ${response.statusText}`)
  }

  const html = await response.text()
  const start = html.indexOf('infinite-list')

  if (start < 0) {
    throw new Error('证券时报网列表页里没有找到 infinite-list，页面结构可能已经变了')
  }

  const end = html.indexOf('</ul>', start)
  const section = html.slice(start, end < 0 ? undefined : end)
  const entries = []

  for (const chunk of section.split('<li').slice(1)) {
    const title = /<div class="tt">\s*<a\b([^>]*)>([\s\S]*?)<\/a>/.exec(chunk)

    if (!title) continue

    const href = /\bhref="([^"]*)"/.exec(title[1])
    const heading = text(title[2])

    if (!href || !heading) continue

    const link = new URL(decode(href[1]), BASE).href
    const excerpt = /<div class="text[^"]*">\s*<a\b[^>]*>([\s\S]*?)<\/a>/.exec(chunk)
    const info = /<div class="info[^"]*">([\s\S]*?)<\/div>/.exec(chunk)
    const image = /<div class="side">[\s\S]*?<img[^>]*\bsrc="([^"]+)"/.exec(chunk)
    const tags = /<div class="tags">([\s\S]*?)<\/div>/.exec(chunk)

    const entry = {
      id: `stcn:${new URL(link).pathname}`,
      title: heading,
      url: link,
    }

    const summary = excerpt ? text(excerpt[1]) : ''
    if (summary) entry.summary = summary

    if (info) {
      const spans = [...info[1].matchAll(/<span>([\s\S]*?)<\/span>/g)].map((span) => text(span[1]))

      if (spans.length > 0 && spans[0]) entry.author = spans[0]

      const publishedAt = seconds(spans.at(-1))
      if (publishedAt !== undefined) entry.publishedAt = publishedAt
    }

    if (tags) {
      const labels = [...tags[1].matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/g)].map((tag) => text(tag[1])).filter(Boolean)

      if (labels.length > 0) entry.summary = [summary, labels.map((label) => `#${label}`).join(' ')].filter(Boolean).join(' · ')
    }

    if (image) entry.image = decode(image[1])

    entries.push(entry)
  }

  if (entries.length === 0) {
    throw new Error(`证券时报网列表「${id}」里没有读到任何条目，页面结构可能已经变了`)
  }

  ctx.log.info(`stcn: 列表 ${id} ${entries.length} 条`)

  return { entries }
}

export async function preview(ctx) {
  const url = ctx.item?.url

  if (!url) return null

  const content = await ctx.article(url)

  return content === null ? null : { content }
}
