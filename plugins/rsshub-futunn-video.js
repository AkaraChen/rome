// Ported from RSSHub lib/routes/futunn/video.ts (AGPL-3.0).
// 富途牛牛视频 — news.futunn.com/main/video-list。
//
// 视频页本身也是 JS 渲染的，但列表接口把标题、摘要、封面和播放页地址都
// 给了，直接用它就够。

export const meta = {
  id: 'rome.rsshub-futunn-video',
  name: '富途牛牛 · 视频',
  version: '1.0.0',
  apiVersion: '1',
  view: 'videos',
  description: '富途牛牛的财经视频',
  icon: 'https://news.futunn.com/favicon.ico',
}

const ROOT = 'https://news.futunn.com'
const LIMIT = 50

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
  const url = `${ROOT}/news-site-api/main/get-video-list?size=${LIMIT}`

  ctx.log.debug(`futunn: GET ${url}`)

  const response = await ctx.fetch(url, { headers: { accept: 'application/json' } })

  if (!response.ok) {
    throw new Error(`富途牛牛视频返回 ${response.status} ${response.statusText}`)
  }

  const body = await response.json()
  const list = body.data?.videoList?.list

  if (!Array.isArray(list)) {
    throw new Error('富途牛牛视频接口没有返回 videoList.list，接口可能已经变了')
  }

  const entries = list.map((item) => {
    const entry = {
      // 视频的 id 是站内的发布时间戳编号。
      id: `futunn:video:${item.id}`,
      title: item.title,
      url: item.targetUrl,
    }

    if (item.source) entry.author = item.source
    if (item.videoImg) entry.image = item.videoImg
    if (item.abstract) entry.content = `<p>${escape(item.abstract)}</p>`

    const publishedAt = seconds(item.timestamp)
    if (publishedAt !== undefined) entry.publishedAt = publishedAt

    return entry
  })

  if (entries.length === 0) {
    throw new Error('富途牛牛视频没有返回任何内容')
  }

  return { entries, icon: `${ROOT}/favicon.ico` }
}
