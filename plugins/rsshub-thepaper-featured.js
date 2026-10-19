// Ported from RSSHub lib/routes/thepaper/featured.ts (AGPL-3.0).
/**
 * 澎湃新闻 -- 首页头条.
 *
 * The mobile home page is a Next.js page, so the whole list is in its
 * __NEXT_DATA__ script tag. There is no DOM here, so that JSON is pulled out
 * with a regex and parsed directly; the article body is fetched only when the
 * reader opens an entry.
 */

export const meta = {
  id: 'rome.rsshub-thepaper-featured',
  name: '澎湃新闻 · 首页头条',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: '澎湃新闻移动端首页的头条与推荐内容',
  icon: 'https://www.thepaper.cn/favicon.ico'
};

const MOBILE_UA = 'Mozilla/5.0 (Linux; Android 10; Pixel 3) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Mobile Safari/537.36'
const BASE = 'https://m.thepaper.cn'

function nextData(html) {
  const match = /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/.exec(html)

  if (!match) {
    throw new Error('thepaper: __NEXT_DATA__ was not found; the page shape changed')
  }

  try {
    return JSON.parse(match[1])
  } catch (error) {
    throw new Error(`thepaper: __NEXT_DATA__ is not valid JSON: ${error.message}`)
  }
}

function parseDate(value) {
  if (value === undefined || value === null || value === '') {
    return undefined
  }

  if (typeof value === 'number') {
    const milliseconds = value > 1e12 ? value : value * 1000
    return Number.isFinite(milliseconds) ? Math.floor(milliseconds / 1000) : undefined
  }

  const text = String(value).trim()

  if (/^\d+$/.test(text)) {
    return parseDate(Number(text))
  }

  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}/.test(text)) {
    const milliseconds = Date.parse(`${text.replace(' ', 'T')}+08:00`)
    return Number.isFinite(milliseconds) ? Math.floor(milliseconds / 1000) : undefined
  }

  const relative = /^(\d+)(秒|分钟|小时|天|周|个月|年)前$/.exec(text)

  if (relative) {
    const units = { 秒: 1, 分钟: 60, 小时: 3600, 天: 86400, 周: 604800, 个月: 2592000, 年: 31536000 }
    return Math.floor(Date.now() / 1000) - Number(relative[1]) * units[relative[2]]
  }

  return undefined
}

function toEntry(item) {
  const contId = item.contId ? String(item.contId) : ''
  const external = Boolean(item.link)
  const url = external ? item.link : `${BASE}/newsDetail_forward_${contId}`

  if (!contId && !external) {
    return null
  }

  const entry = {
    id: `thepaper:${contId || url}`,
    title: item.name || '（无标题）',
    url,
    params: external ? { external: true } : { contId }
  }

  const author = item.author || item.authorInfo?.sname || item.trackAuthor

  if (author) {
    entry.author = author
  }

  const publishedAt = parseDate(item.pubTimeLong) ?? parseDate(item.publishTime) ?? parseDate(item.pubTime)

  if (publishedAt !== undefined) {
    entry.publishedAt = publishedAt
  }

  const label = item.nodeInfo?.name || item.cornerLabelDesc

  if (label) {
    entry.summary = label
  }

  if (item.pic) {
    entry.image = item.pic
  }

  return entry
}

async function readPage(ctx, url) {
  const response = await ctx.fetch(url, { headers: { 'user-agent': MOBILE_UA, cookie: 'blackAndWhiteMode=0; redTops=0;' } })

  if (!response.ok) {
    throw new Error(`thepaper: ${url} returned ${response.status} ${response.statusText}`)
  }

  return response.text()
}

export async function fetch(ctx) {
  const html = await readPage(ctx, BASE)
  const data = nextData(html)
  const pageProps = data.props?.pageProps
  const list = pageProps?.data?.list
  const recommend = pageProps?.topData?.recommendImg

  if (!Array.isArray(list)) {
    throw new Error('thepaper: the home page no longer has props.pageProps.data.list')
  }

  const items = [...list, ...(Array.isArray(recommend) ? recommend : [])]
  const entries = items.map(toEntry).filter(Boolean)

  if (entries.length === 0) {
    throw new Error('thepaper: the home page returned no usable entries')
  }

  return { entries }
}

export async function preview(ctx) {
  const params = ctx.item.params || {}

  if (!params.contId || params.external) {
    return null
  }

  const html = await readPage(ctx, `${BASE}/newsDetail_forward_${params.contId}`)
  const data = nextData(html)
  const detail = data.props?.pageProps?.detailData
  const content = detail?.contentDetail?.content || detail?.liveDetail?.content || detail?.specialDetail?.specialInfo?.content

  if (!content) {
    return null
  }

  return { content }
}
