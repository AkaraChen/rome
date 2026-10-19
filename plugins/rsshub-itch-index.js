// Ported from RSSHub lib/routes/itch/index.ts (AGPL-3.0).
// itch.io 浏览页 — the grid ships everything the feed needs in the page itself
// (title, tagline, author, cover), so no per-game request is made. RSSHub walks
// every game page for the screenshots and the full description; that is left to
// preview.

export const meta = {
  id: 'rome.rsshub-itch-index',
  name: 'itch.io · Browse',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: 'itch.io 浏览页的游戏列表，可按分类、标签与排序筛选',
  icon: 'https://itch.io/favicon.ico',
  params: {
    fields: [
      {
        key: 'path',
        type: 'text',
        label: '路径',
        help: 'itch.io 后面的一段路径，例如 games/new-and-popular/featured 或 games/top-rated/tag-singleplayer，留空为首页',
        default: ''
      }
    ]
  }
}

const BASE = 'https://itch.io'

function decode(text) {
  const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" }
  return String(text).replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+|#39);/g, (match, entity) => {
    if (entity[0] === '#') {
      const code = entity[1] === 'x' || entity[1] === 'X'
        ? Number.parseInt(entity.slice(2), 16)
        : Number.parseInt(entity.slice(1), 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : match
    }
    return Object.prototype.hasOwnProperty.call(entities, entity) ? entities[entity] : match
  })
}

function strip(html) {
  return decode(String(html).replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim()
}

export async function fetch(ctx) {
  const path = String(ctx.params.path || '').trim().replace(/^\/+/, '').replace(/\/+$/, '')
  const url = path ? `${BASE}/${path}` : BASE
  const response = await ctx.fetch(url, { headers: { accept: 'text/html' } })

  if (!response.ok) {
    throw new Error(`itch.io 返回 ${response.status} ${response.statusText}`)
  }

  const html = await response.text()
  const entries = []
  const seen = new Set()

  // A cell opens with `<div ... class="game_cell ...">`. The delimiter has to be
  // the space (or the closing quote) after `game_cell`, because the inner
  // `game_cell_data` block holds the title but not the cover, and the order of
  // the attributes around it is not stable between grids.
  for (const block of html.split(/<div[^>]*class="game_cell[" ]/).slice(1)) {
    // The title anchor carries `class="title game_link"` but puts `href` on
    // either side of it, so the href is pulled out of the tag afterwards.
    const anchor = /<a([^>]*class="title game_link"[^>]*)>([\s\S]*?)<\/a>/.exec(block)
    if (!anchor) continue

    const href = /href="([^"]+)"/.exec(anchor[1])
    if (!href) continue

    let link
    try {
      link = new URL(decode(href[1]), BASE)
    } catch {
      continue
    }

    const slug = link.pathname.replace(/^\/+/, '')
    if (!slug || seen.has(slug)) continue
    seen.add(slug)

    const entry = {
      id: `itch:game:${slug}`,
      title: strip(anchor[2]) || slug,
      url: link.href
    }

    const tagline = /class="game_text"[^>]*>([\s\S]*?)<\/div>/.exec(block)
    if (tagline) {
      const summary = strip(tagline[1])
      if (summary) {
        entry.summary = summary
      }
    }

    const author = /class="game_author"[^>]*>\s*<a[^>]*>([\s\S]*?)<\/a>/.exec(block)
    if (author) {
      const name = strip(author[1])
      if (name) {
        entry.author = name
      }
    }

    const cover = /class="lazy_loaded"[^>]*data-lazy_src="([^"]+)"/.exec(block) || /class="lazy_loaded"[^>]*src="([^"]+)"/.exec(block)
    if (cover) {
      entry.image = decode(cover[1])
    }

    entries.push(entry)
  }

  if (entries.length === 0) {
    throw new Error(`itch.io 页面 ${url} 没有找到游戏，请检查路径是否正确`)
  }

  return { entries }
}

export async function preview(ctx) {
  const url = ctx.item?.url
  if (!url) return null
  const content = await ctx.article(url)
  return content === null ? null : { content }
}
