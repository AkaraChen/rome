// Ported from RSSHub lib/routes/163/ds.tsx (AGPL-3.0).
// 网易大神用户发帖 — the feed endpoint returns each post's body as a JSON
// string, so the text and its images come back in one request.

export const meta = {
  id: 'rome.rsshub-163-ds',
  name: '网易公开课 · 用户发帖',
  version: '1.0.0',
  apiVersion: '1',
  view: 'socialMedia',
  description: '网易大神用户的动态发帖',
  icon: 'https://ds.163.com/favicon.ico',
  params: {
    fields: [
      {
        key: 'id',
        type: 'text',
        label: '用户 ID',
        help: '可在用户主页 URL 中找到，例如 63dfbaf4117741daaf73404601165843',
        required: true,
        default: ''
      }
    ]
  }
}

const API = 'https://inf.ds.163.com/v1/web/feed/basic/getSomeOneFeeds'
const FEED_TYPES = '1,2,3,4,6,7,10,11'

function escapeHtml(text) {
  return String(text == null ? '' : text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

function plain(text, limit) {
  const value = String(text == null ? '' : text).replace(/\s+/g, ' ').trim()
  if (!limit || value.length <= limit) return value
  return `${value.slice(0, limit).replace(/\s+$/, '')}…`
}

export async function fetch(ctx) {
  const id = String(ctx.params.id || '').trim()

  if (!id) {
    throw new Error('网易大神用户 ID 不能为空，请在用户主页 URL 中查找')
  }

  const url = `${API}?feedTypes=${FEED_TYPES}&someOneUid=${encodeURIComponent(id)}`
  const response = await ctx.fetch(url, { headers: { accept: 'application/json' } })

  if (!response.ok) {
    throw new Error(`网易大神返回 ${response.status} ${response.statusText}`)
  }

  const payload = await response.json()
  const feeds = payload?.result?.feeds
  const nick = payload?.result?.userInfos?.[0]?.user?.nick

  if (!Array.isArray(feeds)) {
    throw new Error(`网易大神用户 ${id} 没有返回动态`)
  }

  const entries = []

  for (const feed of feeds) {
    let body

    try {
      body = JSON.parse(feed.content)?.body
    } catch {
      body = undefined
    }

    const text = body?.text || ''
    const media = Array.isArray(body?.media) ? body.media : []
    const images = media.filter((item) => String(item.mimeType || '').startsWith('image/') && item.url)

    const content = `${text ? `<p>${escapeHtml(text).replaceAll('\n', '<br>')}</p>` : ''}${images.map((item) => `<img src="${item.url}">`).join('')}`

    const entry = {
      id: `163:ds:${feed.id}`,
      title: plain(text, 100) || '（图片动态）',
      url: `https://ds.163.com/feed/${feed.id}`
    }

    if (nick) {
      entry.author = nick
    }

    if (content) {
      entry.content = content
    }

    const summary = plain(text, 200)
    if (summary) {
      entry.summary = summary
    }

    if (images[0]) {
      entry.image = images[0].url
    }

    const publishedAt = Number(feed.updateTime)

    if (Number.isFinite(publishedAt) && publishedAt > 0) {
      entry.publishedAt = Math.floor(publishedAt / 1000)
    }

    entries.push(entry)
  }

  return { entries }
}
