// Ported from OpenCLI clis/producthunt/posts.js (Apache-2.0).
// Product Hunt latest launches — the public Atom feed, optionally narrowed to
// one category slug. No browser and no API token.

export const meta = {
  id: 'rome.opencli-producthunt-posts',
  name: 'Product Hunt · 最新发布',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: 'Product Hunt 最新发布的产品，可按分类筛选。',
  icon: 'https://www.producthunt.com/favicon.ico',
  params: {
    fields: [
      { key: 'limit', type: 'number', label: '每次抓取条数', help: '最多 50 条', default: 20, min: 1, max: 50 },
      {
        key: 'category',
        type: 'select',
        label: '产品分类',
        help: '留空则读取全部最新发布',
        default: '',
        options: [
          { value: '', label: '全部分类' },
          { value: 'ai-agents', label: 'AI 智能体' },
          { value: 'ai-coding-agents', label: 'AI 编程智能体' },
          { value: 'ai-code-editors', label: 'AI 代码编辑器' },
          { value: 'ai-chatbots', label: 'AI 聊天机器人' },
          { value: 'ai-workflow-automation', label: 'AI 工作流自动化' },
          { value: 'vibe-coding', label: 'Vibe Coding' },
          { value: 'developer-tools', label: '开发者工具' },
          { value: 'productivity', label: '效率工具' },
          { value: 'design-creative', label: '设计与创意' },
          { value: 'marketing-sales', label: '市场与销售' },
          { value: 'no-code-platforms', label: '无代码平台' },
          { value: 'llms', label: '大语言模型' },
          { value: 'finance', label: '金融' },
          { value: 'social-community', label: '社交与社区' },
          { value: 'engineering-development', label: '工程与开发' },
        ],
      },
    ],
  },
}

const FEED = 'https://www.producthunt.com/feed'

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
  const limit = integer(ctx.params.limit, 20, 1, 50)
  const category = String(ctx.params.category || '').trim()
  const url = category
    ? `${FEED}?category=${encodeURIComponent(category)}`
    : FEED

  const response = await ctx.fetch(url, {
    headers: {
      'user-agent': 'Mozilla/5.0 (compatible; opencli/1.0)',
      accept: 'application/atom+xml, application/xml',
    },
  })

  if (!response.ok) {
    throw new Error(`Product Hunt 订阅源返回 HTTP ${response.status}`)
  }

  const xml = await response.text()
  const entries = []
  const entry = /<entry[^>]*>([\s\S]*?)<\/entry>/g
  let match

  while ((match = entry.exec(xml)) !== null && entries.length < limit) {
    const block = match[1]
    const name = plain(tag(block, 'title'))
    const link = /<link[^>]*href="([^"]+)"/.exec(block)
    const address = link ? decode(link[1]).trim() : ''
    const rawId = plain(tag(block, 'id'))

    if (!name) continue

    // Atom ids look like `tag:www.producthunt.com,2005:Post/12345`; the
    // trailing number alone is the stable, compact form. The link is the
    // fallback when the feed omits the id element entirely.
    const numeric = /Post\/(\d+)/.exec(rawId)
    const id = numeric ? `producthunt:${numeric[1]}` : rawId ? `producthunt:${rawId}` : address ? `producthunt:${address}` : ''
    if (!id) continue

    // The tagline lives in the entry's HTML body; the text after it is the
    // feed's own "Discussion | Link" furniture and is not part of the pitch.
    // Decode once before stripping, because the body arrives entity-escaped.
    const content = plain(decode(tag(block, 'content')))
      .replace(/\s*Discussion\s*\|?\s*/gi, '')
      .replace(/\s*\|?\s*Link\s*$/gi, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120)

    entries.push({
      id,
      title: name,
      url: address,
      author: plain(tag(block, 'name')) || undefined,
      publishedAt: seconds(decode(tag(block, 'published')).trim()),
      summary: content,
    })
  }

  if (entries.length === 0) {
    throw new Error('Product Hunt 订阅源没有返回条目。')
  }

  return { entries }
}
