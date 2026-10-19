// Ported from RSSHub lib/routes/thepaper/sidebar.ts (AGPL-3.0).
/**
 * 澎湃新闻 -- 侧边栏.
 *
 * One public JSON endpoint serves all four sidebars; the sec parameter picks
 * which array to read.
 */

export const meta = {
  id: 'rome.rsshub-thepaper-sidebar',
  name: '澎湃新闻 · 侧边栏',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: '澎湃新闻首页侧边栏的热榜、快讯、早晚报与要闻精选',
  icon: 'https://www.thepaper.cn/favicon.ico',
  params: {
    fields: [
      {
        key: 'sec',
        type: 'select',
        label: '侧边栏',
        help: '选择要读取的侧边栏栏目',
        default: 'hotNews',
        options: [
          { value: 'hotNews', label: '澎湃热榜' },
          { value: 'financialInformationNews', label: '澎湃快讯' },
          { value: 'morningEveningNews', label: '早晚报' },
          { value: 'editorHandpicked', label: '要闻精选' }
        ]
      }
    ]
  }
};

const MOBILE_UA = 'Mozilla/5.0 (Linux; Android 10; Pixel 3) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Mobile Safari/537.36'
const API = 'https://cache.thepaper.cn/contentapi/wwwIndex/rightSidebar'
const BASE = 'https://m.thepaper.cn'

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

  if (!contId) {
    return null
  }

  const entry = {
    id: `thepaper:${contId}`,
    title: item.name || '（无标题）',
    url: `${BASE}/newsDetail_forward_${contId}`,
    params: { contId }
  }

  const author = item.author || item.authorInfo?.sname || item.trackAuthor

  if (author) {
    entry.author = author
  }

  const publishedAt = parseDate(item.pubTimeLong) ?? parseDate(item.publishTime) ?? parseDate(item.pubTime)

  if (publishedAt !== undefined) {
    entry.publishedAt = publishedAt
  }

  if (item.nodeInfo?.name) {
    entry.summary = item.nodeInfo.name
  }

  if (item.pic) {
    entry.image = item.pic
  }

  return entry
}

export async function fetch(ctx) {
  const sec = String(ctx.params.sec || 'hotNews')

  const response = await ctx.fetch(API, { headers: { 'user-agent': MOBILE_UA } })

  if (!response.ok) {
    throw new Error(`thepaper: the sidebar returned ${response.status} ${response.statusText}`)
  }

  const payload = await response.json()
  const list = payload?.data?.[sec]

  if (!Array.isArray(list)) {
    throw new Error(`thepaper: the sidebar does not contain ${sec}`)
  }

  return { entries: list.map(toEntry).filter(Boolean) }
}

export async function preview(ctx) {
  const contId = ctx.item.params?.contId

  if (!contId) {
    return null
  }

  const response = await ctx.fetch(`${BASE}/newsDetail_forward_${contId}`, { headers: { 'user-agent': MOBILE_UA } })

  if (!response.ok) {
    throw new Error(`thepaper: article ${contId} returned ${response.status} ${response.statusText}`)
  }

  const html = await response.text()
  const match = /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/.exec(html)

  if (!match) {
    throw new Error('thepaper: __NEXT_DATA__ was not found on the article page')
  }

  let data

  try {
    data = JSON.parse(match[1])
  } catch (error) {
    throw new Error(`thepaper: article data is not valid JSON: ${error.message}`)
  }

  const detail = data.props?.pageProps?.detailData
  const content = detail?.contentDetail?.content || detail?.liveDetail?.content || detail?.specialDetail?.specialInfo?.content

  return content ? { content } : null
}
