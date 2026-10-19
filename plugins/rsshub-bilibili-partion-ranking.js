// Ported from RSSHub lib/routes/bilibili/partion-ranking.ts (AGPL-3.0).
// B 站分区视频排行榜 — /bilibili/partion/ranking/:tid/:days
//
// The hot-rank search endpoint is the ranking itself: `time_from`/`time_to` are
// plain YYYYMMDD bounds, so `days` is turned into a window ending today.
//
// The RSSHub route also reads `newlist` once, purely to learn the partition's
// display name. That endpoint now answers with an empty list for most `tid`s,
// so the name is dropped and the id stands in — one fewer request that can
// break.

export const meta = {
  id: 'rome.rsshub-bilibili-partion-ranking',
  name: '哔哩哔哩 · 分区排行榜',
  version: '1.0.0',
  apiVersion: '1',
  view: 'videos',
  description: '哔哩哔哩指定分区最近一段时间的最热视频',
  icon: 'https://www.bilibili.com/favicon.ico',
  params: {
    fields: [
      {
        key: 'tid',
        type: 'text',
        label: '分区 ID',
        help: '分区编号，例如 171 为电子竞技',
        placeholder: '171',
        default: '',
      },
      {
        key: 'days',
        type: 'number',
        label: '统计天数',
        help: '最近多少天内的热度排序，默认为 7',
        default: 7,
      },
      {
        key: 'embed',
        type: 'text',
        label: '内嵌视频',
        help: '留空为开启内嵌视频，任意值则关闭',
        default: '',
      },
    ],
  },
}

const HOST = 'https://www.bilibili.com'

function escape(text) {
  return String(text ?? '').replace(/[&<>"]/g, (ch) => {
    if (ch === '&') return '&amp;'
    if (ch === '<') return '&lt;'
    if (ch === '>') return '&gt;'
    return '&quot;'
  })
}

/// The endpoint wants a bare date, no separators.
function compact(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}${month}${day}`
}

function cover(value) {
  if (!value) return undefined
  return value.startsWith('http') ? value : `https:${value}`
}

export async function fetch(ctx) {
  const tid = String(ctx.params.tid || '').trim()

  if (!/^\d+$/.test(tid)) {
    throw new Error('请填写分区 ID（例如 171）')
  }

  const days = Math.min(Math.max(Number(ctx.params.days) || 7, 1), 365)
  const now = Date.now()

  const url = new URL('https://s.search.bilibili.com/cate/search')
  url.searchParams.set('main_ver', 'v3')
  url.searchParams.set('search_type', 'video')
  url.searchParams.set('view_type', 'hot_rank')
  url.searchParams.set('cate_id', tid)
  url.searchParams.set('time_from', compact(new Date(now - days * 24 * 60 * 60 * 1000)))
  url.searchParams.set('time_to', compact(new Date(now)))

  const response = await ctx.fetch(url, { headers: { referer: `${HOST}/` } })

  if (!response.ok) {
    throw new Error(`Bilibili 返回 ${response.status}（分区 ${tid}）`)
  }

  const body = await response.json()
  const list = body.result

  if (!Array.isArray(list)) {
    throw new Error('Bilibili 没有返回排行榜列表，接口可能已经变了')
  }

  const embed = String(ctx.params.embed || '').trim() === ''

  const entries = list.map((video) => {
    const key = video.bvid || `av${video.id}`
    const url = video.bvid
      ? `https://www.bilibili.com/video/${video.bvid}`
      : `https://www.bilibili.com/video/av${video.id}`

    const entry = {
      id: `bilibili-partion:${key}`,
      title: video.title,
      url,
      author: video.author,
      summary: [video.description, video.tag].filter(Boolean).join(' · ') || undefined,
    }

    const image = cover(video.pic)
    if (image) entry.image = image

    const publishedAt = Number(video.pubdate)
    if (Number.isFinite(publishedAt)) entry.publishedAt = Math.floor(publishedAt)

    if (embed && video.bvid) {
      entry.content = `<iframe src="https://player.bilibili.com/player.html?bvid=${escape(video.bvid)}" allowfullscreen></iframe>`
    }

    return entry
  })

  ctx.log.info(`bilibili-partion: ${entries.length} 条（分区 ${tid}，${days} 天）`)

  return { entries }
}
