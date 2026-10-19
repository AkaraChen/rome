// Ported from RSSHub lib/routes/cctv/category.ts (AGPL-3.0).
// 央视新闻分类 — the news site publishes each category as a JSONP list. The
// payload is JSON once the function wrapper is stripped. The article body is
// read by preview, not by fetch.

export const meta = {
  id: 'rome.rsshub-cctv-category',
  name: '央视新闻 · 专题',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: '央视新闻各专题分类的最新报道',
  icon: 'https://news.cctv.com/favicon.ico',
  params: {
    fields: [
      {
        key: 'category',
        type: 'text',
        label: '分类名',
        help: '可在对应分类页 URL 中找到，例如 news、china、world、society、law、ent、tech、life、edu',
        default: '',
      },
    ],
  },
}

const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  ndash: '–', mdash: '—', hellip: '…', lsquo: '‘', rsquo: '’',
  ldquo: '“', rdquo: '”', middot: '·',
}

function decode(text) {
  return String(text).replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (match, entity) => {
    if (entity[0] === '#') {
      const code = entity[1] === 'x' || entity[1] === 'X'
        ? Number.parseInt(entity.slice(2), 16)
        : Number.parseInt(entity.slice(1), 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : match
    }
    return Object.prototype.hasOwnProperty.call(ENTITIES, entity) ? ENTITIES[entity] : match
  })
}

function plain(html) {
  return decode(String(html ?? '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim()
}

// Focus dates are printed in China Standard Time without a zone.
function seconds(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(String(value ?? ''))
  if (!match) return undefined

  const milliseconds = Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]) - 8,
    Number(match[5]),
    Number(match[6] || 0),
  )

  return Number.isFinite(milliseconds) ? Math.floor(milliseconds / 1000) : undefined
}

function articleId(url) {
  const name = String(url ?? '').split('/').pop() || ''
  return name.replace(/\.s?html?$/, '')
}

export async function fetch(ctx) {
  const category = String(ctx.params.category ?? '').trim()

  if (!category) {
    throw new Error('缺少分类名：可在对应分类页 URL 中找到，例如 world')
  }

  const url = `https://news.cctv.com/2019/07/gaiban/cmsdatainterface/page/${encodeURIComponent(category)}_1.jsonp`
  ctx.log.debug(`cctv-category: GET ${url}`)

  const response = await ctx.fetch(url, {
    headers: { accept: 'application/javascript, text/html', referer: `https://news.cctv.com/${category}` },
  })

  if (!response.ok) {
    throw new Error(`央视新闻返回 ${response.status} ${response.statusText}`)
  }

  const text = await response.text()
  const open = text.indexOf('(')
  const close = text.lastIndexOf(')')

  if (open < 0 || close <= open) {
    throw new Error('央视新闻没有返回 JSONP 数据，接口可能已经变了')
  }

  let body
  try {
    body = JSON.parse(text.slice(open + 1, close))
  } catch {
    throw new Error('央视新闻的 JSONP 数据无法解析，接口可能已经变了')
  }

  const list = body?.data?.list

  if (!Array.isArray(list)) {
    throw new Error('央视新闻没有返回新闻列表，接口可能已经变了')
  }

  const entries = list.map((item) => {
    const entry = {
      // The article's file name is its own id and never changes.
      id: `cctv:${articleId(item.url) || item.url}`,
      title: item.title,
      url: item.url,
      summary: plain(item.brief),
    }

    if (item.image) entry.image = item.image

    const publishedAt = seconds(item.focus_date)
    if (publishedAt !== undefined) entry.publishedAt = publishedAt

    return entry
  }).filter((entry) => entry.title && entry.url)

  if (entries.length === 0) {
    throw new Error('央视新闻没有返回可解析的条目，接口可能已经变了')
  }

  ctx.log.info(`cctv-category: ${category} ${entries.length} 条`)

  return { entries, icon: 'https://news.cctv.com/favicon.ico' }
}

export async function preview(ctx) {
  const url = ctx.item?.url
  if (!url) return null

  const content = await ctx.article(url)
  return content === null ? null : { content }
}
