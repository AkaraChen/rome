// Ported from RSSHub lib/routes/bbc/learningenglish.ts (AGPL-3.0).
// BBC Learning English 中文网 — one column of the Chinese learning site.
//
// The page is server-rendered: a featured item sits in the widget with
// data-widget-index="4", and the rest are <li> rows inside <ul class="threecol">.
// Both carry an <h2><a href> title and a "DD Mon YYYY" date in the details line.

export const meta = {
  id: 'rome.rsshub-bbc-learningenglish',
  name: 'BBC · Learning English',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: 'BBC 英语学习中文网的栏目更新',
  icon: 'https://www.bbc.co.uk/favicon.ico',
  params: {
    fields: [
      {
        key: 'channel',
        type: 'select',
        label: '英语学习分类栏目',
        help: '选择要订阅的 BBC 英语学习栏目。',
        default: 'take-away-english',
        options: [
          { value: 'take-away-english', label: '随身英语' },
          { value: 'authentic-real-english', label: '地道英语' },
          { value: 'media-english', label: '媒体英语' },
          { value: 'lingohack', label: '英语大破解' },
          { value: 'english-in-a-minute', label: '一分钟英语' },
          { value: 'phrasal-verbs', label: '短语动词' },
          { value: 'todays-phrase', label: '今日短语' },
          { value: 'q-and-a', label: '你问我答' },
          { value: 'english-at-work', label: '白领英语' },
          { value: 'storytellers', label: '亲子英语故事' }
        ]
      }
    ]
  }
}

const BASE = 'https://www.bbc.co.uk'
const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 }

function decode(text) {
  const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }
  return String(text).replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity) => {
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

// "19 Oct 2026" — the day the episode page was published, in UTC.
function dateSeconds(text) {
  const match = /(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})/.exec(String(text))
  if (!match) return undefined
  const month = MONTHS[match[2].toLowerCase()]
  if (month === undefined) return undefined
  return Math.floor(Date.UTC(Number(match[3]), month, Number(match[1])) / 1000)
}

function episodeId(href) {
  const path = String(href).split('?')[0].replace(/\/$/, '')
  return path.slice(path.lastIndexOf('/') + 1) || path
}

function toEntry(block, seen) {
  const link = /<h2[^>]*>\s*<a href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(block)
  if (!link) return null

  const path = episodeId(link[1])
  if (!path || seen.has(path)) return null
  seen.add(path)

  const entry = {
    id: `bbc:le:${path}`,
    title: strip(link[2]) || path,
    url: new URL(link[1], BASE).href
  }

  const details = /<div class="details">([\s\S]*?)<\/div>/.exec(block)
  const publishedAt = dateSeconds(details ? details[1] : '')

  if (publishedAt !== undefined) {
    entry.publishedAt = publishedAt
  }

  return entry
}

export async function fetch(ctx) {
  const channel = String(ctx.params.channel || '').trim() || 'take-away-english'
  const url = `${BASE}/learningenglish/chinese/features/${channel}`
  const response = await ctx.fetch(url, { headers: { accept: 'text/html' } })

  if (!response.ok) {
    throw new Error(`BBC 英语学习返回 ${response.status} ${response.statusText}`)
  }

  const html = await response.text()
  const entries = []
  const seen = new Set()

  const featuredStart = html.indexOf('data-widget-index="4"')

  if (featuredStart !== -1) {
    const listStart = html.indexOf('<ul class="threecol"', featuredStart)
    const featured = html.slice(featuredStart, listStart === -1 ? featuredStart + 4000 : listStart)
    const entry = toEntry(featured, seen)
    if (entry) entries.push(entry)
  }

  const listStart = html.indexOf('<ul class="threecol"')

  if (listStart !== -1) {
    const listEnd = html.indexOf('</ul>', listStart)
    const list = html.slice(listStart, listEnd === -1 ? undefined : listEnd)

    for (const block of list.split('<li').slice(1, 11)) {
      const entry = toEntry(block, seen)
      if (entry) entries.push(entry)
    }
  }

  if (entries.length === 0) {
    throw new Error(`BBC 英语学习页面结构已变化，未找到 ${channel} 的文章`)
  }

  return { entries }
}

export async function preview(ctx) {
  const url = ctx.item?.url
  if (!url) return null
  const content = await ctx.article(url)
  return content === null ? null : { content }
}
