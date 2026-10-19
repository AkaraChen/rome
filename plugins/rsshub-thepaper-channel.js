// Ported from RSSHub lib/routes/thepaper/channel.ts (AGPL-3.0).
/**
 * 澎湃新闻 -- 频道.
 *
 * The channel feed is a public POST endpoint; the page itself is only needed
 * for the channel name, so the plugin does without it and uses the channel id.
 */

export const meta = {
  id: 'rome.rsshub-thepaper-channel',
  name: '澎湃新闻 · 频道',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: '按频道 id 读取澎湃新闻的频道内容',
  icon: 'https://www.thepaper.cn/favicon.ico',
  params: {
    fields: [
      {
        key: 'id',
        type: 'text',
        label: '频道 id',
        help: '可在频道页 URL 中找到，例如 25950 是时事',
        required: true,
        default: ''
      }
    ]
  }
};

const MOBILE_UA = 'Mozilla/5.0 (Linux; Android 10; Pixel 3) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Mobile Safari/537.36'
const API = 'https://api.thepaper.cn/contentapi/nodeCont/getByChannelId'
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

  if (item.nodeInfo?.name) {
    entry.summary = item.nodeInfo.name
  }

  if (item.pic) {
    entry.image = item.pic
  }

  return entry
}

async function readPage(ctx, url) {
  const response = await ctx.fetch(url, { headers: { 'user-agent': MOBILE_UA } })

  if (!response.ok) {
    throw new Error(`thepaper: ${url} returned ${response.status} ${response.statusText}`)
  }

  return response.text()
}

export async function fetch(ctx) {
  const id = String(ctx.params.id || '').trim()

  if (!id) {
    throw new Error('thepaper: 频道 id 不能为空，请在频道页 URL 中查找')
  }

  const response = await ctx.fetch(API, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: { channelId: id }
  })

  if (!response.ok) {
    throw new Error(`thepaper: channel ${id} returned ${response.status} ${response.statusText}`)
  }

  const payload = await response.json()
  const list = payload?.data?.list

  if (!Array.isArray(list)) {
    throw new Error(`thepaper: channel ${id} did not return data.list`)
  }

  return {
    entries: list.map(toEntry).filter(Boolean),
    icon: payload?.data?.nodeInfo?.pic || undefined
  }
}

export async function preview(ctx) {
  const params = ctx.item.params || {}

  if (!params.contId || params.external) {
    return null
  }

  const html = await readPage(ctx, `${BASE}/newsDetail_forward_${params.contId}`)
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
