// 哔哩哔哩综合热门 — a fetcher plugin, and the one that shows a cursor.
//
// Bilibili has a real JSON API behind its 热门 tab, so this reads the same list
// the app renders instead of scraping it. What is worth copying is the cursor:
// the ranking has page numbers, so each refresh continues from the last page
// rather than re-reading page one, and the feed deepens over time. When the
// pages run out it starts over, and Rome's id-based dedupe makes the repeat a
// no-op.
//
// It also shows the preview hook. The ranking knows a video's id, its cover and
// its play count; opening one asks this file for the rest — the description,
// the stats, the parts — from the detail endpoint, and hands back a page. The
// host draws it with the same blocks it draws every other body with, so the
// detail view is the app's own typography rather than a second web page.

export const meta = {
  id: 'rome.bilibili-popular',
  name: '哔哩哔哩热门',
  version: '1.1.0',
  apiVersion: '1',
  view: 'videos',
  description: '哔哩哔哩综合热门视频榜，逐页向后抓取，打开后可看详情',
  icon: 'https://www.bilibili.com/favicon.ico',
}

export const settings = {
  fields: [
    { key: 'perPage', type: 'number', label: '每页条数', default: 20, min: 1, max: 50 },
    { key: 'pages', type: 'number', label: '翻到第几页后回到首页', default: 3, min: 1, max: 20 },
  ],
}

const API = 'https://api.bilibili.com/x/web-interface/popular'

/// One video, in full: the description, the counts, and every part of a
/// multi-part upload.
const DETAIL = 'https://api.bilibili.com/x/web-interface/view'

/// Bilibili's headers, which the listing and the detail endpoint agree on.
/// Some of its endpoints gate on the referer, and sending the site's own is
/// cheaper than finding out which ones.
const HEADERS = {
  accept: 'application/json',
  referer: 'https://www.bilibili.com',
}

function integer(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(Math.max(parsed, min), max)
}

/// Bilibili's own way of writing a play count, so the summary reads the way the
/// site does rather than as a seven-digit number.
function count(value) {
  const n = Number(value) || 0
  if (n >= 100000000) return `${(n / 100000000).toFixed(1)} 亿`
  if (n >= 10000) return `${(n / 10000).toFixed(1)} 万`
  return String(n)
}

export async function fetch(ctx) {
  const perPage = integer(ctx.settings.perPage, 20, 1, 50)
  const pages = integer(ctx.settings.pages, 3, 1, 20)

  // `ctx.cursor` is what this function returned last time, or null on the first
  // run. Here it is simply the page to read next.
  const page = integer(ctx.cursor, 1, 1, pages)
  const url = `${API}?ps=${perPage}&pn=${page}`

  ctx.log.debug(`bilibili: GET ${url}`)

  const response = await ctx.fetch(url, { headers: HEADERS })

  if (!response.ok) {
    throw new Error(`哔哩哔哩返回 ${response.status} ${response.statusText}`)
  }

  const body = await response.json()

  // A non-zero `code` rides on an HTTP 200, so `response.ok` is not enough.
  if (body.code !== 0) {
    throw new Error(`哔哩哔哩接口返回 code=${body.code}：${body.message ?? '没有说明'}`)
  }

  const list = body.data?.list

  if (!Array.isArray(list)) {
    throw new Error('哔哩哔哩接口没有返回 data.list 数组，接口可能已经变了')
  }

  // Every video the endpoint returns carries both; one that does not means the
  // contract changed, and an id-less entry would collide with the next one.
  const malformed = list.find((video) => !video.bvid || !video.title)

  if (malformed) {
    throw new Error(`哔哩哔哩返回了一个没有 bvid 或标题的视频（aid=${malformed.aid ?? '未知'}）`)
  }

  const entries = list.map((video) => {
    const entry = {
      // `bvid` is the video's permanent id and the key in its URL, so it is
      // stable for the life of the video.
      id: `bilibili:${video.bvid}`,
      title: video.title,
      url: `https://www.bilibili.com/video/${video.bvid}`,
      author: video.owner?.name,
      // The API hands back an http image; a http image inside an https shell is
      // a mixed-content block, so upgrade it here rather than in the UI.
      image: typeof video.pic === 'string' ? video.pic.replace(/^http:/, 'https:') : undefined,
      summary: `${count(video.stat?.view)} 播放 · ${count(video.stat?.danmaku)} 弹幕 · ${video.tname ?? ''}`.trim(),
      content: video.desc,
      // What `preview` needs to ask for this video rather than the list around
      // it. The host hands it back untouched, so the shape is this file's
      // business alone.
      params: { bvid: video.bvid },
    }

    if (Number.isFinite(Number(video.pubdate))) {
      entry.publishedAt = Number(video.pubdate)
    }

    return entry
  })

  ctx.log.info(`bilibili: 第 ${page}/${pages} 页，${entries.length} 条`)

  return {
    entries,
    // Next page, wrapping to the first once the ranking runs out. Always a
    // cursor, so the feed keeps deepening instead of freezing on page one.
    cursor: String(page >= pages ? 1 : page + 1),
  }
}

