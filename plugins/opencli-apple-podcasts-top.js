// Ported from OpenCLI clis/apple-podcasts/top.js (Apache-2.0).
// Apple Podcasts 热门榜 — OpenCLI 的 `apple-podcasts top`.
//
// Apple Marketing Tools 的公开榜单接口，无 key。
// 移植自 clis/apple-podcasts/top.js。

export const meta = {
  id: 'rome.opencli-apple-podcasts-top',
  name: 'Apple Podcasts · 热门榜',
  version: '1.0.0',
  apiVersion: '1',
  view: 'audios',
  description: 'Apple Podcasts 各国家或地区的热门播客榜。',
  icon: 'https://podcasts.apple.com/favicon.ico',
  params: {
    fields: [
      {
        key: 'limit',
        type: 'number',
        label: '条数',
        help: '最多 100 条',
        default: 20,
        min: 1,
        max: 100,
      },
      {
        key: 'country',
        type: 'text',
        label: '国家或地区',
        help: '两位国家代码，例如 us、cn、gb、jp',
        default: 'us',
      },
    ],
  },
}

const CHARTS = 'https://rss.marketingtools.apple.com/api/v2'

function integer(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(Math.max(parsed, min), max)
}

function country(value) {
  const code = String(value ?? 'us').trim().toLowerCase() || 'us'

  if (!/^[a-z]{2}$/.test(code)) {
    throw new Error(`Apple Podcasts 国家代码必须是两位字母（当前为 "${value}"）`)
  }

  return code
}

export async function fetch(ctx) {
  const limit = integer(ctx.params?.limit, 20, 1, 100)
  const cc = country(ctx.params?.country)

  const url = `${CHARTS}/${cc}/podcasts/top/${limit}/podcasts.json`

  ctx.log.debug(`opencli-apple-podcasts-top: GET ${url}`)

  const response = await ctx.fetch(url, { headers: { accept: 'application/json' } })

  if (!response.ok) {
    throw new Error(`Apple Podcasts 榜单返回 HTTP ${response.status}，请检查国家代码 ${cc}`)
  }

  const data = await response.json()
  const results = data?.feed?.results

  if (!Array.isArray(results) || results.length === 0) {
    throw new Error(`Apple Podcasts 没有 ${cc.toUpperCase()} 的榜单数据，换一个国家试试`)
  }

  const entries = []

  for (const [index, podcast] of results.slice(0, limit).entries()) {
    const id = podcast?.id == null ? '' : String(podcast.id).trim()

    // 榜单可能夹带没有 id 的推广位，它们无法稳定去重。
    if (!id || !podcast.name) continue

    const genres = Array.isArray(podcast.genres)
      ? podcast.genres.map((genre) => genre?.name).filter(Boolean).join(', ')
      : ''

    const parts = [`#${index + 1}`]
    if (genres) parts.push(genres)

    const entry = {
      id: `apple:${id}`,
      title: String(podcast.name),
      url: podcast.url || `https://podcasts.apple.com/${cc}/podcast/id${id}`,
      summary: parts.join(' · '),
    }

    if (podcast.artistName) entry.author = String(podcast.artistName)
    if (podcast.artworkUrl100) entry.image = podcast.artworkUrl100

    entries.push(entry)
  }

  if (entries.length === 0) {
    throw new Error('Apple Podcasts 榜单返回的播客都缺少 id 或标题')
  }

  ctx.log.info(`opencli-apple-podcasts-top: ${entries.length} 条（${cc}）`)

  return { entries }
}
