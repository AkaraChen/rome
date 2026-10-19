// Ported from RSSHub lib/routes/cctv/xwlb.ts (AGPL-3.0).
// 新闻联播 — the column page carries only the newest broadcast; the older ones
// live on one static page per day, so the listing is assembled from the last
// ten days rather than from a feed.

export const meta = {
  id: 'rome.rsshub-cctv-xwlb',
  name: '央视新闻 · 新闻联播',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: '新闻联播的每日节目单',
  icon: 'https://tv.cctv.com/favicon.ico',
  params: {
    fields: [
      {
        key: 'site',
        type: 'text',
        label: '站点',
        help: '上游只支持 tv（央视节目）',
        default: 'tv',
      },
      {
        key: 'category',
        type: 'text',
        label: '分类',
        help: '上游只支持 lm（栏目大全）',
        default: 'lm',
      },
      {
        key: 'name',
        type: 'text',
        label: '栏目',
        help: '上游只支持 xwlb（新闻联播）',
        default: 'xwlb',
      },
    ],
  },
}

const DAYS = 10
const PER_DAY = 30

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

function stamp(date) {
  const match = /^(\d{4})(\d{2})(\d{2})$/.exec(date)
  if (!match) return undefined

  // 新闻联播 goes out at 19:00 China Standard Time.
  return Math.floor(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 11, 0) / 1000)
}

function shift(date, days) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!match) return ''

  const shifted = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) - days * 86400000)
  return shifted.toISOString().slice(0, 10)
}

// A day page lists that evening's segments, each anchor carrying its own
// title. Anchors without a video path are navigation and are dropped.
function segments(html) {
  const found = []
  const seen = new Set()

  for (const match of html.matchAll(/<a\b[^>]*>/gi)) {
    const tag = match[0]
    const href = /href="([^"]+)"/i.exec(tag)?.[1]
    const title = plain(/title="([^"]*)"/i.exec(tag)?.[1])

    if (!href || !title) continue
    if (!/\/VIDE/i.test(href) || seen.has(href)) continue

    seen.add(href)
    found.push({ href, title })

    if (found.length >= PER_DAY) break
  }

  return found
}

export async function fetch(ctx) {
  const site = String(ctx.params.site ?? '').trim() || 'tv'
  const category = String(ctx.params.category ?? '').trim() || 'lm'
  const name = String(ctx.params.name ?? '').trim() || 'xwlb'

  // 上游 handler 对这三个路径参数做同样的校验：只有新闻联播被实现。
  if (site !== 'tv' || category !== 'lm' || name !== 'xwlb') {
    throw new Error('目前只支持 tv/lm/xwlb（新闻联播），其他央视栏目还没有移植')
  }

  const column = `https://${site}.cctv.com/${category}/${name}/`

  ctx.log.debug(`cctv-xwlb: GET ${column}`)

  const response = await ctx.fetch(column, { headers: { accept: 'text/html' } })

  if (!response.ok) {
    throw new Error(`央视新闻返回 ${response.status} ${response.statusText}`)
  }

  const html = await response.text()
  const latest = /<div class="rilititle"><p>(\d{4}-\d{2}-\d{2})/.exec(html)?.[1]

  if (!latest) {
    throw new Error('新闻联播栏目页没有找到最新日期，页面结构可能已经变了')
  }

  const entries = []

  for (let offset = 0; offset < DAYS; offset += 1) {
    const day = shift(latest, offset)
    if (!day) continue

    const url = `${column}day/${day.replace(/-/g, '')}.shtml`
    const page = await ctx.fetch(url, { headers: { accept: 'text/html' } })

    // Older day pages are pruned; a missing one is not an error.
    if (!page.ok) {
      ctx.log.debug(`cctv-xwlb: ${day} 返回 ${page.status}，跳过`)
      continue
    }

    const items = segments(await page.text())
    if (items.length === 0) continue

    const entry = {
      id: `cctv:xwlb:${day.replace(/-/g, '')}`,
      title: `新闻联播 ${day.replace(/-/g, '/')}`,
      url,
      content: `<ul>${items.map((item) => `<li><a href="${item.href}">${item.title}</a></li>`).join('')}</ul>`,
    }

    const publishedAt = stamp(day.replace(/-/g, ''))
    if (publishedAt !== undefined) entry.publishedAt = publishedAt

    entries.push(entry)
  }

  if (entries.length === 0) {
    throw new Error('新闻联播没有取到任何一天的节目单，页面结构可能已经变了')
  }

  ctx.log.info(`cctv-xwlb: ${entries.length} 天`)

  return { entries, icon: 'https://tv.cctv.com/favicon.ico' }
}
