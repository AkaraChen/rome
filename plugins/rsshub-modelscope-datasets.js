// Ported from RSSHub lib/routes/modelscope/datasets.ts (AGPL-3.0).
// ModelScope 魔搭社区 · 数据集 — ported from RSSHub's /modelscope/datasets.
//
// The dataset index is a public JSON endpoint (`/api/v1/dolphin/datasets`), so
// the list itself is one request. The readme behind each dataset is a second
// request that RSSHub made for every row; here it is the entry's `preview`,
// which runs only when someone opens the entry.

export const meta = {
  id: 'rome.rsshub-modelscope-datasets',
  name: 'ModelScope 魔搭社区 · 数据集',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: '魔搭社区最新数据集，含作者、标签与说明',
  icon: 'https://modelscope.cn/favicon.ico',
}

const BASE = 'https://modelscope.cn'
const LIST = `${BASE}/api/v1/dolphin/datasets?PageSize=36&PageNumber=1&Target=&Sort=gmt_modified`

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

/// The API hands back `GmtCreate` as unix seconds, not milliseconds.
function unixFromSeconds(value) {
  const seconds = Number(value)
  return Number.isFinite(seconds) ? Math.floor(seconds) : undefined
}

function paragraphText(value) {
  const text = String(value ?? '').trim()
  if (!text) return ''
  return text
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${escapeHtml(paragraph.trim())}</p>`)
    .join('')
}

export async function fetch(ctx) {
  const response = await ctx.fetch(LIST, {
    headers: { accept: 'application/json', referer: `${BASE}/datasets` },
  })

  if (!response.ok) {
    throw new Error(`魔搭返回 ${response.status} ${response.statusText}`)
  }

  const body = await response.json()
  const datasets = body && body.Data

  if (!Array.isArray(datasets)) {
    throw new Error('魔搭没有返回数据集列表，接口可能已经变了')
  }

  const entries = []

  for (const dataset of datasets) {
    if (!dataset || !dataset.Namespace || !dataset.Name) continue

    const tags = typeof dataset.UserDefineTags === 'string' ? dataset.UserDefineTags.split(',').filter(Boolean) : []

    const entry = {
      id: `modelscope:dataset:${dataset.Namespace}/${dataset.Name}`,
      title: dataset.ChineseName || dataset.Name,
      url: `${BASE}/datasets/${dataset.Namespace}/${dataset.Name}`,
      author: dataset.CreatedBy || undefined,
      summary: [dataset.Description, tags.length > 0 ? tags.join(' · ') : null].filter(Boolean).join(' · ') || undefined,
      params: { slug: `/${dataset.Namespace}/${dataset.Name}` },
    }

    const publishedAt = unixFromSeconds(dataset.GmtCreate)
    if (publishedAt !== undefined) entry.publishedAt = publishedAt

    entries.push(entry)
  }

  if (entries.length === 0) {
    throw new Error('魔搭数据集列表为空，接口可能已经变了')
  }

  ctx.log.info(`modelscope-datasets: ${entries.length} 条`)

  return { entries, icon: 'https://modelscope.cn/favicon.ico' }
}

/// The dataset's README, fetched only when the entry is opened. The endpoint is
/// the one the site's own page calls; the body is Markdown, so it is shown as
/// plain paragraphs rather than pretending to render it.
export async function preview(ctx) {
  const slug = ctx.item && ctx.item.params && ctx.item.params.slug
  if (!slug) return null

  const response = await ctx.fetch(`${BASE}/api/v1/datasets${slug}`, {
    headers: { accept: 'application/json', referer: `${BASE}/datasets${slug}` },
  })

  if (!response.ok) {
    throw new Error(`魔搭返回 ${response.status} ${response.statusText}`)
  }

  const body = await response.json()
  const readme = body && body.Data && body.Data.ReadmeContent

  if (typeof readme !== 'string' || readme.trim() === '') return null

  return { content: paragraphText(readme) }
}