/// Escape user text for the page this file builds.
///
/// A description is whatever the uploader typed, so a `<` in it is a `<` rather
/// than the start of a tag — and the host draws this HTML with a stripper that
/// would believe otherwise.
function escape(text) {
  return String(text ?? '').replace(/[&<>"]/g, (ch) => {
    if (ch === '&') return '&amp;'
    if (ch === '<') return '&lt;'
    if (ch === '>') return '&gt;'
    return '&quot;'
  })
}

/// A description as paragraphs. Blank lines are where the split goes, because
/// that is where the uploader put them; a single newline is a line break inside
/// a paragraph, not a new one.
function paragraphs(text) {
  return String(text ?? '')
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => `<p>${escape(part).replace(/\n/g, '<br>')}</p>`)
    .join('')
}

/// `m:ss`, and `h:mm:ss` once a video runs past the hour.
function length(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0))
  const s = total % 60
  const m = Math.floor(total / 60) % 60
  const h = Math.floor(total / 3600)
  const pad = (n) => String(n).padStart(2, '0')

  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}

function day(seconds) {
  const date = new Date(Number(seconds) * 1000)
  const pad = (n) => String(n).padStart(2, '0')

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/// The item's page, drawn from the detail endpoint.
///
/// `ctx.item.params` is what `fetch` attached to the entry, handed back
/// untouched — so the video is asked for by id, and no part of this has to
/// parse a URL the host also had to keep.
export async function preview(ctx) {
  // `params` is the route this file attaches; the id carries the same value in
  // entries listed before this hook existed, so an old entry still opens.
  const bvid = ctx.item?.params?.bvid || String(ctx.item?.id ?? '').replace(/^bilibili:/, '')

  if (!bvid) {
    // Nothing to ask for. The host keeps whatever the list already had.
    return null
  }

  const url = `${DETAIL}?bvid=${encodeURIComponent(bvid)}`

  ctx.log.debug(`bilibili: GET ${url}`)

  const response = await ctx.fetch(url, { headers: HEADERS })

  if (!response.ok) {
    throw new Error(`哔哩哔哩详情返回 ${response.status} ${response.statusText}`)
  }

  const body = await response.json()

  if (body.code !== 0) {
    throw new Error(`哔哩哔哩详情接口返回 code=${body.code}：${body.message ?? '没有说明'}`)
  }

  const video = body.data

  if (!video) {
    return null
  }

  const stat = video.stat ?? {}
  const owner = video.owner ?? {}

  const facts = [
    owner.name ? `UP 主：${escape(owner.name)}` : '',
    `时长：${length(video.duration)}`,
    video.tname ? `分区：${escape(video.tname)}` : '',
    Number.isFinite(Number(video.pubdate)) ? `发布：${day(video.pubdate)}` : '',
    `播放：${count(stat.view)} · 弹幕：${count(stat.danmaku)} · 评论：${count(stat.reply)}`,
    `点赞：${count(stat.like)} · 投币：${count(stat.coin)} · 收藏：${count(stat.favorite)} · 转发：${count(stat.share)}`,
  ].filter(Boolean)

  const parts =
    Array.isArray(video.pages) && video.pages.length > 1
      ? `<h2>分 P</h2><ul>${video.pages
          .map((page) => `<li>P${page.page} · ${escape(page.part)} · ${length(page.duration)}</li>`)
          .join('')}</ul>`
      : ''

  const description = paragraphs(video.desc)
  const intro = description === '' ? '' : `<h2>简介</h2>${description}`

  return {
    content: `<ul>${facts.map((fact) => `<li>${fact}</li>`).join('')}</ul>${intro}${parts}`,
  }
}
