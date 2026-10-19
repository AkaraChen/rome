// Ported from RSSHub lib/routes/nintendo/direct.ts (AGPL-3.0).
// Nintendo Direct — /nintendo/direct
//
// The archive page is Next.js and ships its whole Apollo cache inside
// `__NEXT_DATA__` as one JSON script tag. Everything the route needs is in
// there: the name, the start time, the slug and the thumbnail's Cloudinary
// public id — no article fetch, no HTML parsing.
//
// The cache also holds non-Direct entries, so the filter is the shape of the
// record rather than its position: name, slug and start date together.

export const meta = {
  id: 'rome.rsshub-nintendo-direct',
  name: 'Nintendo · Direct',
  version: '1.0.0',
  apiVersion: '1',
  view: 'videos',
  description: '任天堂直面会的日程信息',
  icon: 'https://www.nintendo.com/favicon.ico',
}

const HOST = 'https://www.nintendo.com'
const ARCHIVE = `${HOST}/nintendo-direct/archive/`

function firstLine(text, limit) {
  const line = String(text ?? '').replace(/\s+/g, ' ').trim()
  if (!line) return undefined
  return line.length > limit ? `${line.slice(0, limit - 1)}…` : line
}

/// The description is a rich-text document: paragraphs, each with inline
/// parts. Only the text is wanted.
function paragraphText(description) {
  const nodes = description?.json?.content
  if (!Array.isArray(nodes)) return undefined

  const text = nodes
    .map((node) => (node.content || []).map((part) => part.value || '').join(''))
    .filter(Boolean)
    .join(' ')

  return firstLine(text, 140)
}

export async function fetch(ctx) {
  const response = await ctx.fetch(ARCHIVE, { headers: { accept: 'text/html' } })

  if (!response.ok) {
    throw new Error(`Nintendo 返回 ${response.status}`)
  }

  const html = await response.text()
  const script = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/)

  if (!script) {
    throw new Error('Nintendo 页面里找不到 __NEXT_DATA__，页面结构可能已经变了')
  }

  const data = JSON.parse(script[1])
  const state = data.props?.pageProps?.initialApolloState

  if (!state || typeof state !== 'object') {
    throw new Error('Nintendo 页面里找不到 Apollo 缓存，页面结构可能已经变了')
  }

  const entries = []

  for (const item of Object.values(state)) {
    if (!item?.name || !item?.slug || !item?.startDate) continue

    const entry = {
      id: `nintendo-direct:${item.id}`,
      title: item.name,
      url: `${HOST}/nintendo-direct/${item.slug}/`,
      author: 'Nintendo',
      summary: paragraphText(item.description),
    }

    if (item.thumbnail?.publicId) {
      entry.image = `https://assets.nintendo.com/image/upload/${item.thumbnail.publicId}`
    }

    const publishedAt = Date.parse(item.startDate)
    if (Number.isFinite(publishedAt)) entry.publishedAt = Math.floor(publishedAt / 1000)

    entries.push(entry)
  }

  if (entries.length === 0) {
    throw new Error('Nintendo 没有解析出直面会信息，页面结构可能已经变了')
  }

  entries.sort((a, b) => (b.publishedAt || 0) - (a.publishedAt || 0))

  ctx.log.info(`nintendo-direct: ${entries.length} 场`)

  return { entries }
}
