// Ported from RSSHub lib/routes/gcores/videos.ts (AGPL-3.0).
// 机核视频 — /gcores/videos
//
// The video list is the same JSON:API shape as articles, on a `videos`
// resource. The cover field is `thumb` for videos, where articles have both.

export const meta = {
  id: 'rome.rsshub-gcores-videos',
  name: '机核 · 视频',
  version: '1.0.0',
  apiVersion: '1',
  view: 'videos',
  description: '机核网的视频节目',
  icon: 'https://www.gcores.com/favicon.ico',
}

const API = 'https://www.gcores.com/gapi/v1/videos'
const HOST = 'https://www.gcores.com'
const IMAGE = 'https://image.gcores.com/'

function firstLine(text, limit) {
  const line = String(text ?? '').replace(/\s+/g, ' ').trim()
  if (!line) return undefined
  return line.length > limit ? `${line.slice(0, limit - 1)}…` : line
}

function cover(value) {
  if (!value) return undefined
  return value.startsWith('http') ? value : `${IMAGE}${value}`
}

function includedLookup(included) {
  const map = new Map()
  for (const item of Array.isArray(included) ? included : []) {
    map.set(`${item.type}:${item.id}`, item)
  }
  return map
}

export async function fetch(ctx) {
  const url = new URL(API)
  url.searchParams.set('page[limit]', '30')
  url.searchParams.set('sort', '-published-at')
  url.searchParams.set('include', 'category,user,media')
  url.searchParams.set('filter[list-all]', '1')

  // Gcores answers 406 to an explicit application/json accept header;
  // it wants the wildcard.
  const response = await ctx.fetch(url, { headers: { accept: '*/*' } })

  if (!response.ok) {
    throw new Error(`机核返回 ${response.status}`)
  }

  const body = await response.json()

  if (!Array.isArray(body.data)) {
    throw new Error('机核没有返回视频数组，接口可能已经变了')
  }

  const lookup = includedLookup(body.included)

  const entries = body.data.map((item) => {
    const attributes = item.attributes || {}
    const author = lookup.get(`users:${item.relationships?.user?.data?.id}`)
    const minutes = Number(attributes.duration)

    const entry = {
      id: `gcores:videos:${item.id}`,
      title: attributes.title,
      url: `${HOST}/videos/${item.id}`,
      author: author?.attributes?.nickname,
      summary: firstLine(attributes.excerpt || attributes.desc, 140) || undefined,
    }

    if (Number.isFinite(minutes) && minutes > 0) {
      entry.summary = [entry.summary, `${Math.round(minutes / 60)} 分钟`].filter(Boolean).join(' · ')
    }

    const image = cover(attributes.thumb || attributes.cover)
    if (image) entry.image = image

    const publishedAt = Date.parse(attributes['published-at'] || '')
    if (Number.isFinite(publishedAt)) entry.publishedAt = Math.floor(publishedAt / 1000)

    return entry
  })

  ctx.log.info(`gcores-videos: ${entries.length} 条`)

  return { entries }
}

export async function preview(ctx) {
  const content = await ctx.article(ctx.item.url)
  return content ? { content } : null
}
