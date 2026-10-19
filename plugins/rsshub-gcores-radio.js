// Ported from RSSHub lib/routes/gcores/radio.tsx (AGPL-3.0).
// 机核播客 — /gcores/radios/:category
//
// The category is a numeric id from a category page's URL, and the API answers
// on two different paths depending on it: `/radios` for everything and
// `/categories/<id>/radios` for one category. `all` is this plugin's name for
// the first, as it is in RSSHub.
//
// A radio's description is not a field: it lives in `content`, a string of
// Draft.js block JSON, so the first text block is read out for the summary
// rather than rendering the whole body.

export const meta = {
  id: 'rome.rsshub-gcores-radio',
  name: '机核 · 播客',
  version: '1.0.0',
  apiVersion: '1',
  view: 'audios',
  description: '机核网的播客节目',
  icon: 'https://www.gcores.com/favicon.ico',
  params: {
    fields: [
      {
        key: 'category',
        type: 'text',
        label: '分类',
        help: '分类 ID，可在分类页 URL 中找到，例如 Gadio News 为 45；留空或填 all 为全部',
        placeholder: '45',
        default: 'all',
      },
    ],
  },
}

const HOST = 'https://www.gcores.com'
const IMAGE = 'https://image.gcores.com/'

function firstLine(text, limit) {
  const line = String(text ?? '').replace(/\s+/g, ' ').trim()
  if (!line) return undefined
  return line.length > limit ? `${line.slice(0, limit - 1)}…` : line
}

function cover(value) {
  if (!value) return undefined
  return value.startsWith('http') ? value : `${IMAGE}${value}`
}

/// The body is Draft.js block JSON in a string. Only the first non-atomic
/// block is wanted, so a failed parse is not an error — it just leaves the
/// summary empty.
function firstBlock(content) {
  try {
    const parsed = JSON.parse(content)
    const block = (parsed?.blocks || []).find((item) => item.type === 'unstyled' && String(item.text || '').trim().length > 1)
    return block?.text
  } catch {
    return undefined
  }
}

function includedLookup(included) {
  const map = new Map()
  for (const item of Array.isArray(included) ? included : []) {
    map.set(`${item.type}:${item.id}`, item)
  }
  return map
}

export async function fetch(ctx) {
  const category = String(ctx.params.category || 'all').trim() || 'all'

  const url = category === 'all'
    ? new URL(`${HOST}/gapi/v1/radios`)
    : new URL(`${HOST}/gapi/v1/categories/${encodeURIComponent(category)}/radios`)

  url.searchParams.set('page[limit]', '12')
  url.searchParams.set('sort', '-published-at')
  url.searchParams.set('include', 'media,category')
  url.searchParams.set('filter[list-all]', '0')

  // Gcores answers 406 to an explicit application/json accept header;
  // it wants the wildcard.
  const response = await ctx.fetch(url, { headers: { accept: '*/*' } })

  if (!response.ok) {
    throw new Error(`机核返回 ${response.status}（播客分类 ${category}）`)
  }

  const body = await response.json()

  if (!Array.isArray(body.data)) {
    throw new Error('机核没有返回播客数组，接口可能已经变了')
  }

  const lookup = includedLookup(body.included)

  const entries = body.data.map((item) => {
    const attributes = item.attributes || {}
    const media = lookup.get(`medias:${item.relationships?.media?.data?.id}`)
    const minutes = Number(attributes.duration)

    const entry = {
      id: `gcores:radios:${item.id}`,
      title: attributes.title,
      url: `${HOST}/radios/${item.id}`,
      author: '机核 GCORES',
      summary: firstLine(attributes.desc || attributes.summary || firstBlock(attributes.content), 140) || undefined,
    }

    if (Number.isFinite(minutes) && minutes > 0) {
      entry.summary = [entry.summary, `${Math.round(minutes / 60)} 分钟`].filter(Boolean).join(' · ')
    }

    const image = cover(attributes.cover || attributes.thumb)
    if (image) entry.image = image

    // The enclosure the RSSHub route publishes; a reader that can play audio
    // gets it, and one that cannot ignores the attribute.
    if (media?.attributes?.audio) entry.content = `<audio controls src="${media.attributes.audio}"></audio>`

    const publishedAt = Date.parse(attributes['published-at'] || '')
    if (Number.isFinite(publishedAt)) entry.publishedAt = Math.floor(publishedAt / 1000)

    return entry
  })

  ctx.log.info(`gcores-radio: ${entries.length} 条（分类 ${category}）`)

  return { entries }
}

export async function preview(ctx) {
  const content = await ctx.article(ctx.item.url)
  return content ? { content } : null
}
