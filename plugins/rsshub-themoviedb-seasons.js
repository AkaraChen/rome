// Ported from RSSHub lib/routes/themoviedb/seasons.ts (AGPL-3.0).
// The Movie Database 剧集季 — RSSHub 的 /themoviedb/tv/:id/seasons/:lang? 路由。
//
// 剧集详情接口把每一季都列在 seasons 里（季号、播出日期、集数、简介），
// 所以一条条目就是一季。RSSHub 把它当作通知流，这里按列表展示。

export const meta = {
  id: 'rome.rsshub-themoviedb-seasons',
  name: 'The Movie Database · 剧集季',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: 'TMDB 上一部剧集的每一季及其播出信息',
  icon: 'https://www.themoviedb.org/favicon.ico',
  params: {
    fields: [
      {
        key: 'id',
        type: 'text',
        label: '剧集 id',
        help: '可在剧集页网址 https://www.themoviedb.org/tv/<剧集 id> 中找到，例如 1399',
        default: '',
        required: true,
      },
      {
        key: 'lang',
        type: 'text',
        label: '语言',
        help: '如 zh-CN、en-US，见 https://developers.themoviedb.org/3/getting-started/languages',
        default: '',
      },
    ],
  },
}

const API = 'https://api.themoviedb.org/3'
const IMAGE = 'https://image.tmdb.org/t/p/original'
const SITE = 'https://www.themoviedb.org'

// 公开的免费 key，来自 TMDB 的公开示例列表；某个失效了就换下一个。
const KEYS = [
  'fb7bb23f03b6994dafc674c074d01761',
  'e55425032d3d0f371fc776f302e7c09b',
  '8301a21598f8b45668d5711a814f01f6',
  '8cf43ad9c085135b9479ad5cf6bbcbda',
  'da63548086e399ffc910fbc08526df05',
  '13e53ff644a8bd4ba37b3e1044ad24f3',
  '269890f657dddf4635473cf4cf456576',
  'a2f888b27315e62e471b2d587048f32e',
]

/// 一次请求，key 失效时换一个重试。返回解析后的 JSON。
async function request(ctx, path, params) {
  let failure = 'TMDB 没有可用请求'

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const key = KEYS[Math.floor(Math.random() * KEYS.length)]
    const query = new URLSearchParams({ ...params, api_key: key })
    const url = `${API}${path}?${query}`

    ctx.log.debug(`tmdb: GET ${url.replace(key, '…')}`)

    const response = await ctx.fetch(url, { headers: { accept: 'application/json' } })

    if (response.ok) return response.json()

    failure = `TMDB 返回 ${response.status} ${response.statusText}`

    // 只有 key 的问题值得换一个重试，其余状态码换 key 也一样。
    if (response.status !== 401) break
  }

  throw new Error(failure)
}

/// 条目要的是秒，TMDB 给的是「2026-10-19」这样的日期。
function seconds(date) {
  if (!date) return undefined

  const milliseconds = Date.parse(`${date}T00:00:00Z`)

  return Number.isFinite(milliseconds) ? Math.floor(milliseconds / 1000) : undefined
}

/// 季 0 是特别篇，说「第 0 季」不好读。
function seasonLabel(number) {
  return number === 0 ? '特别篇' : `第 ${number} 季`
}

export async function fetch(ctx) {
  const id = String(ctx.params.id ?? '').trim()
  const lang = ctx.params.lang

  if (!id) {
    throw new Error('请填写剧集 id，可在剧集页网址中找到')
  }

  const params = {}
  if (lang) params.language = lang

  const body = await request(ctx, `/tv/${id}`, params)
  const seasons = body.seasons

  if (!Array.isArray(seasons)) {
    throw new Error('TMDB 剧集接口没有返回 seasons 数组，接口可能已经变了')
  }

  const show = (lang ? body.name : body.original_name) || body.name || `剧集 ${id}`
  const entries = []

  for (const season of seasons) {
    if (season.season_number === undefined || season.season_number === null) continue

    const label = seasonLabel(season.season_number)
    const overview = String(season.overview ?? '').trim()

    const entry = {
      id: `tmdb:tv:${body.id ?? id}:season:${season.season_number}`,
      title: `${show} ${label}`,
      url: `${SITE}/tv/${body.id ?? id}/season/${season.season_number}`,
      summary: `${season.episode_count ?? 0} 集`,
      content: `<p>${[label, `${season.episode_count ?? 0} 集`, overview].filter(Boolean).join(' · ')}</p>`,
    }

    if (season.poster_path) entry.image = `${IMAGE}${season.poster_path}`

    const publishedAt = seconds(season.air_date)
    if (publishedAt !== undefined) entry.publishedAt = publishedAt

    entries.push(entry)
  }

  if (entries.length === 0) {
    throw new Error(`TMDB 剧集「${id}」里没有读到任何季，接口可能已经变了`)
  }

  ctx.log.info(`tmdb: 剧集 ${id} ${entries.length} 季`)

  return { entries }
}
