// 哔哩哔哩综合热门 — a fetcher plugin, and the one that shows a cursor.
//
// Bilibili has a real JSON API behind its 热门 tab, so this reads the same list
// the app renders instead of scraping it. What is worth copying is the cursor:
// the ranking has page numbers, so each refresh continues from the last page
// rather than re-reading page one, and the feed deepens over time. When the
// pages run out it starts over, and Rome's id-based dedupe makes the repeat a
// no-op.

export const meta = {
  id: 'rome.bilibili-popular',
  name: '哔哩哔哩热门',
  version: '1.0.0',
  apiVersion: '1',
  view: 'videos',
  description: '哔哩哔哩综合热门视频榜，逐页向后抓取',
}

export const settings = {
  fields: [
    { key: 'perPage', type: 'number', label: '每页条数', default: 20, min: 1, max: 50 },
    { key: 'pages', type: 'number', label: '翻到第几页后回到首页', default: 3, min: 1, max: 20 },
  ],
}

const API = 'https://api.bilibili.com/x/web-interface/popular'

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

  const response = await ctx.fetch(url, {
    headers: {
      accept: 'application/json',
      // Bilibili gates some endpoints on the referer; sending the site's own is
      // cheaper than finding out which ones.
      referer: 'https://www.bilibili.com',
    },
  })

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
