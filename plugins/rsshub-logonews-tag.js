// Ported from RSSHub lib/routes/logonews/tag.ts (AGPL-3.0).
// 标志情报局标签页 — same card markup as the home page, under /tag/<tag>.

export const meta = {
  id: 'rome.rsshub-logonews-tag',
  name: 'LogoNews 标志情报局 · 文章标签',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: '标志情报局指定标签下的最新文章',
  icon: 'https://www.logonews.cn/favicon.ico',
  params: {
    fields: [
      {
        key: 'tag',
        type: 'text',
        label: '标签',
        help: '可在对应标签页 URL 中找到，例如 china',
        default: '',
      },
    ],
  },
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

function chinaSeconds(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(String(value ?? ''))
  if (!match) return undefined

  const milliseconds = Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4] || 0) - 8,
    Number(match[5] || 0),
    Number(match[6] || 0),
  )

  return Number.isFinite(milliseconds) ? Math.floor(milliseconds / 1000) : undefined
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

function cards(html) {
  const entries = []

  for (const block of html.split('<div class="article-item-card').slice(1)) {
    const anchorTag = /<a\b[^>]*class="[^"]*article-link[^"]*"[^>]*>/.exec(block)?.[0]
    if (!anchorTag) continue

    const href = absolute(/href="([^"]+)"/.exec(anchorTag)?.[1])
    if (!href) continue

    const labelled = /aria-label="阅读文章：([^"]*)"/.exec(anchorTag)?.[1]
    const heading = /<h3[^>]*>([\s\S]*?)<\/h3>/.exec(block)?.[1]
    const title = plain(labelled || heading)
    if (!title) continue

    let path = href
    try {
      path = new URL(href).pathname
    } catch {
      // Keep the absolute URL when the href is unusual.
    }

    const entry = {
      id: `logonews:${path}`,
      title,
      url: href,
    }

    const time = /<time[^>]*datetime="([^"]+)"/.exec(block)?.[1]
    const publishedAt = chinaSeconds(time)
    if (publishedAt !== undefined) entry.publishedAt = publishedAt

    for (const match of block.matchAll(/<img\b[^>]*>/g)) {
      const src = /(?:src|data-src)="([^"]+)"/.exec(match[0])?.[1]
      if (src && src.includes('imgs.logonews.cn')) {
        entry.image = absolute(src) || undefined
        break
      }
    }

    entries.push(entry)
  }

  return entries
}

export async function fetch(ctx) {
  const tag = String(ctx.params.tag ?? '').trim()

  if (!tag) {
    throw new Error('缺少标签：请在对应标签页 URL 中找到，例如 china')
  }

  const url = `${ROOT}/tag/${encodeURIComponent(tag)}`
  ctx.log.debug(`logonews-tag: GET ${url}`)

  const html = await page(ctx, url)
  const entries = cards(html)

  if (entries.length === 0) {
    throw new Error('标志情报局标签页没有解析出文章，页面结构可能已经变了')
  }

  ctx.log.info(`logonews-tag: ${tag} ${entries.length} 篇`)

  return { entries, icon: 'https://www.logonews.cn/favicon.ico' }
}

export async function preview(ctx) {
  const url = ctx.item?.url
  if (!url) return null

  const content = await ctx.article(url)
  return content === null ? null : { content }
}
