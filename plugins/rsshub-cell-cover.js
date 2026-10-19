// Ported from RSSHub lib/routes/cell/cover.ts (AGPL-3.0).
// Cell · Cover Story — ported from RSSHub's /cell/cover.
//
// One entry per Cell journal, built from the channel header of that journal's
// `current.rss`: publication name, ISSN, volume, issue and publication date.
// The cover image is a predictable Elsevier asset keyed by the ISSN, so it is
// derived rather than scraped — which is why three journals whose feed does not
// carry the right ISSN are pinned here.
//
// Nineteen feeds are fetched in parallel. A journal that fails is skipped
// rather than failing the whole feed; only a total failure throws.

export const meta = {
  id: 'rome.rsshub-cell-cover',
  name: 'Cell · Cover Story',
  version: '1.0.0',
  apiVersion: '1',
  view: 'pictures',
  description: 'Cell 旗下各期刊最新一期的封面与卷期信息',
  icon: 'https://www.cell.com/favicon.ico',
}

const BASE = 'https://www.cell.com'
const COVER = 'https://ars.els-cdn.com/content/image'

const JOURNALS = [
  'cell',
  'cancer-cell',
  'cell-chemical-biology',
  'cell-host-microbe',
  'cell-metabolism',
  'cell-reports',
  'cell-reports-physical-science',
  'cell-stem-cell',
  'cell-systems',
  'chem',
  'current-biology',
  'developmental-cell',
  'immunity',
  'joule',
  'matter',
  'molecular-cell',
  'neuron',
  'one-earth',
  'structure',
]

// These feeds carry an ISSN that does not match the cover asset.
const ISSN_OVERRIDES = {
  joule: '2542-4351',
  matter: '2590-2385',
  'one-earth': '2590-3322',
}

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

export async function fetch(ctx) {
  const results = await Promise.all(
    JOURNALS.map(async (journal) => {
      try {
        const response = await ctx.fetch(`${BASE}/${journal}/current.rss`, {
          headers: { accept: 'application/rss+xml, application/xml, text/xml' },
        })

        if (!response.ok) return null

        const xml = await response.text()
        const channel = xml.match(/<channel\b[\s\S]*?<\/channel>/)
        if (!channel) return null

        const name = tag(channel[0], 'prism:publicationName')
        const issn = ISSN_OVERRIDES[journal] || tag(channel[0], 'prism:issn')
        if (!name || !issn) return null

        const volume = tag(channel[0], 'prism:volume')
        const number = tag(channel[0], 'prism:number')
        const image = `${COVER}/X${issn.replaceAll('-', '')}.jpg`
        const link = `${BASE}/${journal}/current`

        const entry = {
          id: `cell:cover:${journal}:${volume ?? ''}-${number ?? ''}`,
          title: volume && number ? `${name} | Volume ${volume}, Issue ${number}` : name,
          url: link,
          content: `<p><img src="${image}" alt="${name.replaceAll('"', '')}"></p>`,
          image,
          params: { journal },
        }

        const publishedAt = unixFromDate(tag(channel[0], 'prism:publicationDate'))
        if (publishedAt !== undefined) entry.publishedAt = publishedAt

        return entry
      } catch {
        // A single journal's feed being unavailable should not hide the rest.
        return null
      }
    })
  )

  const entries = results.filter(Boolean)

  if (entries.length === 0) {
    throw new Error('Cell 没有返回任何期刊封面，各期刊订阅源可能都不可用了')
  }

  ctx.log.info(`cell-cover: ${entries.length} 个期刊`)

  return { entries, icon: 'https://www.cell.com/favicon.ico' }
}
