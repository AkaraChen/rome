// Ported from RSSHub lib/routes/logonews/work.ts (AGPL-3.0).
// 标志情报局作品 — the work listing uses a different card: an <li> with the
// title in <h2> and the cover as a CSS background. There is no date on this
// page, so entries sort by when Rome first sees them.

export const meta = {
  id: 'rome.rsshub-logonews-work',
  name: 'LogoNews 标志情报局 · 作品',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: '标志情报局最新收录的标志设计作品',
  icon: 'https://www.logonews.cn/favicon.ico',
}

const ROOT = 'https://www.logonews.cn'

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

async function page(ctx, url) {
  let response = await ctx.fetch(url, { headers: { accept: 'text/html' } })

  if (!response.ok) {
    const body = await response.text()

    if (response.status === 403 && body.includes('window.location.href')) {
      response = await ctx.fetch(url, { headers: { accept: 'text/html' } })
    } else if (response.status === 403) {
      throw new Error('标志情报局拒绝了请求，站点可能需要浏览器验证')
    }
  }

  if (!response.ok) {
    throw new Error(`标志情报局返回 ${response.status} ${response.statusText}`)
  }

  return response.text()
}

function covers(block) {
  const style = /background-image:\s*url\((['"]?)([^)'"]+)\1\)/.exec(block)?.[2]
  if (style && !style.startsWith('data:')) return absolute(style)

  for (const match of block.matchAll(/<img\b[^>]*>/g)) {
    const src = /(?:src|data-src)="([^"]+)"/.exec(match[0])?.[1]
    if (src && !src.startsWith('data:')) return absolute(src)
  }

  return undefined
}

export async function fetch(ctx) {
  const url = `${ROOT}/work`
  ctx.log.debug(`logonews-work: GET ${url}`)

  const html = await page(ctx, url)
  const entries = []
  const seen = new Set()

  for (const block of html.split('<li>').slice(1)) {
    const heading = /<h2[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(block)
    if (!heading) continue

    const href = absolute(heading[1])
    const title = plain(heading[2])
    if (!href || !title || seen.has(href)) continue
    seen.add(href)

    let path = href
    try {
      path = new URL(href).pathname
    } catch {
      // Keep the absolute URL when the href is unusual.
    }

    const entry = {
      id: `logonews:work:${path}`,
      title,
      url: href,
    }

    const image = covers(block)
    if (image) entry.image = image

    const category = /<p class="category">[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/.exec(block)?.[1]
    if (category) entry.summary = plain(category)

    entries.push(entry)
  }

  if (entries.length === 0) {
    throw new Error('标志情报局作品页没有解析出作品，页面结构可能已经变了')
  }

  ctx.log.info(`logonews-work: ${entries.length} 件作品`)

  return { entries, icon: 'https://www.logonews.cn/favicon.ico' }
}

export async function preview(ctx) {
  const url = ctx.item?.url
  if (!url) return null

  const content = await ctx.article(url)
  return content === null ? null : { content }
}
