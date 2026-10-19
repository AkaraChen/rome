// Ported from RSSHub lib/routes/163/today.ts (AGPL-3.0).
// 网易新闻今日关注 — a public JSON feed on gw.m.163.com. The upstream route
// fetches every article body when 需要获取全文 is on; here the body is fetched
// only when an entry is opened, so a refresh stays one request.

export const meta = {
  id: 'rome.rsshub-163-today',
  name: '网易公开课 · 今日关注',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: '网易新闻今日关注的推荐条目',
  icon: 'https://www.163.com/favicon.ico',
  params: {
    fields: [
      {
        key: 'need_content',
        type: 'checkbox',
        label: '需要获取全文',
        help: '打开后全文在点开条目时抓取，而不是在刷新时抓取',
        default: true
      }
    ]
  }
}

const API = 'https://gw.m.163.com/nc/api/v1/feed/static/normal-list'
const TID = 'T1573700340788'
const LIMIT = 30

// 网易的时间戳都是北京时间，即 UTC+8。
function chinaSeconds(text) {
  const match = /(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(String(text))
  if (!match) return undefined
  const milliseconds = Date.parse(`${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6] || '00'}+08:00`)
  return Number.isFinite(milliseconds) ? Math.floor(milliseconds / 1000) : undefined
}

export async function fetch(ctx) {
  const url = `${API}?start=0&tid=${TID}&size=${LIMIT}`
  const response = await ctx.fetch(url, { headers: { accept: 'application/json' } })

  if (!response.ok) {
    throw new Error(`网易新闻返回 ${response.status} ${response.statusText}`)
  }

  const payload = await response.json()
  const items = payload?.data?.items

  if (!Array.isArray(items)) {
    throw new Error('网易新闻今日关注接口没有返回条目列表')
  }

  const entries = items.map((item) => {
    const docid = String(item.docid || '')
    const entry = {
      id: `163:today:${docid || item.postid}`,
      title: item.title || '（无标题）',
      url: item.url || `https://c.m.163.com/news/a/${docid}.html`
    }

    if (item.source) {
      entry.author = item.source
    }

    const parts = []
    if (item.digest) parts.push(item.digest)
    if (item.source) parts.push(item.source)
    if (parts.length > 0) entry.summary = parts.join(' · ')

    if (item.imgsrc) {
      entry.image = item.imgsrc
    }

    const publishedAt = chinaSeconds(item.ptime)
    if (publishedAt !== undefined) {
      entry.publishedAt = publishedAt
    }

    return entry
  })

  return { entries }
}

export async function preview(ctx) {
  const flag = ctx.params?.need_content
  const wanted = flag === undefined || flag === null ? true : !(flag === false || flag === 'false' || flag === '0' || flag === 0)

  if (!wanted) {
    return null
  }

  const url = ctx.item?.url
  if (!url) return null
  const content = await ctx.article(url)
  return content === null ? null : { content }
}
