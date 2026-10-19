// Ported from RSSHub lib/routes/bilibili/weekly-recommend.ts (AGPL-3.0).
// B 站每周必看 — /bilibili/weekly
//
// The app API the H5 weekly page calls. First request names the current issue,
// second one lists it; the `number` from the first is what the second needs, so
// the two cannot be reordered.
//
// A video is addressed by `bvid` when the site has one and by its numeric
// `aid` otherwise — old issues predate `bvid`, and the URL differs for them.

export const meta = {
  id: 'rome.rsshub-bilibili-weekly-recommend',
  name: '哔哩哔哩 · 每周必看',
  version: '1.0.0',
  apiVersion: '1',
  view: 'videos',
  description: '哔哩哔哩每周必看榜单',
  icon: 'https://www.bilibili.com/favicon.ico',
  params: {
    fields: [
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

const API = 'https://app.bilibili.com/x/v2/show/popular/selected'
const REFERER = 'https://www.bilibili.com/h5/weekly-recommend'

function escape(text) {
  return String(text ?? '').replace(/[&<>"]/g, (ch) => {
    if (ch === '&') return '&amp;'
    if (ch === '<') return '&lt;'
    if (ch === '>') return '&gt;'
    return '&quot;'
  })
}

/// The weekly list gives the cover as a bare host-less path, and the page
/// cannot resolve one, so it is made absolute here.
function cover(value) {
  if (!value) return undefined
  return value.startsWith('http') ? value : `https:${value}`
}

export async function fetch(ctx) {
  const response = await ctx.fetch(`${API}/series?type=weekly_selected`, { headers: { referer: REFERER } })

  if (!response.ok) {
    throw new Error(`Bilibili 返回 ${response.status}（每周必看期号）`)
  }

  const series = (await response.json()).data

  if (!Array.isArray(series) || !series[0]?.number) {
    throw new Error('Bilibili 没有返回每周必看期号，接口可能已经变了')
  }

  const number = series[0].number
  const name = series[0].name || `第 ${number} 期`

  const listResponse = await ctx.fetch(`${API}?type=weekly_selected&number=${number}`, {
    headers: { referer: `${REFERER}?num=${number}&navhide=1` },
  })

  if (!listResponse.ok) {
    throw new Error(`Bilibili 返回 ${listResponse.status}（每周必看第 ${number} 期）`)
  }

  const list = (await listResponse.json()).data?.list

  if (!Array.isArray(list)) {
    throw new Error('Bilibili 没有返回每周必看列表，接口可能已经变了')
  }

  const embed = String(ctx.params.embed || '').trim() === ''

  const entries = list.map((video) => {
    const key = video.bvid || `av${video.param}`
    const url = video.bvid
      ? `https://www.bilibili.com/video/${video.bvid}`
      : `https://www.bilibili.com/video/av${video.param}`

    const entry = {
      id: `bilibili-weekly:${key}`,
      title: video.title,
      url,
      author: video.right_desc_1 || undefined,
      summary: [name, video.rcmd_reason].filter(Boolean).join(' · ') || undefined,
    }

    const image = cover(video.cover)
    if (image) entry.image = image

    if (embed && video.bvid) {
      entry.content = `<iframe src="https://player.bilibili.com/player.html?bvid=${escape(video.bvid)}" allowfullscreen></iframe>`
    }

    return entry
  })

  ctx.log.info(`bilibili-weekly: ${entries.length} 条（第 ${number} 期）`)

  return { entries }
}
