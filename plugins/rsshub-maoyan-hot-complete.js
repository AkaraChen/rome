// Ported from RSSHub lib/routes/maoyan/hot-complete.ts (AGPL-3.0).
// 猫眼电影 · 正在热映（完整版） — ported from RSSHub's /maoyan/hotComplete.
//
// `movieOnInfoList` returns only the first ten films plus the full id list, so
// the rest are read ten at a time from `moreComingList`. The site answers that
// endpoint with whatever ids it was given, so the batches are merged back and
// deduplicated by film id rather than trusted to be disjoint.

export const meta = {
  id: 'rome.rsshub-maoyan-hot-complete',
  name: '猫眼电影 · 正在热映（完整版）',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: '猫眼正在热映完整榜单，可按评分或上映时间排序并截取前若干条',
  icon: 'https://www.maoyan.com/favicon.ico',
  params: {
    fields: [
      {
        key: 'orderby',
        type: 'select',
        label: '排序条件',
        help: 'score: 按评分，pubDate: 按发布时间；留空保持站内顺序',
        default: '',
        options: [
          { value: '', label: '默认（站内顺序）' },
          { value: 'score', label: '评分' },
          { value: 'pubDate', label: '发布时间' },
        ],
      },
      {
        key: 'ascOrDesc',
        type: 'select',
        label: '排序方向',
        help: 'asc: 正序，desc: 倒序，默认倒序',
        default: 'desc',
        options: [
          { value: 'desc', label: '倒序' },
          { value: 'asc', label: '正序' },
        ],
      },
      {
        key: 'top',
        type: 'number',
        label: '取前多少条',
        help: '0 表示取全部，默认 0',
        default: 0,
        min: 0,
      },
    ],
  },
}

const LIST_API = 'https://m.maoyan.com/ajax/movieOnInfoList'
const MORE_API = 'https://m.maoyan.com/ajax/moreComingList'
const SITE = 'https://www.maoyan.com'
const BATCH = 10

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

function integer(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(Math.max(parsed, min), max)
}

function toEntry(movie) {
  const rating = movie.sc > 0 ? `评分：${movie.sc}` : null
  const image = typeof movie.img === 'string' ? movie.img.replace('w.h', '1000.1000') : undefined

  const entry = {
    id: `maoyan:hot-complete:${movie.id}`,
    title: [movie.nm, rating].filter(Boolean).join(' '),
    url: `${SITE}/films/${movie.id}`,
    summary: [rating, movie.star, movie.showInfo].filter(Boolean).join(' · '),
    content: [
      image ? `<p><img src="${escapeHtml(image)}" alt="${escapeHtml(movie.nm)}"></p>` : null,
      `<p><strong>${escapeHtml(movie.nm)}</strong></p>`,
      rating ? `<p>${escapeHtml(rating)}</p>` : null,
      movie.star ? `<p>演员：${escapeHtml(movie.star)}</p>` : null,
      movie.showInfo ? `<p>上映信息：${escapeHtml(movie.showInfo)}</p>` : null,
    ].filter(Boolean).join(''),
  }

  if (image) entry.image = image

  const publishedAt = unixFromCn(movie.rt)
  if (publishedAt !== undefined) entry.publishedAt = publishedAt

  return entry
}

export async function fetch(ctx) {
  const response = await ctx.fetch(LIST_API, { headers: { accept: 'application/json' } })

  if (!response.ok) {
    throw new Error(`猫眼返回 ${response.status} ${response.statusText}`)
  }

  const first = await response.json()
  const movieIds = Array.isArray(first && first.movieIds) ? first.movieIds : []
  const movies = Array.isArray(first && first.movieList) ? [...first.movieList] : []

  if (!Array.isArray(first && first.movieList)) {
    throw new Error('猫眼没有返回 movieList，接口可能已经变了')
  }

  const rest = movieIds.slice(movies.length)

  for (let offset = 0; offset < rest.length; offset += BATCH) {
    const ids = rest.slice(offset, offset + BATCH).join(',')
    const url = `${MORE_API}?movieIds=${encodeURIComponent(ids)}&token=`
    const more = await ctx.fetch(url, { headers: { accept: 'application/json' } })

    if (!more.ok) {
      throw new Error(`猫眼返回 ${more.status} ${more.statusText}`)
    }

    const body = await more.json()
    if (Array.isArray(body && body.coming)) {
      movies.push(...body.coming)
    }
  }

  // `moreComingList` can echo films the first page already listed; the id map
  // is what keeps one film from becoming two entries.
  const seen = new Map()
  for (const movie of movies) {
    if (!movie || !movie.id || !movie.nm) continue
    if (!seen.has(movie.id)) seen.set(movie.id, movie)
  }

  let list = [...seen.values()]

  const orderby = ctx.params.orderby
  if (orderby === 'score' || orderby === 'pubDate') {
    const direction = ctx.params.ascOrDesc === 'asc' ? 1 : -1
    list = list.sort((a, b) => {
      if (orderby === 'pubDate') {
        return (unixFromCn(a.rt) ?? 0) * direction - (unixFromCn(b.rt) ?? 0) * direction
      }
      return ((a.sc ?? 0) - (b.sc ?? 0)) * direction
    })
  }

  const top = integer(ctx.params.top, 0, 0, Number.MAX_SAFE_INTEGER)
  if (top > 0) list = list.slice(0, top)

  const entries = list.map(toEntry)

  if (entries.length === 0) {
    throw new Error('猫眼正在热映列表为空，接口可能已经变了')
  }

  ctx.log.info(`maoyan-hot-complete: ${entries.length} 条`)

  return { entries, icon: 'https://www.maoyan.com/favicon.ico' }
}

export async function preview(ctx) {
  const url = ctx.item && ctx.item.url
  if (!url) return null

  const content = await ctx.article(url)
  return content === null ? null : { content }
}
