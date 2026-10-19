// Ported from RSSHub lib/routes/futunn/topic.ts (AGPL-3.0).
// 富途牛牛专题 — news.futunn.com/news-topics/<id>。
//
// 专题页只用来确认专题标题，而这里没有地方放它，所以只读列表接口。条目
// 编号和「要闻」用的是同一套 newsId，两边读到同一篇时不会重复。

export const meta = {
  id: 'rome.rsshub-futunn-topic',
  name: '富途牛牛 · 专题',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: '富途牛牛专题下的文章',
  icon: 'https://news.futunn.com/favicon.ico',
  params: {
    fields: [
      {
        key: 'id',
        type: 'text',
        label: '专题 ID',
        help: '专题页 URL 中的数字，例如 news-topics/1267/ 就填 1267',
        default: '',
        required: true,
      },
    ],
  },
}

const ROOT = 'https://news.futunn.com'
const LIMIT = 48

function escape(text) {
  return String(text ?? '').replace(/[&<>"]/g, (ch) => {
    if (ch === '&') return '&amp;'
    if (ch === '<') return '&lt;'
    if (ch === '>') return '&gt;'
    return '&quot;'
  })
}

function seconds(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : undefined
}

export async function fetch(ctx) {
  const id = String(ctx.params.id ?? '').trim()

  if (!id) {
    throw new Error('请填写专题 ID（数字）')
  }
  if (!/^\d+$/.test(id)) {
    throw new Error(`专题 ID ${id} 无效，应为数字`)
  }

  const url = `${ROOT}/news-site-api/topic/get-topics-news-list?topicsId=${id}&pageSize=${LIMIT}`

  ctx.log.debug(`futunn: GET ${url}`)

  const response = await ctx.fetch(url, { headers: { accept: 'application/json' } })

  if (!response.ok) {
    throw new Error(`富途牛牛专题返回 ${response.status} ${response.statusText}`)
  }

  const body = await response.json()
  const list = body.data?.data

  if (!Array.isArray(list)) {
    throw new Error('富途牛牛专题接口没有返回 data 数组，接口可能已经变了')
  }

  const entries = list.map((item) => {
    const entry = {
      // 和「要闻」共用 newsId。
      id: `futunn:news:${item.idx}`,
      title: item.title,
      url: String(item.url ?? '').split('?')[0],
    }

    if (item.source) entry.author = item.source
    if (item.pic) entry.image = item.pic
    if (item.abstract) entry.content = `<p>${escape(item.abstract)}</p>`

    const publishedAt = seconds(item.time)
    if (publishedAt !== undefined) entry.publishedAt = publishedAt

    return entry
  })

  if (entries.length === 0) {
    throw new Error(`富途牛牛专题 ${id} 没有返回任何文章`)
  }

  return { entries, icon: `${ROOT}/favicon.ico` }
}
