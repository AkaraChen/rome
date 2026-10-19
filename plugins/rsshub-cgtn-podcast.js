// Ported from RSSHub lib/routes/cgtn/podcast.ts (AGPL-3.0).
// CGTN 播客 — the radio site publishes a static JSON episode list per
// program. Category and program id come from the podcast page URL.

export const meta = {
  id: 'rome.rsshub-cgtn-podcast',
  name: '中国环球电视网 · 播客',
  version: '1.0.0',
  apiVersion: '1',
  view: 'audios',
  description: 'CGTN 广播播客的节目更新',
  icon: 'https://www.cgtn.com/favicon.ico',
  params: {
    fields: [
      {
        key: 'category',
        type: 'select',
        label: '类型名',
        help: '可在播客对应的 URL 中找到，例如 ezfm',
        default: '',
        options: [
          { value: 'ezfm', label: '轻松调频' },
          { value: 'other', label: '其他' },
        ],
      },
      {
        key: 'id',
        type: 'text',
        label: '播客 ID',
        help: '可在播客对应的 URL 中找到，例如 4',
        default: '',
      },
    ],
  },
}

const CATEGORIES = { ezfm: 1, other: 5 }

function seconds(date, time) {
  const day = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(date ?? ''))
  if (!day) return undefined

  const clock = /(\d{1,2}):(\d{2})/.exec(String(time ?? ''))
  const hour = clock ? Number(clock[1]) : 0
  const minute = clock ? Number(clock[2]) : 0

  // The programme clock is China Standard Time.
  return Math.floor(Date.UTC(
    Number(day[1]),
    Number(day[2]) - 1,
    Number(day[3]),
    hour - 8,
    minute,
  ) / 1000)
}

// The episode page slug is the title with everything but ASCII letters,
// digits and dashes removed, the same shape the site itself builds.
function slug(title) {
  const text = String(title ?? '')
    .replace(/ /g, '-')
    .replace(/[^a-z0-9-]+/gi, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')

  return text || 'radio-cgtn'
}

export async function fetch(ctx) {
  const category = String(ctx.params.category ?? '').trim()
  const id = String(ctx.params.id ?? '').trim()

  if (!category) {
    throw new Error('缺少类型名：可在播客对应的 URL 中找到，例如 ezfm')
  }

  if (!Object.prototype.hasOwnProperty.call(CATEGORIES, category)) {
    throw new Error(`不支持的类型名 ${category}：可选值为 ezfm、other`)
  }

  if (!id) {
    throw new Error('缺少播客 ID：可在播客对应的 URL 中找到，例如 4')
  }

  if (!/^[1-9]\d*$/.test(id)) {
    throw new Error(`播客 ID 应为正整数，收到 ${id}`)
  }

  const code = CATEGORIES[category]
  const url = `https://radio.cgtn.com/downapiRES/radio/v1/program/historyList/programId${id}_category${code}_page1.json`

  ctx.log.debug(`cgtn-podcast: GET ${url}`)

  const response = await ctx.fetch(url, { headers: { accept: 'application/json' } })

  if (!response.ok) {
    throw new Error(`CGTN 广播返回 ${response.status} ${response.statusText}`)
  }

  const body = await response.json()
  const episodes = body?.data

  if (!Array.isArray(episodes)) {
    throw new Error('CGTN 广播没有返回节目列表，接口可能已经变了')
  }

  const entries = episodes.map((item) => {
    const entry = {
      // One episode per program per day; both together are the stable key.
      id: `cgtn:podcast:${item.programId}:${item.showDate}`,
      title: item.title,
      url: `https://radio.cgtn.com/podcast/news/${code}/${slug(item.title)}/${item.programId}`,
    }

    if (item.duration) entry.summary = `时长 ${item.duration}`

    const detail = item.programSeries?.content || item.detail || ''
    const audio = item.mediaUrl ? `<p><a href="${item.mediaUrl}">收听音频</a></p>` : ''
    if (detail || audio) entry.content = `<p>${detail}</p>${audio}`

    const publishedAt = seconds(item.showDate, item.time)
    if (publishedAt !== undefined) entry.publishedAt = publishedAt

    return entry
  }).filter((entry) => entry.title)

  if (entries.length === 0) {
    throw new Error('CGTN 广播没有返回可解析的节目，接口可能已经变了')
  }

  ctx.log.info(`cgtn-podcast: ${category}/${id} ${entries.length} 期`)

  return { entries, icon: 'https://www.cgtn.com/favicon.ico' }
}
