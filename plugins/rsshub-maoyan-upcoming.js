// Ported from RSSHub lib/routes/maoyan/upcoming.ts (AGPL-3.0).
// 猫眼电影 · 即将上映 — ported from RSSHub's /maoyan/upcoming.
//
// Same mobile JSON API as the hot list, different endpoint. `comingTitle` is the
// human date the app shows ("10月20日 周二"); `rt` is the machine date and is
// what the entry sorts on.

export const meta = {
  id: 'rome.rsshub-maoyan-upcoming',
  name: '猫眼电影 · 即将上映',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: '猫眼电影即将上映影片，含主演、上映日期与预售信息',
  icon: 'https://www.maoyan.com/favicon.ico',
}

const API = 'https://m.maoyan.com/ajax/comingList?token='
const SITE = 'https://www.maoyan.com'

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function unixFromCn(value) {
  if (!value) return undefined
  const text = String(value).trim().replace(' ', 'T')
  const iso = /[zZ]$|[+-]\d{2}:?\d{2}$/.test(text) ? text : `${text}+08:00`
  const milliseconds = Date.parse(iso)
  return Number.isFinite(milliseconds) ? Math.floor(milliseconds / 1000) : undefined
}

/// The app asks for a larger cover than the list carries; `w.h` is the
/// placeholder the CDN replaces with real dimensions.
function cover(url) {
  return typeof url === 'string' && url ? url.replace('w.h', '1000.1000') : undefined
}

export async function fetch(ctx) {
  const response = await ctx.fetch(API, { headers: { accept: 'application/json' } })

  if (!response.ok) {
    throw new Error(`猫眼返回 ${response.status} ${response.statusText}`)
  }

  const body = await response.json()
  const movies = body && body.coming

  if (!Array.isArray(movies)) {
    throw new Error('猫眼没有返回 coming，接口可能已经变了')
  }

  const entries = []

  for (const movie of movies) {
    if (!movie || !movie.id || !movie.nm) continue

    const image = cover(movie.img)
    const showInfo = movie.showInfo || movie.comingTitle

    const entry = {
      id: `maoyan:upcoming:${movie.id}`,
      title: [movie.nm, movie.comingTitle].filter(Boolean).join(' '),
      url: `${SITE}/films/${movie.id}`,
      summary: [movie.star, showInfo].filter(Boolean).join(' · '),
      content: [
        image ? `<p><img src="${escapeHtml(image)}" alt="${escapeHtml(movie.nm)}"></p>` : null,
        `<p><strong>${escapeHtml(movie.nm)}</strong></p>`,
        movie.star ? `<p>演员：${escapeHtml(movie.star)}</p>` : null,
        showInfo ? `<p>上映信息：${escapeHtml(showInfo)}</p>` : null,
      ].filter(Boolean).join(''),
    }

    if (image) entry.image = image

    const publishedAt = unixFromCn(movie.rt)
    if (publishedAt !== undefined) entry.publishedAt = publishedAt

    entries.push(entry)
  }

  if (entries.length === 0) {
    throw new Error('猫眼即将上映列表为空，接口可能已经变了')
  }

  ctx.log.info(`maoyan-upcoming: ${entries.length} 条`)

  return { entries, icon: 'https://www.maoyan.com/favicon.ico' }
}

export async function preview(ctx) {
  const url = ctx.item && ctx.item.url
  if (!url) return null

  const content = await ctx.article(url)
  return content === null ? null : { content }
}
