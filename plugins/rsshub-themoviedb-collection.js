// Ported from RSSHub lib/routes/themoviedb/collection.ts (AGPL-3.0).
// The Movie Database 系列电影 — RSSHub 的 /themoviedb/collection/:id/:lang? 路由。
//
// 接口一次就把整个系列（name、overview、parts）返回，条目就是 parts 里的每一部，
// 所以不需要再逐部去查。

export const meta = {
  id: 'rome.rsshub-themoviedb-collection',
  name: 'The Movie Database · 系列电影',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: 'TMDB 上一个系列（如漫威电影宇宙）里的全部电影',
  icon: 'https://www.themoviedb.org/favicon.ico',
  params: {
    fields: [
      {
        key: 'id',
        type: 'text',
        label: '系列 id',
        help: '可在系列页网址 https://www.themoviedb.org/collection/<系列 id> 中找到，例如 86311',
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

export async function fetch(ctx) {
  const id = String(ctx.params.id ?? '').trim()
  const lang = ctx.params.lang

  if (!id) {
    throw new Error('请填写系列 id，可在系列页网址中找到')
  }

  const params = {}
  if (lang) params.language = lang

  const body = await request(ctx, `/collection/${id}`, params)
  const parts = body.parts

  if (!Array.isArray(parts)) {
    throw new Error('TMDB 系列接口没有返回 parts 数组，接口可能已经变了')
  }

  const entries = []

  for (const item of parts) {
    if (!item.id) continue

    const entry = {
      id: `tmdb:movie:${item.id}`,
      title: (lang ? item.title : item.original_title) || item.title || item.original_title,
      url: `${SITE}/movie/${item.id}`,
    }

    if (body.name) entry.summary = `${body.name} · 评分 ${item.vote_average ?? 0}`

    const poster = item.poster_path ?? body.poster_path
    if (poster) entry.image = `${IMAGE}${poster}`

    const facts = [`评分 ${item.vote_average ?? 0}`, `${item.vote_count ?? 0} 票`]
    const overview = String(item.overview ?? '').trim()

    if (overview) facts.push(overview)

    entry.content = `<p>${facts.join(' · ')}</p>`

    const publishedAt = seconds(item.release_date)
    if (publishedAt !== undefined) entry.publishedAt = publishedAt

    entries.push(entry)
  }

  if (entries.length === 0) {
    throw new Error(`TMDB 系列「${id}」里没有读到任何电影，接口可能已经变了`)
  }

  ctx.log.info(`tmdb: 系列 ${id} ${entries.length} 条`)

  return { entries }
}
