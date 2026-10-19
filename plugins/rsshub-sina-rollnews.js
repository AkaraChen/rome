// Ported from RSSHub lib/routes/sina/rollnews.ts (AGPL-3.0).
// 新浪滚动新闻 — the roll news JSON API, one request per feed. The article
// body lives on the news page and is read by preview, not by fetch.

export const meta = {
  id: 'rome.rsshub-sina-rollnews',
  name: '新浪 · 滚动新闻',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: '新浪网各分区的滚动新闻',
  icon: 'https://www.sina.com.cn/favicon.ico',
  params: {
    fields: [
      {
        key: 'lid',
        type: 'select',
        label: '分区',
        help: '选择要订阅的滚动新闻分区，默认为全部',
        default: '2509',
        options: [
          { value: '2509', label: '全部' },
          { value: '2510', label: '国内' },
          { value: '2511', label: '国际' },
          { value: '2669', label: '社会' },
          { value: '2512', label: '体育' },
          { value: '2513', label: '娱乐' },
          { value: '2514', label: '军事' },
          { value: '2515', label: '科技' },
          { value: '2516', label: '财经' },
          { value: '2517', label: '股市' },
          { value: '2518', label: '美股' },
        ],
      },
    ],
  },
}

const PAGE_ID = '153'
const LIMIT = 50

function seconds(value) {
  const number = Number(value)
  return Number.isFinite(number) ? Math.floor(number) : undefined
}

function https(url) {
  return String(url ?? '').replace(/^http:\/\//, 'https://')
}

export async function fetch(ctx) {
  const lid = String(ctx.params.lid ?? '').trim() || '2509'
  const url = `https://feed.mix.sina.com.cn/api/roll/get?pageid=${PAGE_ID}&lid=${encodeURIComponent(lid)}&k=&num=${LIMIT}&page=1&r=${Math.random()}&_=${Date.now()}`

  ctx.log.debug(`sina-rollnews: GET ${url}`)

  const response = await ctx.fetch(url, {
    headers: { accept: 'application/json', referer: 'https://news.sina.com.cn/' },
  })

  if (!response.ok) {
    throw new Error(`新浪返回 ${response.status} ${response.statusText}`)
  }

  const body = await response.json()
  const list = body?.result?.data

  if (!Array.isArray(list)) {
    throw new Error('新浪滚动新闻接口没有返回数据，接口可能已经变了')
  }

  const entries = list.map((item) => {
    const entry = {
      // `oid` is the article's own numeric id and survives a URL change.
      id: `sina:${item.oid || item.docid || item.url}`,
      title: item.title,
      url: https(item.url),
      summary: item.intro,
    }

    if (item.media_name) entry.author = item.media_name

    const publishedAt = seconds(item.intime)
    if (publishedAt !== undefined) entry.publishedAt = publishedAt

    return entry
  }).filter((entry) => entry.title && entry.url)

  if (entries.length === 0) {
    throw new Error('新浪滚动新闻接口没有返回可解析的条目，接口可能已经变了')
  }

  ctx.log.info(`sina-rollnews: ${lid} ${entries.length} 条`)

  return { entries, icon: 'https://www.sina.com.cn/favicon.ico' }
}

export async function preview(ctx) {
  const url = ctx.item?.url
  if (!url) return null

  const content = await ctx.article(url)
  return content === null ? null : { content }
}
