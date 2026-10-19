// Ported from OpenCLI clis/tvmaze/search.js (Apache-2.0).
// TVmaze 剧集搜索 — OpenCLI 的 `tvmaze search`.
//
// 公开的 /search/shows 接口，无 key。摘要字段带 HTML，需要先剥标签。
// 移植自 clis/tvmaze/search.js 与 clis/tvmaze/utils.js。

export const meta = {
  id: 'rome.opencli-tvmaze-search',
  name: 'TVmaze · 剧集搜索',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: '按标题搜索电视剧，返回播出状态、电视台和评分。',
  icon: 'https://www.tvmaze.com/favicon.ico',
  params: {
    fields: [
      {
        key: 'query',
        type: 'text',
        label: '关键词',
        help: '剧名或片段，例如 breaking bad',
        default: '',
      },
      {
        key: 'limit',
        type: 'number',
        label: '条数',
        help: '最多 50 条',
        default: 20,
        min: 1,
        max: 50,
      },
    ],
  },
}

const BASE = 'https://api.tvmaze.com'
const UA = 'opencli-tvmaze-adapter (+https://github.com/jackwener/opencli)'

const ENTITY_MAP = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
  hellip: '…',
  ndash: '–',
  mdash: '—',
}

function integer(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(Math.max(parsed, min), max)
}

function stripHtml(html) {
  if (html == null) return ''

  return String(html)
    .replace(/<[^>]+>/g, '')
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => {
      const code = Number.parseInt(hex, 16)
      return Number.isFinite(code) ? String.fromCodePoint(code) : ''
    })
    .replace(/&#(\d+);/g, (_, dec) => {
      const code = Number.parseInt(dec, 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : ''
    })
    .replace(/&([a-zA-Z]+);/g, (match, name) => ENTITY_MAP[name] ?? match)
    .replace(/\s+/g, ' ')
    .trim()
}

export async function fetch(ctx) {
  const query = String(ctx.params?.query ?? '').trim()

  if (!query) {
    throw new Error('请填写要搜索的剧名')
  }

  const limit = integer(ctx.params?.limit, 20, 1, 50)
  const url = `${BASE}/search/shows?q=${encodeURIComponent(query)}`

  ctx.log.debug(`opencli-tvmaze-search: GET ${url}`)

  const response = await ctx.fetch(url, {
    headers: { 'user-agent': UA, accept: 'application/json' },
  })

  if (response.status === 429) {
    throw new Error('TVmaze 触发了限流（HTTP 429），请稍后重试')
  }

  if (!response.ok) {
    throw new Error(`TVmaze 返回 HTTP ${response.status}`)
  }

  const list = await response.json()

  if (!Array.isArray(list) || list.length === 0) {
    throw new Error(`TVmaze 没有找到与 "${query}" 匹配的剧集`)
  }

  const entries = []

  for (const [index, row] of list.slice(0, limit).entries()) {
    const show = row?.show ?? {}
    const id = show.id

    if (typeof id !== 'number' || !show.name) continue

    const network = show.network?.name ?? show.webChannel?.name ?? ''
    const genres = Array.isArray(show.genres) ? show.genres.filter(Boolean).join(', ') : ''
    const rating = show.rating?.average

    const parts = [
      `#${index + 1}`,
      show.type,
      show.language,
      genres,
      show.status,
      show.premiered,
      network,
    ].filter((part) => typeof part === 'string' && part.trim())

    if (rating != null && Number.isFinite(Number(rating))) parts.push(`评分 ${rating}`)

    const entry = {
      // TVmaze 的 show id 是永久编号。
      id: `tvmaze:${id}`,
      title: String(show.name).trim(),
      url: String(show.url ?? `https://www.tvmaze.com/shows/${id}`).trim(),
      summary: parts.join(' · '),
    }

    const image = show.image?.medium || show.image?.original
    if (image) entry.image = image

    // 原摘要是一段 HTML，保留给阅读页；列表只显示上面的元数据。
    if (show.summary) entry.content = show.summary

    entries.push(entry)
  }

  if (entries.length === 0) {
    throw new Error('TVmaze 返回的剧集都缺少 id 或名称')
  }

  ctx.log.info(`opencli-tvmaze-search: ${entries.length} 条（${query}）`)

  return { entries }
}
