// Ported from RSSHub lib/routes/maoyan/hot.ts (AGPL-3.0).
// 猫眼电影 · 正在热映 — ported from RSSHub's /maoyan/hot.
//
// The mobile site answers a plain JSON list at `movieOnInfoList`, which is why
// this route needs no browser and no cookie: the same endpoint the phone app
// calls is open to anyone. `rt` is the release date, not a publication time,
// but it is the only date the list carries and it sorts the way a reader
// expects a film list to sort.

export const meta = {
  id: 'rome.rsshub-maoyan-hot',
  name: '猫眼电影 · 正在热映',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: '猫眼电影正在热映影片，含评分、主演、想看人数与排片信息',
  icon: 'https://www.maoyan.com/favicon.ico',
}

const API = 'https://m.maoyan.com/ajax/movieOnInfoList'
const SITE = 'https://www.maoyan.com'

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

/// `rt` is a Beijing-time date such as `2026-10-01` with no offset. `Date.parse`
/// would read it as UTC, which is eight hours off; say so explicitly instead.
function unixFromCn(value) {
  if (!value) return undefined
  const text = String(value).trim().replace(' ', 'T')
  const iso = /[zZ]$|[+-]\d{2}:?\d{2}$/.test(text) ? text : `${text}+08:00`
  const milliseconds = Date.parse(iso)
  return Number.isFinite(milliseconds) ? Math.floor(milliseconds / 1000) : undefined
}

export async function fetch(ctx) {
  const response = await ctx.fetch(API, { headers: { accept: 'application/json' } })

  if (!response.ok) {
    throw new Error(`猫眼返回 ${response.status} ${response.statusText}`)
  }

  const body = await response.json()
  const movies = body && body.movieList

  if (!Array.isArray(movies)) {
    throw new Error('猫眼没有返回 movieList，接口可能已经变了')
  }

  const entries = []

  for (const movie of movies) {
    if (!movie || !movie.id || !movie.nm) continue

    const summary = [movie.sc ? `${movie.sc} 分` : null, movie.star, movie.wish ? `${movie.wish} 人想看` : null, movie.showInfo].filter(Boolean).join(' · ')

    const entry = {
      id: `maoyan:hot:${movie.id}`,
      title: movie.sc ? `[${movie.sc}分] ${movie.nm}` : movie.nm,
      url: `${SITE}/films/${movie.id}`,
      summary,
      content: [
        movie.img ? `<p><img src="${escapeHtml(movie.img)}" alt="${escapeHtml(movie.nm)}"></p>` : null,
        `<p><strong>${escapeHtml(movie.nm)}</strong></p>`,
        movie.sc ? `<p>评分：${escapeHtml(movie.sc)}</p>` : null,
        movie.star ? `<p>主演：${escapeHtml(movie.star)}</p>` : null,
        movie.wish ? `<p>想看人数：${escapeHtml(movie.wish)}</p>` : null,
        movie.showInfo ? `<p>${escapeHtml(movie.showInfo)}</p>` : null,
      ].filter(Boolean).join(''),
    }

    if (movie.img) entry.image = movie.img

    const publishedAt = unixFromCn(movie.rt)
    if (publishedAt !== undefined) entry.publishedAt = publishedAt

    entries.push(entry)
  }

  if (entries.length === 0) {
    throw new Error('猫眼正在热映列表为空，接口可能已经变了')
  }

  ctx.log.info(`maoyan-hot: ${entries.length} 条`)

  return { entries, icon: 'https://www.maoyan.com/favicon.ico' }
}

export async function preview(ctx) {
  const url = ctx.item && ctx.item.url
  if (!url) return null

  const content = await ctx.article(url)
  return content === null ? null : { content }
}
