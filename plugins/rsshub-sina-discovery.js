// Ported from RSSHub lib/routes/sina/discovery.ts (AGPL-3.0).
// 新浪科技科学探索 — one partition id per sub-channel, read from the same
// roll news API the other Sina routes use.

export const meta = {
  id: 'rome.rsshub-sina-discovery',
  name: '新浪 · 科技 - 科学探索',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: '新浪科技科学探索各分区的最新文章',
  icon: 'https://www.sina.com.cn/favicon.ico',
  params: {
    fields: [
      {
        key: 'type',
        type: 'select',
        label: '分区',
        help: '选择要订阅的科学探索分区',
        default: '',
        options: [
          { value: 'zx', label: '最新' },
          { value: 'twhk', label: '天文航空' },
          { value: 'dwzw', label: '动物植物' },
          { value: 'zrdl', label: '自然地理' },
          { value: 'lskg', label: '历史考古' },
          { value: 'smyx', label: '生命医学' },
          { value: 'shbk', label: '生活百科' },
          { value: 'kjqy', label: '科技前沿' },
        ],
      },
    ],
  },
}

const PAGE_ID = '207'
const LIMIT = 50

const CHANNELS = {
  zx: '1795',
  twhk: '1796',
  dwzw: '1797',
  zrdl: '1798',
  lskg: '1799',
  smyx: '1800',
  shbk: '1801',
  kjqy: '1802',
}

function https(url) {
  return String(url ?? '').replace(/^http:\/\//, 'https://')
}

export async function fetch(ctx) {
  const type = String(ctx.params.type ?? '').trim()

  if (!type) {
    throw new Error('缺少分区：请在对应分区页 URL 中找到，例如 zx')
  }

  if (!Object.prototype.hasOwnProperty.call(CHANNELS, type)) {
    throw new Error(`不支持的分区 ${type}：可选值为 ${Object.keys(CHANNELS).join('、')}`)
  }

  const lid = CHANNELS[type]
  const url = `https://feed.mix.sina.com.cn/api/roll/get?pageid=${PAGE_ID}&lid=${lid}&k=&num=${LIMIT}&page=1&r=${Math.random()}&_=${Date.now()}`

  ctx.log.debug(`sina-discovery: GET ${url}`)

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
      id: `sina:${item.oid || item.docid || item.url}`,
      title: item.title,
      url: https(item.url),
      summary: item.intro,
    }

    if (item.media_name) entry.author = item.media_name

    const publishedAt = Number(item.intime)
    if (Number.isFinite(publishedAt)) entry.publishedAt = Math.floor(publishedAt)

    return entry
  }).filter((entry) => entry.title && entry.url)

  if (entries.length === 0) {
    throw new Error('新浪滚动新闻接口没有返回可解析的条目，接口可能已经变了')
  }

  ctx.log.info(`sina-discovery: ${type} ${entries.length} 条`)

  return { entries, icon: 'https://www.sina.com.cn/favicon.ico' }
}

export async function preview(ctx) {
  const url = ctx.item?.url
  if (!url) return null

  const content = await ctx.article(url)
  return content === null ? null : { content }
}
