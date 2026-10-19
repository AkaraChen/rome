// Ported from RSSHub lib/routes/infoq/presentations.ts (AGPL-3.0).
// InfoQ · Presentations — ported from RSSHub's /infoq/presentations/:conference.
//
// The list is server-rendered HTML on the English site: one <li data-path> per
// talk, all of them inside <ul data-tax="presentations">. There is no DOM in
// the runtime, so each card is scanned with the handful of markers the template
// repeats — `card__title`, `card__excerpt`, `card__date`, `card__length` — and
// the entities the site writes are decoded by hand. The card already carries the
// title, cover, excerpt, speaker and duration, so the detail page is not
// fetched; the entry links to the talk instead.

export const meta = {
  id: 'rome.rsshub-infoq-presentations',
  name: 'InfoQ · Presentations',
  version: '1.0.0',
  apiVersion: '1',
  view: 'videos',
  description: 'InfoQ 英文站演讲视频，含讲者、摘要、封面与时长',
  icon: 'https://www.infoq.com/favicon.ico',
  params: {
    fields: [
      {
        key: 'conference',
        type: 'text',
        label: '会议',
        help: '会议名，留空表示全部；可在会议页 URL 中找到，例如 https://www.infoq.com/infoq-live-jan-2024/presentations/ 中的 infoq-live-jan-2024',
        default: '',
      },
    ],
  },
}

const SITE = 'https://www.infoq.com'

const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 }

function decode(value) {
  return String(value ?? '')
    .replace(/&#x([0-9a-f]+);/gi, (match, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (match, decimal) => String.fromCodePoint(Number(decimal)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
}

/// Tags to a single line: the cards wrap their text over several source lines.
function strip(value) {
  return decode(String(value).replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim()
}

function unixFromDate(value) {
  const match = String(value || '').match(/([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})/)
  if (!match) return undefined
  const month = MONTHS[match[1].toLowerCase()]
  if (month === undefined) return undefined
  return Math.floor(Date.UTC(Number(match[3]), month, Number(match[2])) / 1000)
}

function first(block, pattern) {
  const match = block.match(pattern)
  return match ? match[1] : undefined
}

function cardEntry(block) {
  const path = first(block, /data-path="([^"]+)"/)
  if (!path) return null

  const titleBlock = first(block, /<h3 class="card__title">([\s\S]*?)<\/h3>/) ?? ''
  const title = decode(first(titleBlock, /title="([^"]*)"/) ?? strip(titleBlock))
  if (!title) return null

  const href = first(titleBlock, /href="([^"]+)"/)
  const image = first(block, /class="card__image"[^>]*src="([^"]+)"/)
  const excerpt = strip(first(block, /<p class="card__excerpt">([\s\S]*?)<\/p>/) ?? '')
  const date = first(block, /class="card__date[^"]*">[\s\S]*?<span>\s*([^<]+?)\s*<\/span>/)
  const duration = first(block, /<div class="card__length">([^<]*)<\/div>/)
  const authorsBlock = first(block, /<div class="card__authors[^"]*">([\s\S]*?)<\/div>/) ?? ''
  const authors = [...authorsBlock.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/g)].map((match) => strip(match[1])).filter(Boolean)

  const url = href ? new URL(href, SITE).href : new URL(path, SITE).href
  const id = `infoq:presentations:${path.replace(/^\//, '')}`

  const entry = {
    id,
    title,
    url,
    summary: excerpt || undefined,
    content: [
      image ? `<p><img src="${image}"></p>` : null,
      excerpt ? `<p>${excerpt.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')}</p>` : null,
      duration ? `<p>时长：${duration.replaceAll('&', '&amp;').replaceAll('<', '&lt;')}</p>` : null,
    ].filter(Boolean).join(''),
  }

  if (authors.length > 0) entry.author = authors.join('/')
  if (image) entry.image = decode(image)

  const publishedAt = unixFromDate(date)
  if (publishedAt !== undefined) entry.publishedAt = publishedAt

  return entry
}

export async function fetch(ctx) {
  const conference = String(ctx.params.conference ?? '').trim()

  if (conference !== '' && !/^[A-Za-z0-9._~-]+$/.test(conference)) {
    throw new Error('会议名只能包含字母、数字、点、下划线、波浪线和连字符')
  }

  const url = `${SITE}/${conference ? `${conference}/` : ''}presentations/`
  const response = await ctx.fetch(url, { headers: { accept: 'text/html' } })

  if (!response.ok) {
    throw new Error(`InfoQ 返回 ${response.status} ${response.statusText}`)
  }

  const html = await response.text()
  const list = html.match(/<ul[^>]*data-tax="presentations"[^>]*>([\s\S]*?)<\/ul>/)

  if (!list) {
    throw new Error('InfoQ 页面里没有找到演讲列表，页面结构可能已经变了')
  }

  const cards = list[1].split(/<li\b/).filter((block) => /data-path=/.test(block))
  const entries = cards.map(cardEntry).filter(Boolean)

  if (entries.length === 0) {
    throw new Error('InfoQ 演讲列表为空，页面结构可能已经变了')
  }

  ctx.log.info(`infoq-presentations: ${conference || 'all'} ${entries.length} 条`)

  return { entries, icon: 'https://www.infoq.com/favicon.ico' }
}
