// Ported from RSSHub lib/routes/cctv/lm.ts (AGPL-3.0).
// 央视栏目 — every column page embeds its own column id (TOPC…), which the
// video API takes as the only argument. The playable stream is looked up by
// preview, because it needs a second request per entry.

export const meta = {
  id: 'rome.rsshub-cctv-lm',
  name: '央视新闻 · 栏目',
  version: '1.0.0',
  apiVersion: '1',
  view: 'videos',
  description: '央视各电视栏目的最新视频',
  icon: 'https://tv.cctv.com/favicon.ico',
  params: {
    fields: [
      {
        key: 'id',
        type: 'text',
        label: '栏目名',
        help: '可在对应栏目页 URL 中找到，例如 xwzk、xwlb、jrzx',
        default: 'xwzk',
      },
    ],
  },
}

const LIMIT = 20

const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  ndash: '–', mdash: '—', hellip: '…', lsquo: '‘', rsquo: '’',
  ldquo: '“', rdquo: '”', middot: '·',
}

function decode(text) {
  return String(text).replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (match, entity) => {
    if (entity[0] === '#') {
      const code = entity[1] === 'x' || entity[1] === 'X'
        ? Number.parseInt(entity.slice(2), 16)
        : Number.parseInt(entity.slice(1), 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : match
    }
    return Object.prototype.hasOwnProperty.call(ENTITIES, entity) ? ENTITIES[entity] : match
  })
}

function plain(html) {
  return decode(String(html ?? '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim()
}

// The API prints China Standard Time without a zone.
function seconds(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(String(value ?? ''))
  if (!match) return undefined

  const milliseconds = Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]) - 8,
    Number(match[5]),
    Number(match[6] || 0),
  )

  return Number.isFinite(milliseconds) ? Math.floor(milliseconds / 1000) : undefined
}

function videoId(url) {
  const name = String(url ?? '').split('/').pop() || ''
  return name.replace(/\.s?html?$/, '')
}

// The column id is written into the page as a TOPC… token; the page itself
// has no other machine-readable index.
async function columnId(ctx, id) {
  for (const path of [`/lm/${id}/videoset/index.shtml`, `/lm/${id}/videoset`]) {
    const response = await ctx.fetch(`https://tv.cctv.com${path}`, { headers: { accept: 'text/html' } })
    if (!response.ok) continue

    const topId = /TOPC\d{10,20}/.exec(await response.text())?.[0]
    if (topId) return topId
  }

  return ''
}

export async function fetch(ctx) {
  const id = String(ctx.params.id ?? '').trim() || 'xwzk'

  if (!/^[a-z0-9]+$/i.test(id)) {
    throw new Error(`栏目名应为字母或数字，收到 ${id}`)
  }

  const topId = await columnId(ctx, id)

  if (!topId) {
    throw new Error(`没有在 ${id} 栏目页找到栏目编号，栏目名可能有误或页面结构已经变了`)
  }

  const url = `https://api.cntv.cn/NewVideo/getVideoListByColumn?id=${topId}&n=${LIMIT}&sort=desc&p=1&mode=0&serviceId=tvcctv`
  ctx.log.debug(`cctv-lm: GET ${url}`)

  const response = await ctx.fetch(url, { headers: { accept: 'application/json' } })

  if (!response.ok) {
    throw new Error(`央视视频接口返回 ${response.status} ${response.statusText}`)
  }

  const body = await response.json()

  // The tvcctv service returns the payload as a JSON string inside data.
  let data = body?.data
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data)
    } catch {
      throw new Error('央视视频接口的 data 无法解析，接口可能已经变了')
    }
  }

  const list = data?.list

  if (!Array.isArray(list)) {
    throw new Error('央视视频接口没有返回视频列表，接口可能已经变了')
  }

  const entries = list.map((item) => {
    const guid = item.guid || item.videoCenterId || videoId(item.url)
    const brief = plain(item.brief)

    const entry = {
      // The video's guid is the pid every CCTV player API is keyed on.
      id: `cctv:lm:${guid}`,
      title: item.title,
      url: item.url || `https://tv.cctv.com/${id}`,
      summary: brief,
      // preview needs the pid and the poster again; both are free here.
      params: { guid, brief, image: item.image || '' },
    }

    if (item.image) entry.image = item.image
    if (brief) entry.content = `<p>${brief}</p>`

    const publishedAt = seconds(item.time || item.focus_date)
    if (publishedAt !== undefined) entry.publishedAt = publishedAt

    return entry
  }).filter((entry) => entry.title && entry.params.guid)

  if (entries.length === 0) {
    throw new Error('央视视频接口没有返回可解析的视频，接口可能已经变了')
  }

  ctx.log.info(`cctv-lm: ${id} ${entries.length} 条`)

  return { entries, icon: 'https://tv.cctv.com/favicon.ico' }
}

export async function preview(ctx) {
  const params = ctx.item?.params ?? {}
  const guid = params.guid || videoId(ctx.item?.url)

  if (!guid) return null

  const url = `https://vdn.apps.cntv.cn/api/getHttpVideoInfo.do?pid=${guid}`
  const response = await ctx.fetch(url, { headers: { accept: 'application/json' } })

  if (!response.ok) return null

  let body
  try {
    body = await response.json()
  } catch {
    return null
  }

  // hls_url is the stream the site's own player uses; the mp4 chapter is the
  // fallback for players without HLS.
  const stream = body?.hls_url || body?.video?.chapters?.[0]?.url
  if (!stream) return null

  const brief = plain(body?.brief || params.brief)
  const poster = body?.image || params.image

  return {
    content: `${brief ? `<p>${brief}</p>` : ''}<video src="${stream}" controls${poster ? ` poster="${poster}"` : ''}></video>`,
  }
}
