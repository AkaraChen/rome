// Ported from RSSHub lib/routes/notion/release.ts (AGPL-3.0).
// Notion Release — the official What's New feed.
//
// The releases page is a Next.js document, but it advertises an RSS feed at
// `/releases/rss.xml`, so this port reads that rather than the HTML. Each item
// has a title, a release page, a date and a guid, and nothing else; the body
// is read by preview through the host's extractor.
//
// No token is involved: releases are public, unlike the database route.

export const meta = {
  id: 'rome.rsshub-notion-release',
  name: 'Notion · Release',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: 'Notion 产品更新与发布说明',
  icon: 'https://www.notion.com/favicon.ico',
}

const FEED = 'https://www.notion.com/releases/rss.xml'

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

function rawTag(block, name) {
  const match = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i').exec(block)
  if (!match) return ''

  const cdata = /<!\[CDATA\[([\s\S]*?)\]\]>/.exec(match[1])
  return cdata ? cdata[1] : match[1]
}

function textTag(block, name) {
  return decode(rawTag(block, name)).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
}

const MONTHS = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
}

function zone(value) {
  if (!value || value === 'Z' || /^(UTC|GMT)$/i.test(value)) return 0

  const text = String(value).replace(/^GMT/i, '')
  const match = /^([+-])(\d{2}):?(\d{2})$/.exec(text)
  if (!match) return 0

  const minutes = Number(match[2]) * 60 + Number(match[3])
  return (match[1] === '-' ? -minutes : minutes) * 60
}

function epoch(year, month, day, hour, minute, second, offset) {
  const milliseconds = Date.UTC(year, month, day, hour, minute, second) - offset * 1000
  return Number.isFinite(milliseconds) ? Math.floor(milliseconds / 1000) : undefined
}

/// Notion writes `Tue Oct 13 2026 00:00:00 GMT+0000 (Coordinated Universal
/// Time)`, which is month-first with a bracketed zone name. Strip the bracket
/// and parse the two orders this file can see: day-first RFC 2822 and that
/// month-first form.
function seconds(value) {
  const text = String(value ?? '').trim().replace(/\s*\([^)]*\)\s*$/, '')
  if (!text) return undefined

  let match = /^(?:[A-Za-z]{3},?\s+)?(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([A-Za-z]{3}|GMT[+-]\d{4}|[+-]\d{2}:?\d{2})?$/.exec(text)
  if (match) {
    const month = MONTHS[match[2].toLowerCase()]
    if (month !== undefined) {
      return epoch(
        Number(match[3]), month, Number(match[1]),
        Number(match[4]), Number(match[5]), Number(match[6] || 0),
        zone(match[7]),
      )
    }
  }

  match = /^(?:[A-Za-z]{3},?\s+)?([A-Za-z]{3})\s+(\d{1,2})\s+(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([A-Za-z]{3}|GMT[+-]\d{4}|[+-]\d{2}:?\d{2})?$/.exec(text)
  if (match) {
    const month = MONTHS[match[1].toLowerCase()]
    if (month !== undefined) {
      return epoch(
        Number(match[3]), month, Number(match[2]),
        Number(match[4]), Number(match[5]), Number(match[6] || 0),
        zone(match[7]),
      )
    }
  }

  const milliseconds = Date.parse(text)
  return Number.isFinite(milliseconds) ? Math.floor(milliseconds / 1000) : undefined
}

export async function fetch(ctx) {
  ctx.log.debug(`notion-release: GET ${FEED}`)

  const response = await ctx.fetch(FEED, { headers: { accept: 'application/rss+xml, application/xml' } })

  if (!response.ok) {
    throw new Error(`Notion 发布说明返回 ${response.status} ${response.statusText}`)
  }

  const xml = await response.text()
  const items = [...xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)]
  const entries = []

  for (const [, item] of items) {
    const link = textTag(item, 'link')
    const title = textTag(item, 'title')
    if (!link || !title) continue

    const guid = textTag(item, 'guid')
    const entry = {
      id: `notion:release:${guid || link}`,
      title,
      url: link,
    }

    const publishedAt = seconds(textTag(item, 'pubDate'))
    if (publishedAt !== undefined) entry.publishedAt = publishedAt

    entries.push(entry)
  }

  if (entries.length === 0) {
    throw new Error('Notion 发布说明 RSS 源没有返回可解析的条目，源可能已经变了')
  }

  ctx.log.info(`notion-release: ${entries.length} 条`)

  return { entries }
}

export async function preview(ctx) {
  const url = ctx.item?.url
  if (!url) return null

  const content = await ctx.article(url)

  return content === null ? null : { content }
}
