// Ported from RSSHub lib/routes/fashionnetwork/index.ts (AGPL-3.0).
// FashionNetwork 中国 — the category listing is server-rendered, and every
// card carries its title, link and cover. The article body is read only when
// the reader opens an entry.
//
// The international `.com` editions answer this network with a Cloudflare
// block, so this port covers the reachable Chinese edition.

export const meta = {
  id: 'rome.rsshub-fashionnetwork-index',
  name: 'FashionNetwork · FashionNetwork 中国',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: '时尚商业网分类页的最新文章',
  icon: 'https://www.fashionnetwork.cn/favicon.ico',
  params: {
    fields: [
      {
        key: 'id',
        type: 'text',
        label: '分类 ID',
        help: '可在对应分类页 URL 中找到，默认为 0',
        default: '0',
      },
    ],
  },
}

const ROOT = 'https://www.fashionnetwork.cn'

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

function absolute(href) {
  try {
    return new URL(decode(href), `${ROOT}/`).href
  } catch {
    return null
  }
}

function cover(block) {
  for (const match of block.matchAll(/<img\b[^>]*>/g)) {
    const tag = match[0]
    const src = /(?:src|data-src)="([^"]+)"/.exec(tag)?.[1]
    if (src && !src.startsWith('data:')) return absolute(src)
  }
  return undefined
}

export async function fetch(ctx) {
  const id = String(ctx.params.id ?? '').trim() || '0'
  const url = `${ROOT}/lists/${encodeURIComponent(id)}`

  ctx.log.debug(`fashionnetwork-index: GET ${url}`)

  const response = await ctx.fetch(url, { headers: { accept: 'text/html' } })

  if (!response.ok) {
    throw new Error(`时尚商业网返回 ${response.status} ${response.statusText}`)
  }

  const html = await response.text()
  const entries = []
  const seen = new Set()

  // Each card starts with this exact opening tag; splitting instead of
  // matching keeps the nested divs from swallowing the next card.
  for (const block of html.split('<div class="home__item">').slice(1)) {
    const heading = /<h2 class="family-title[^"]*">\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(block)

    if (!heading) continue

    const href = absolute(heading[1])
    const title = plain(heading[2])

    if (!href || !title || seen.has(href)) continue
    seen.add(href)

    let path = href
    try {
      path = new URL(href).pathname
    } catch {
      // Fall back to the absolute URL when the href is unusual.
    }

    const entry = {
      id: `fashionnetwork:${path}`,
      title,
      url: href,
    }

    const image = cover(block)
    if (image) entry.image = image

    entries.push(entry)
  }

  if (entries.length === 0) {
    throw new Error('时尚商业网列表没有解析出文章，页面结构可能已经变了')
  }

  ctx.log.info(`fashionnetwork-index: ${id} ${entries.length} 篇`)

  return { entries, icon: 'https://www.fashionnetwork.cn/favicon.ico' }
}

export async function preview(ctx) {
  const url = ctx.item?.url
  if (!url) return null

  const content = await ctx.article(url)
  return content === null ? null : { content }
}
