// Ported from RSSHub lib/routes/themoviedb/trending.ts (AGPL-3.0).
// The Movie Database 趋势榜 — RSSHub 的 /themoviedb/trending/:mediaType/:timeWindow/:lang? 路由。
//
// TMDB 的 v3 接口只要一个 api_key，不要登录，所以这里带一组公开的免费 key，
// 每次随机取一个；401 就换一个再试。接口返回的就是完整条目：标题、简介、
// 评分、海报，一次请求就够。

export const meta = {
  id: 'rome.rsshub-themoviedb-trending',
  name: 'The Movie Database · 趋势榜',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: 'TMDB 上每日或每周的电影与剧集趋势榜',
  icon: 'https://www.themoviedb.org/favicon.ico',
  params: {
    fields: [
      {
        key: 'mediaType',
        type: 'select',
        label: '媒体类型',
        help: '电影或剧集',
        default: '',
        required: true,
        options: [
          { value: 'movie', label: '电影' },
          { value: 'tv', label: '剧集' },
        ],
      },
      {
        key: 'timeWindow',
        type: 'select',
        label: '时间范围',
        help: '日榜或周榜',
        default: '',
        required: true,
        options: [
          { value: 'day', label: '今日' },
          { value: 'week', label: '本周' },
        ],
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

function handle(ctx, item, mediaType, lang) {
  const localised = mediaType === 'movie' ? item.title : item.name
  const original = mediaType === 'movie' ? item.original_title : item.original_name
  const date = mediaType === 'movie' ? item.release_date : item.first_air_date
  const poster = item.poster_path ?? item.backdrop_path

  const entry = {
    id: `tmdb:${mediaType}:${item.id}`,
    title: (lang ? localised : original) || localised || original,
    url: `${SITE}/${mediaType}/${item.id}`,
    summary: `评分 ${item.vote_average ?? 0} · ${item.vote_count ?? 0} 票`,
  }

  if (poster) entry.image = `${IMAGE}${poster}`

  const overview = String(item.overview ?? '').trim()
  const facts = [`评分 ${item.vote_average ?? 0}`, `${item.vote_count ?? 0} 票`]

  if (overview) facts.push(overview)

  entry.content = `<p>${facts.join(' · ')}</p>`

  const publishedAt = seconds(date)
  if (publishedAt !== undefined) entry.publishedAt = publishedAt

  return entry
}

export async function fetch(ctx) {
  const mediaType = ctx.params.mediaType
  const timeWindow = ctx.params.timeWindow
  const lang = ctx.params.lang

  if (mediaType !== 'movie' && mediaType !== 'tv') {
    throw new Error(`请填写媒体类型：movie 或 tv（收到「${mediaType ?? ''}」）`)
  }

  if (timeWindow !== 'day' && timeWindow !== 'week') {
    throw new Error(`请填写时间范围：day 或 week（收到「${timeWindow ?? ''}」）`)
  }

  const params = {}
  if (lang) params.language = lang

  const body = await request(ctx, `/trending/${mediaType}/${timeWindow}`, params)
  const results = body.results

  if (!Array.isArray(results)) {
    throw new Error('TMDB 趋势榜没有返回 results 数组，接口可能已经变了')
  }

  const entries = results.filter((item) => item.id).map((item) => handle(ctx, item, mediaType, lang))

  if (entries.length === 0) {
    throw new Error('TMDB 趋势榜没有读到任何条目，接口可能已经变了')
  }

  ctx.log.info(`tmdb: 趋势 ${mediaType}/${timeWindow} ${entries.length} 条`)

  return { entries }
}
