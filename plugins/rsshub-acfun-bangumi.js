// Ported from RSSHub lib/routes/acfun/bangumi.ts (AGPL-3.0).
// AcFun 番剧 — /bangumi/aa<id>。
//
// 番剧 id 不含开头的 aa：https://www.acfun.cn/bangumi/aa6000617 的 id 是
// 6000617。页面把剧集表写在 window.bangumiList 里，每集一条；正片嵌在
// AcFun 自己的播放器里，所以默认给一个 iframe。

export const meta = {
  id: 'rome.rsshub-acfun-bangumi',
  name: 'AcFun · 番剧',
  version: '1.0.0',
  apiVersion: '1',
  view: 'videos',
  description: 'AcFun 番剧的剧集更新',
  icon: 'https://www.acfun.cn/favicon.ico',
  params: {
    fields: [
      {
        key: 'id',
        type: 'text',
        label: '番剧 ID',
        help: '番剧页面 URL 里的数字，例如 aa6000617 就填 6000617',
        default: '',
        required: true,
      },
      {
        key: 'embed',
        type: 'checkbox',
        label: '内嵌播放器',
        help: '关掉之后只留封面图',
        default: true,
        required: false,
      },
    ],
  },
}

const BASE = 'https://www.acfun.cn'

// 页面把 JSON 直接写在 <script> 里，用括号配平把它整段取出来，
// 比用正则截到第一个 ; 更稳。
function extractJson(html, marker) {
  const at = html.indexOf(marker)
  if (at < 0) return null

  const start = html.indexOf('{', at)
  if (start < 0) return null

  let depth = 0
  let inString = false
  let escaped = false

  for (let i = start; i < html.length; i++) {
    const ch = html[i]

    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }

    if (ch === '"') inString = true
    else if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) {
        try {
          return JSON.parse(html.slice(start, i + 1))
        } catch {
          return null
        }
      }
    }
  }

  return null
}

function seconds(milliseconds) {
  const parsed = Number(milliseconds)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed / 1000) : undefined
}

export async function fetch(ctx) {
  const id = String(ctx.params.id ?? '').trim().replace(/^aa/, '')

  if (!id) {
    throw new Error('请填写番剧 ID，例如 6000617')
  }
  if (!/^\d+$/.test(id)) {
    throw new Error(`番剧 ID ${id} 无效，应为数字`)
  }

  // 复选框关掉时可能是 false、'false' 或 '0'，三种都当成关闭。
  const raw = ctx.params.embed
  const embed = !(raw === false || raw === 'false' || raw === '0' || raw === 0)

  const page = `${BASE}/bangumi/aa${id}`

  ctx.log.debug(`acfun: GET ${page}`)

  const response = await ctx.fetch(page, { headers: { accept: 'text/html' } })

  if (!response.ok) {
    throw new Error(`AcFun 番剧页返回 ${response.status} ${response.statusText}`)
  }

  const html = await response.text()
  const data = extractJson(html, 'window.bangumiData')
  const list = extractJson(html, 'window.bangumiList')

  if (!data || !Array.isArray(list?.items)) {
    throw new Error(`AcFun 番剧 ${id} 页面里没有 window.bangumiData / window.bangumiList，页面结构可能已经改变`)
  }

  const entries = []

  for (const item of list.items) {
    if (!item.itemId) continue

    const title = item.title ? `${item.episodeName} - ${item.title}` : item.episodeName
    const image = item.imgInfo?.thumbnailImage?.cdnUrls?.[0]?.url?.split('?')[0]

    let content
    if (embed) {
      content = `<iframe width="640" height="360" src="${BASE}/player/ac${item.itemId}" frameborder="0" allowfullscreen></iframe>`
      if (image) content += `<p><img src="${image}"></p>`
    } else if (image) {
      content = `<p><img src="${image}"></p>`
    }

    const entry = {
      // 每一集的 itemId 在整站唯一。
      id: `acfun:bangumi:${item.itemId}`,
      title,
      url: `${BASE}/bangumi/aa${id}_36188_${item.itemId}`,
      image,
    }

    if (content) entry.content = content

    const publishedAt = seconds(item.updateTime)
    if (publishedAt !== undefined) entry.publishedAt = publishedAt

    entries.push(entry)
  }

  if (entries.length === 0) {
    throw new Error(`AcFun 番剧 ${id} 没有返回任何剧集`)
  }

  return { entries, icon: `${BASE}/favicon.ico` }
}
