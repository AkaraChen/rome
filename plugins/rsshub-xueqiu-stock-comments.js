// Ported from RSSHub lib/routes/xueqiu/stock-comments.tsx (AGPL-3.0).
// 雪球股票评论 — the public search endpoint, not the WAF-guarded page.
//
// `xueqiu.com/query/...` answers with an Aliyun challenge, but the same query
// on `api.xueqiu.com` returns JSON without a token. That is the one detail
// worth carrying over from the upstream route: use the API host.
//
// The list already includes each post's full HTML, so content is filled here
// and preview has nothing left to do. The stock name is not in this payload
// (the route upstream scrapes it from a page that is now also challenged), so
// the entry title falls back to the post text.

export const meta = {
  id: 'rome.rsshub-xueqiu-stock-comments',
  name: '雪球 · 股票评论',
  version: '1.0.0',
  apiVersion: '1',
  view: 'socialMedia',
  description: '雪球某只股票下的最新讨论与评论',
  icon: 'https://xueqiu.com/favicon.ico',
  params: {
    fields: [
      {
        key: 'id',
        type: 'text',
        label: '股票代码',
        help: '需要带上交易所，例如 SZ002626',
        default: '',
      },
    ],
  },
}

const API = 'https://api.xueqiu.com/query/v1/symbol/search/status.json'

function decode(text) {
  return String(text).replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (match, entity) => {
    if (entity[0] === '#') {
      const code = entity[1] === 'x' || entity[1] === 'X'
        ? Number.parseInt(entity.slice(2), 16)
        : Number.parseInt(entity.slice(1), 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : match
    }
    return match
  })
}

function plain(html, limit) {
  const text = decode(String(html ?? '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim()
  if (!limit || text.length <= limit) return text
  return `${text.slice(0, limit).replace(/\s+$/, '')}…`
}

function seconds(value) {
  const number = Number(value)
  if (!Number.isFinite(number) || number <= 0) return undefined
  return Math.floor(number > 1e12 ? number / 1000 : number)
}

export async function fetch(ctx) {
  const id = String(ctx.params.id ?? '').trim()

  if (!id) {
    throw new Error('缺少股票代码：需要带上交易所，例如 SZ002626')
  }

  const url = `${API}?${new URLSearchParams({
    u: '11111',
    count: '100',
    comment: '0',
    symbol: id,
    source: 'all',
    sort: 'time',
  })}`

  ctx.log.debug(`xueqiu-stock-comments: GET ${url}`)

  const response = await ctx.fetch(url, {
    headers: {
      accept: 'application/json',
      referer: `https://xueqiu.com/S/${id}`,
    },
  })

  if (!response.ok) {
    throw new Error(`雪球评论返回 ${response.status} ${response.statusText}`)
  }

  const body = await response.json()

  if (!Array.isArray(body?.list)) {
    throw new Error('雪球评论没有返回 list 数组，接口可能已经变了')
  }

  const entries = []

  for (const item of body.list) {
    if (!item?.id) continue

    const text = item.text || item.description || ''
    const title = item.title || plain(text, 90)
    if (!title) continue

    const facts = []
    if (Number.isFinite(Number(item.reply_count))) facts.push(`${item.reply_count} 回复`)
    if (Number.isFinite(Number(item.like_count))) facts.push(`${item.like_count} 赞`)
    if (item.source) facts.push(item.source)

    const entry = {
      // A status id is permanent, and the target only changes if the site
      // rewrites the post, so the id is the safe key.
      id: `xueqiu:comment:${item.id}`,
      title,
      url: `https://xueqiu.com${item.target}`,
      summary: facts.join(' · '),
      content: text,
    }

    if (item.user?.screen_name) entry.author = item.user.screen_name

    const publishedAt = seconds(item.created_at)
    if (publishedAt !== undefined) entry.publishedAt = publishedAt

    entries.push(entry)
  }

  if (entries.length === 0 && body.list.length > 0) {
    throw new Error('雪球评论返回了内容，但没有任何一条带 id 或正文，结构可能已经变了')
  }

  ctx.log.info(`xueqiu-stock-comments: ${id} ${entries.length} 条`)

  return { entries }
}
