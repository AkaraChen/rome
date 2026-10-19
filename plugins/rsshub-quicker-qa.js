// Ported from RSSHub lib/routes/quicker/qa.ts (AGPL-3.0).
// Quicker 讨论区 — 按分类和状态筛选问题。
//
// 列表是 question-item 块，data-tid 就是问题 ID；标题链接同时带 class
// question-title。分类和状态都是查询参数，空状态表示全部。

export const meta = {
  id: 'rome.rsshub-quicker-qa',
  name: 'Quicker · 讨论区',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: 'Quicker 讨论区的问题列表',
  icon: 'https://getquicker.net/favicon.ico',
  params: {
    fields: [
      {
        key: 'category',
        type: 'select',
        label: '分类',
        help: '问题所属分类，all 为全部',
        default: 'all',
        required: false,
        options: [
          { value: 'all', label: '全部' },
          { value: '1', label: '使用问题' },
          { value: '9', label: '动作开发' },
          { value: '3', label: 'BUG 反馈' },
          { value: '4', label: '功能建议' },
          { value: '6', label: '动作需求' },
          { value: '2', label: '经验创意' },
          { value: '7', label: '动作推荐' },
          { value: '5', label: '信息发布' },
          { value: '8', label: '随便聊聊' },
          { value: '10', label: '异常报告' },
        ],
      },
      {
        key: 'state',
        type: 'select',
        label: '状态',
        help: '问题状态，留空为全部',
        default: '',
        required: false,
        options: [
          { value: '', label: '全部' },
          { value: 'digest', label: '精华' },
          { value: 'archived', label: '已归档' },
        ],
      },
    ],
  },
}

const BASE = 'https://getquicker.net'
const CATEGORIES = new Set(['all', '1', '9', '3', '4', '6', '2', '7', '5', '8', '10'])
const STATES = new Set(['', 'digest', 'archived'])

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

function decode(text) {
  return String(text).replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity) => {
    if (entity[0] === '#') {
      const code = entity[1] === 'x' || entity[1] === 'X'
        ? Number.parseInt(entity.slice(2), 16)
        : Number.parseInt(entity.slice(1), 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : match
    }
    return Object.prototype.hasOwnProperty.call(ENTITIES, entity) ? ENTITIES[entity] : match
  })
}

function stripTags(html) {
  return decode(String(html).replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim()
}

function parseList(html) {
  const entries = []

  for (const block of html.split('<div class="question-item').slice(1)) {
    const anchor = /<a class="question-title[^"]*"\s+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(block)
    if (!anchor) continue

    const title = stripTags(anchor[2])
    if (!title) continue

    const tid = /data-tid="(\d+)"/.exec(block)
    const url = new URL(decode(anchor[1]), BASE).href

    entries.push({
      // 问题 ID 是站内的永久标识，URL 末尾也是它。
      id: `quicker:qa:${tid ? tid[1] : new URL(url).pathname.split('/').pop()}`,
      title,
      url,
    })
  }

  return entries
}

export async function fetch(ctx) {
  const category = String(ctx.params.category ?? 'all').trim() || 'all'
  const state = String(ctx.params.state ?? '').trim()

  if (!CATEGORIES.has(category)) {
    throw new Error(`不支持的讨论分类 ${category}`)
  }
  if (!STATES.has(state)) {
    throw new Error(`不支持的讨论状态 ${state}，可选 digest、archived 或留空`)
  }

  const url = new URL('/QA', BASE)
  if (category !== 'all') url.searchParams.set('category', category)
  if (state) url.searchParams.set('state', state)

  ctx.log.debug(`quicker: GET ${url.href}`)

  const response = await ctx.fetch(url.href, { headers: { accept: 'text/html' } })

  if (!response.ok) {
    throw new Error(`Quicker 讨论区返回 ${response.status} ${response.statusText}`)
  }

  const html = await response.text()
  const entries = parseList(html)

  if (entries.length === 0) {
    throw new Error('Quicker 讨论区没有解析到问题，页面结构可能已经改变')
  }

  return { entries, icon: `${BASE}/favicon.ico` }
}

export async function preview(ctx) {
  if (!ctx.item?.url) return null
  const content = await ctx.article(ctx.item.url)
  return content === null ? null : { content }
}
