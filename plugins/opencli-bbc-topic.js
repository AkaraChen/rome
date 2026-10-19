// Ported from OpenCLI clis/bbc/topic.js (Apache-2.0).
// BBC News by section — BBC publishes one public RSS feed per section at
// `https://feeds.bbci.co.uk/news/<topic>/rss.xml`. Only the sections that have
// a feed are offered; an unknown topic is refused rather than fetched.

export const meta = {
  id: 'rome.opencli-bbc-topic',
  name: 'BBC · 分类新闻',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: '按分类读取 BBC 新闻的 RSS 头条。',
  icon: 'https://www.bbc.com/favicon.ico',
  params: {
    fields: [
      {
        key: 'topic',
        type: 'select',
        label: '新闻分类',
        help: '选择 BBC 的一个板块',
        default: '',
        options: [
          { value: 'world', label: '国际' },
          { value: 'business', label: '商业' },
          { value: 'politics', label: '政治' },
          { value: 'health', label: '健康' },
          { value: 'education', label: '教育' },
          { value: 'science_and_environment', label: '科学与环境' },
          { value: 'technology', label: '科技' },
          { value: 'entertainment_and_arts', label: '娱乐与艺术' },
        ],
      },
      { key: 'limit', type: 'number', label: '每次抓取条数', help: '1 到 50 条', default: 20, min: 1, max: 50 },
    ],
  },
}

const BASE = 'https://feeds.bbci.co.uk/news'
const TOPICS = [
  'world',
  'business',
  'politics',
  'health',
  'education',
  'science_and_environment',
  'technology',
  'entertainment_and_arts',
]

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

function decode(text) {
  return String(text || '').replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity) => {
    if (entity[0] === '#') {
      const code = entity[1] === 'x' || entity[1] === 'X'
        ? Number.parseInt(entity.slice(2), 16)
        : Number.parseInt(entity.slice(1), 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : match
    }
    return Object.prototype.hasOwnProperty.call(ENTITIES, entity) ? ENTITIES[entity] : match
  })
}

function tag(block, name) {
  const pattern = new RegExp(`<${name}(?:\\s[^>]*)?>\\s*(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?\\s*</${name}>`)
  const match = pattern.exec(block)
  return match ? match[1] : ''
}

function plain(html) {
  return decode(String(html || '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim()
}

function seconds(value) {
  if (!value) return undefined
  const milliseconds = Date.parse(value)
  return Number.isFinite(milliseconds) ? Math.floor(milliseconds / 1000) : undefined
}

function integer(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(Math.max(parsed, min), max)
}

export async function fetch(ctx) {
  // `technology` and `Tech` both mean the same feed, so normalise first.
  const topic = String(ctx.params.topic || '').trim().toLowerCase().replace(/[\s-]+/g, '_')

  if (!topic) {
    throw new Error('请选择一个 BBC 新闻分类。')
  }

  if (!TOPICS.includes(topic)) {
    throw new Error(`BBC 没有「${topic}」这个分类，可选：${TOPICS.join(', ')}`)
  }

  const limit = integer(ctx.params.limit, 20, 1, 50)
  const response = await ctx.fetch(`${BASE}/${topic}/rss.xml`, {
    headers: {
      'user-agent': 'opencli-bbc-adapter (+https://github.com/jackwener/opencli)',
      accept: 'application/rss+xml, application/xml',
    },
  })

  if (!response.ok) {
    throw new Error(`BBC ${topic} RSS 返回 HTTP ${response.status}`)
  }

  const xml = await response.text()
  const entries = []
  const item = /<item[^>]*>([\s\S]*?)<\/item>/g
  let match

  while ((match = item.exec(xml)) !== null && entries.length < limit) {
    const block = match[1]
    const title = plain(tag(block, 'title'))
    const link = decode(tag(block, 'link')).trim()
    const guid = decode(tag(block, 'guid')).trim()
    const address = link || guid

    if (!title || !address) continue

    entries.push({
      id: `bbc:${guid || address}`,
      title,
      url: address,
      publishedAt: seconds(decode(tag(block, 'pubDate')).trim()),
      summary: plain(tag(block, 'description')),
    })
  }

  if (entries.length === 0) {
    // An empty list means the feed shape changed or the section went quiet;
    // saying so is better than a source that silently looks empty.
    throw new Error(`BBC ${topic} 分类没有返回任何条目。`)
  }

  return { entries }
}

export async function preview(ctx) {
  const content = await ctx.article(ctx.item.url)
  return content === null ? null : { content }
}
