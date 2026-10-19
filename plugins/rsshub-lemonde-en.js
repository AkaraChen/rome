// Ported from RSSHub lib/routes/lemonde/en.ts (AGPL-3.0).
// Le Monde · News (English) — ported from RSSHub's /lemonde/en/:category.
//
// The English edition publishes the same RSS 2.0 shape as the French one, one
// feed per section, with the section slug spelled in English. The feed is the
// source; nothing is scraped.

export const meta = {
  id: 'rome.rsshub-lemonde-en',
  name: 'Le Monde · News (English)',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: 'Le Monde 英文版新闻，可按世界、欧洲、经济、文化等栏目筛选',
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
          { value: 'international', label: '世界 · 国际' },
          { value: 'americas', label: '世界 · 美洲' },
          { value: 'united-kingdom', label: '世界 · 英国' },
          { value: 'united-states', label: '世界 · 美国' },
          { value: 'africa', label: '世界 · 非洲' },
          { value: 'asia-pacific', label: '世界 · 亚太' },
          { value: 'middle-east', label: '世界 · 中东' },
          { value: 'europe', label: '欧洲' },
          { value: 'politics', label: '法国 · 政治' },
          { value: 'police-and-justice', label: '法国 · 司法' },
          { value: 'education', label: '法国 · 教育' },
          { value: 'french-delights', label: '法国 · 风物' },
          { value: 'environment', label: '环境' },
          { value: 'economy', label: '经济' },
          { value: 'world-economy', label: '经济 · 世界经济' },
          { value: 'french-economy', label: '经济 · 法国经济' },
          { value: 'm-le-mag', label: 'M 杂志' },
          { value: 'lifestyle', label: 'M 杂志 · 生活方式' },
          { value: 'fashion', label: 'M 杂志 · 时尚' },
          { value: 'food', label: 'M 杂志 · 美食' },
          { value: 'travel', label: 'M 杂志 · 旅行' },
          { value: 'culture', label: '文化' },
          { value: 'arts', label: '文化 · 艺术' },
          { value: 'cinema', label: '文化 · 电影' },
          { value: 'music', label: '文化 · 音乐' },
          { value: 'books', label: '文化 · 图书' },
          { value: 'global-issues', label: '全球议题' },
          { value: 'pixels', label: 'Pixels 科技' },
          { value: 'artificial-intelligence', label: 'Pixels · 人工智能' },
          { value: 'social-media', label: 'Pixels · 社交媒体' },
          { value: 'sports', label: '体育' },
          { value: 'football', label: '体育 · 足球' },
          { value: 'rugby', label: '体育 · 橄榄球' },
          { value: 'tennis', label: '体育 · 网球' },
          { value: 'cycling', label: '体育 · 自行车' },
          { value: 'basketball', label: '体育 · 篮球' },
          { value: 'science', label: '科学' },
          { value: 'health', label: '健康' },
          { value: 'intimacy', label: '亲密关系' },
          { value: 'les-decodeurs', label: '事实核查' },
          { value: 'our-times', label: '我们的时代' },
          { value: 'obituaries', label: '讣告' },
          { value: 'religion', label: '宗教' },
          { value: 'opinion', label: '观点' },
          { value: 'editorials', label: '观点 · 社论' },
          { value: 'columns', label: '观点 · 专栏' },
          { value: 'op-eds', label: '观点 · 来论' },
        ],
      },
    ],
  },
}

const ROOT = 'https://www.lemonde.fr/en'

const FEEDS = {
  '': `${ROOT}/rss/une.xml`,
  international: `${ROOT}/international/rss_full.xml`,
  americas: `${ROOT}/americas/rss_full.xml`,
  'united-kingdom': `${ROOT}/united-kingdom/rss_full.xml`,
  'united-states': `${ROOT}/united-states/rss_full.xml`,
  africa: `${ROOT}/le-monde-africa/rss_full.xml`,
  'asia-pacific': `${ROOT}/asia-and-pacific/rss_full.xml`,
  'middle-east': `${ROOT}/middle-east/rss_full.xml`,
  europe: `${ROOT}/europe/rss_full.xml`,
  politics: `${ROOT}/politics/rss_full.xml`,
  'police-and-justice': `${ROOT}/police-and-justice/rss_full.xml`,
  education: `${ROOT}/education/rss_full.xml`,
  'french-delights': `${ROOT}/french-delights/rss_full.xml`,
  environment: `${ROOT}/environment/rss_full.xml`,
  economy: `${ROOT}/economy/rss_full.xml`,
  'world-economy': `${ROOT}/world-economy/rss_full.xml`,
  'french-economy': `${ROOT}/french-economy/rss_full.xml`,
  'm-le-mag': `${ROOT}/m-le-mag/rss_full.xml`,
  lifestyle: `${ROOT}/lifestyle/rss_full.xml`,
  fashion: `${ROOT}/fashion/rss_full.xml`,
  food: `${ROOT}/food/rss_full.xml`,
  travel: `${ROOT}/travel/rss_full.xml`,
  culture: `${ROOT}/culture/rss_full.xml`,
  arts: `${ROOT}/arts/rss_full.xml`,
  cinema: `${ROOT}/cinema/rss_full.xml`,
  music: `${ROOT}/music/rss_full.xml`,
  books: `${ROOT}/books/rss_full.xml`,
  'global-issues': `${ROOT}/global-issues/rss_full.xml`,
  pixels: `${ROOT}/pixels/rss_full.xml`,
  'artificial-intelligence': `${ROOT}/artificial-intelligence/rss_full.xml`,
  'social-media': `${ROOT}/social-media/rss_full.xml`,
  sports: `${ROOT}/sports/rss_full.xml`,
  football: `${ROOT}/football/rss_full.xml`,
  rugby: `${ROOT}/rugby/rss_full.xml`,
  tennis: `${ROOT}/tennis/rss_full.xml`,
  cycling: `${ROOT}/cycling/rss_full.xml`,
  basketball: `${ROOT}/basketball/rss_full.xml`,
  science: `${ROOT}/science/rss_full.xml`,
  health: `${ROOT}/health/rss_full.xml`,
  intimacy: `${ROOT}/intimacy/rss_full.xml`,
  'les-decodeurs': `${ROOT}/les-decodeurs/rss_full.xml`,
  'our-times': `${ROOT}/our-times/rss_full.xml`,
  obituaries: `${ROOT}/obituaries/rss_full.xml`,
  religion: `${ROOT}/religion/rss_full.xml`,
  opinion: `${ROOT}/opinion/rss_full.xml`,
  editorials: `${ROOT}/editorials/rss_full.xml`,
  columns: `${ROOT}/columns/rss_full.xml`,
  'op-eds': `${ROOT}/op-eds/rss_full.xml`,
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
      id: `lemonde:en:${link}`,
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

  ctx.log.info(`lemonde-en: ${category || 'home'} ${entries.length} 条`)

  return { entries, icon: 'https://www.lemonde.fr/favicon.ico' }
}
