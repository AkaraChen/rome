// Ported from RSSHub lib/routes/gelonghui/live.tsx (AGPL-3.0).
// 格隆汇快讯 — the 7x24 live feed is one JSON endpoint; each item already
// carries its own text and pictures, so there is no preview hook.

export const meta = {
  id: 'rome.rsshub-gelonghui-live',
  name: '格隆汇 · 实时快讯',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: '格隆汇 7x24 小时的实时财经快讯',
  icon: 'https://www.gelonghui.com/favicon.ico'
}

const API = 'https://www.gelonghui.com/api/live-channels/all/lives/v4'

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
  const response = await ctx.fetch(API, { headers: { accept: 'application/json' } })

  if (!response.ok) {
    throw new Error(`格隆汇返回 ${response.status} ${response.statusText}`)
  }

  const payload = await response.json()
  const list = payload?.result

  if (!Array.isArray(list)) {
    throw new Error('格隆汇快讯接口没有返回条目列表')
  }

  const entries = list.map((item) => {
    const title = item.title || plain(item.content, 80) || '（快讯）'
    const entry = {
      id: `gelonghui:live:${item.id}`,
      title,
      url: item.route || 'https://www.gelonghui.com/live'
    }

    if (item.source) {
      entry.author = item.source
    }

    const pictures = Array.isArray(item.pictures) ? item.pictures.filter(Boolean) : []
    const content = `${item.contentPrefix ? `<p>${escapeHtml(item.contentPrefix)}</p>` : ''}${item.content ? `<p>${escapeHtml(item.content)}</p>` : ''}${pictures.map((url) => `<img src="${url}">`).join('')}`

    if (content) {
      entry.content = content
    }

    const summary = plain(item.content, 200)
    if (summary) {
      entry.summary = summary
    }

    if (pictures[0]) {
      entry.image = pictures[0]
    }

    const publishedAt = Number(item.createTimestamp)
    if (Number.isFinite(publishedAt) && publishedAt > 0) {
      entry.publishedAt = Math.floor(publishedAt)
    }

    return entry
  })

  return { entries }
}
