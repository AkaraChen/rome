// Ported from OpenCLI clis/sinafinance/news.js (Apache-2.0).
// 新浪财经 7x24 — OpenCLI 的 `sinafinance news`.
//
// 公开快讯接口，不需要 key 或浏览器。每条快讯本身就是一段带标题的正文。
// 移植自 clis/sinafinance/news.js。

export const meta = {
  id: 'rome.opencli-sinafinance-news',
  name: '新浪财经 · 7x24',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: '新浪财经 7x24 小时实时快讯。',
  icon: 'https://finance.sina.com.cn/favicon.ico',
  params: {
    fields: [
      {
        key: 'limit',
        type: 'number',
        label: '条数',
        help: '最多 50 条',
        default: 20,
        min: 1,
        max: 50,
      },
      {
        key: 'type',
        type: 'select',
        label: '快讯分类',
        default: '0',
        options: [
          { value: '0', label: '全部' },
          { value: '1', label: 'A 股' },
          { value: '2', label: '宏观' },
          { value: '3', label: '公司' },
          { value: '4', label: '数据' },
          { value: '5', label: '市场' },
          { value: '6', label: '国际' },
          { value: '7', label: '观点' },
          { value: '8', label: '央行' },
          { value: '9', label: '其它' },
        ],
      },
    ],
  },
}

const FEED = 'https://app.cj.sina.com.cn/api/news/pc'

// 用户看到的分类编号 → 新浪接口自己的 tag。
const TYPE_MAP = [0, 10, 1, 3, 4, 5, 102, 6, 6, 8]

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

function decode(text) {
  return String(text ?? '').replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity) => {
    if (entity[0] === '#') {
      const code = entity[1] === 'x' || entity[1] === 'X'
        ? Number.parseInt(entity.slice(2), 16)
        : Number.parseInt(entity.slice(1), 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : match
    }

    return Object.prototype.hasOwnProperty.call(ENTITIES, entity) ? ENTITIES[entity] : match
  })
}

function plain(html) {
  return decode(String(html ?? '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()
}

function integer(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(Math.max(parsed, min), max)
}

// create_time 是北京时间，没有时区标记；按 UTC+8 显式换算，避免依赖本机时区。
function seconds(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/.exec(String(value ?? '').trim())
  if (!match) return undefined

  const milliseconds = Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]) - 8,
    Number(match[5]),
    Number(match[6]),
  )

  return Number.isFinite(milliseconds) ? Math.floor(milliseconds / 1000) : undefined
}

export async function fetch(ctx) {
  const limit = integer(ctx.params?.limit, 20, 1, 50)
  const type = integer(ctx.params?.type, 0, 0, 9)

  const params = new URLSearchParams({
    page: '1',
    size: String(limit),
    tag: String(TYPE_MAP[type] ?? 0),
  })

  const url = `${FEED}?${params}`

  ctx.log.debug(`opencli-sinafinance-news: GET ${url}`)

  const response = await ctx.fetch(url, { headers: { accept: 'application/json' } })

  if (!response.ok) {
    throw new Error(`新浪财经快讯接口返回 HTTP ${response.status}`)
  }

  const payload = await response.json()
  const list = payload?.result?.data?.feed?.list

  if (!Array.isArray(list)) {
    throw new Error('新浪财经快讯接口返回了意料之外的数据')
  }

  if (list.length === 0) {
    throw new Error('新浪财经没有返回快讯，换一个分类试试')
  }

  const entries = []

  for (const item of list.slice(0, limit)) {
    if (item?.id == null) continue

    const text = plain(item.rich_text)

    if (!text) continue

    const entry = {
      // 快讯 id 由新浪分配，刷新时不会变。
      id: `sina:${item.id}`,
      title: text,
      url: item.docurl || 'https://finance.sina.com.cn/7x24/',
      summary: [item.view_num || '0 阅读', `${item.comment_num ?? 0} 评论`].join(' · '),
    }

    const publishedAt = seconds(item.create_time)
    if (publishedAt !== undefined) entry.publishedAt = publishedAt

    if (item.rich_text) entry.content = item.rich_text

    const image = item.multimedia?.img_url?.[0]
    if (image) entry.image = image

    entries.push(entry)
  }

  if (entries.length === 0) {
    throw new Error('新浪财经返回的快讯都缺少 id 或正文')
  }

  ctx.log.info(`opencli-sinafinance-news: ${entries.length} 条`)

  return { entries }
}

export async function preview(ctx) {
  const url = ctx.item?.url

  if (!url) return null

  const content = await ctx.article(url)
  return content === null ? null : { content }
}
