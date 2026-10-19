// Ported from RSSHub lib/routes/cell/cell.ts (AGPL-3.0).
// Cell · Current Issue — ported from RSSHub's /cell/cell/:category.
//
// Cell publishes a proper RDF/RSS feed, so no page is scraped: `current.rss`
// and `inpress.rss` carry the title, authors, abstract, DOI, section and date
// per item. The feed's `link` carries a `?rss=yes` marker that is not part of
// the article URL.

export const meta = {
  id: 'rome.rsshub-cell-cell',
  name: 'Cell · Current Issue',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: 'Cell 期刊当前期或待刊文章，含作者、摘要、DOI 与栏目',
  icon: 'https://www.cell.com/favicon.ico',
  params: {
    fields: [
      {
        key: 'category',
        type: 'select',
        label: '内容',
        help: 'current 为当前期，inpress 为待刊文章',
        default: 'current',
        options: [
          { value: 'current', label: '当前期' },
          { value: 'inpress', label: '待刊文章' },
        ],
      },
    ],
  },
}

const BASE = 'https://www.cell.com'

function decodeXml(value) {
  return String(value ?? '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#x([0-9a-f]+);/gi, (match, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (match, decimal) => String.fromCodePoint(Number(decimal)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

/// The tag is namespaced (`dc:title`), so the pattern keeps the colon literal.
function tag(xml, name) {
  const safe = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = xml.match(new RegExp(`<${safe}(?:\\s[^>]*)?>([\\s\\S]*?)</${safe}>`))
  return match ? decodeXml(match[1]).trim() : undefined
}

function unixFromDate(value) {
  const text = String(value ?? '').trim()
  if (text === '') return undefined
  const milliseconds = Date.parse(text.length >= 10 ? `${text.slice(0, 10)}T00:00:00Z` : text)
  return Number.isFinite(milliseconds) ? Math.floor(milliseconds / 1000) : undefined
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

export async function fetch(ctx) {
  const category = ctx.params.category || 'current'
  const inPress = category === 'inpress'

  if (category !== 'current' && category !== 'inpress') {
    throw new Error('Cell 只支持 current 或 inpress')
  }

  const response = await ctx.fetch(`${BASE}/cell/${inPress ? 'inpress' : 'current'}.rss`, {
    headers: { accept: 'application/rss+xml, application/xml, text/xml' },
  })

  if (!response.ok) {
    throw new Error(`Cell 返回 ${response.status} ${response.statusText}`)
  }

  const xml = await response.text()
  const blocks = xml.match(/<item\s[\s\S]*?<\/item>/g)

  if (!blocks) {
    throw new Error('Cell 没有返回 RSS 条目，订阅源可能已经变了')
  }

  const entries = []

  for (const block of blocks) {
    const title = tag(block, 'dc:title') || tag(block, 'title')
    const link = (tag(block, 'link') || '').replace('?rss=yes', '')
    if (!title || !link) continue

    const doi = tag(block, 'dc:identifier')
    const section = tag(block, 'prism:section')
    const description = tag(block, 'description')
    const author = tag(block, 'dc:creator')

    const entry = {
      id: `cell:${inPress ? 'inpress' : 'current'}:${doi || link}`,
      title,
      url: link,
      summary: description || undefined,
      content: [
        description ? `<p>${escapeHtml(description)}</p>` : null,
        section ? `<p>栏目：${escapeHtml(section)}</p>` : null,
        doi ? `<p>DOI：${escapeHtml(doi)}</p>` : null,
      ].filter(Boolean).join(''),
    }

    if (author) entry.author = author

    const publishedAt = unixFromDate(tag(block, 'dc:date') || tag(block, 'prism:publicationDate'))
    if (publishedAt !== undefined) entry.publishedAt = publishedAt

    entries.push(entry)
  }

  if (entries.length === 0) {
    throw new Error('Cell 订阅源为空，接口可能已经变了')
  }

  ctx.log.info(`cell-${category}: ${entries.length} 条`)

  return { entries, icon: 'https://www.cell.com/favicon.ico' }
}
