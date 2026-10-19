// Ported from RSSHub lib/routes/lemonde/index.ts (AGPL-3.0).
// Le Monde · Actualités — ported from RSSHub's /lemonde/:category.
//
// Le Monde publishes one RSS 2.0 feed per section, so the category is just a
// choice of feed URL. Items carry a CDATA title, an RFC 822 date, a summary and
// a `media:content` element whose `url` is the picture and whose nested
// `media:credit` is the photographer.

export const meta = {
  id: 'rome.rsshub-lemonde-index',
  name: 'Le Monde · Actualités',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: 'Le Monde 法语新闻，可按国际、政治、经济、文化等栏目筛选',
  icon: 'https://www.lemonde.fr/favicon.ico',
  params: {
    fields: [
      {
        key: 'category',
        type: 'select',
        label: '栏目',
        help: '选择要订阅的栏目，默认为首页头条',
        default: '',
        options: [
          { value: '', label: '首页头条' },
          { value: 'international', label: '国际' },
          { value: 'politique', label: '政治' },
          { value: 'economie', label: '经济' },
          { value: 'societe', label: '社会' },
          { value: 'culture', label: '文化' },
          { value: 'sport', label: '体育' },
          { value: 'planete', label: '环境' },
          { value: 'pixels', label: '科技与数字' },
          { value: 'sciences', label: '科学' },
          { value: 'idees', label: '观点' },
          { value: 'sante', label: '健康' },
          { value: 'em', label: 'M le mag' },
          { value: 'en-continu', label: '滚动新闻' },
          { value: 'decodeurs', label: '事实核查' },
        ],
      },
    ],
  },
}

const ROOT = 'https://www.lemonde.fr'

const FEEDS = {
  '': `${ROOT}/rss/une.xml`,
  international: `${ROOT}/international/rss_full.xml`,
  politique: `${ROOT}/politique/rss_full.xml`,
  economie: `${ROOT}/economie/rss_full.xml`,
  societe: `${ROOT}/societe/rss_full.xml`,
  culture: `${ROOT}/culture/rss_full.xml`,
  sport: `${ROOT}/sport/rss_full.xml`,
  planete: `${ROOT}/planete/rss_full.xml`,
  pixels: `${ROOT}/pixels/rss_full.xml`,
  sciences: `${ROOT}/sciences/rss_full.xml`,
  idees: `${ROOT}/idees/rss_full.xml`,
  sante: `${ROOT}/sante/rss_full.xml`,
  em: `${ROOT}/em/rss_full.xml`,
  'en-continu': `${ROOT}/en-continu/rss_full.xml`,
  decodeurs: `${ROOT}/decodeurs/rss_full.xml`,
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

function plain(value) {
  return decodeXml(String(value ?? '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim()
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

export async function fetch(ctx) {
  const category = ctx.params.category || ''
  const feed = FEEDS[category]

  if (!feed) {
    throw new Error(`未知栏目：${category}，请从参数选项中选择`)
  }

  const response = await ctx.fetch(feed, {
    headers: { accept: 'application/rss+xml, application/xml, text/xml' },
  })

  if (!response.ok) {
    throw new Error(`Le Monde 返回 ${response.status} ${response.statusText}`)
  }

  const xml = await response.text()
  const blocks = xml.match(/<item>[\s\S]*?<\/item>/g)

  if (!blocks) {
    throw new Error('Le Monde 没有返回 RSS 条目，订阅源可能已经变了')
  }

  const entries = []

  for (const block of blocks) {
    const title = tag(block, 'title')
    const link = tag(block, 'link') || tag(block, 'guid')
    if (!title || !link) continue

    const summary = plain(tag(block, 'description'))
    const image = (block.match(/<media:content\b[^>]*\burl="([^"]+)"/) || [])[1]
    const credit = tag(block, 'media:credit')

    const entry = {
      id: `lemonde:fr:${link}`,
      title,
      url: link,
      summary: summary || undefined,
      content: [
        image ? `<p><img src="${escapeHtml(decodeXml(image))}"></p>` : null,
        credit ? `<p><em>${escapeHtml(credit)}</em></p>` : null,
        summary ? `<p>${escapeHtml(summary)}</p>` : null,
      ].filter(Boolean).join(''),
    }

    if (image) entry.image = decodeXml(image)

    const publishedAt = Date.parse(tag(block, 'pubDate') ?? '')
    if (Number.isFinite(publishedAt)) entry.publishedAt = Math.floor(publishedAt / 1000)

    entries.push(entry)
  }

  if (entries.length === 0) {
    throw new Error('Le Monde 订阅源为空，接口可能已经变了')
  }

  ctx.log.info(`lemonde-index: ${category || 'home'} ${entries.length} 条`)

  return { entries, icon: 'https://www.lemonde.fr/favicon.ico' }
}
