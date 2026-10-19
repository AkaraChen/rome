// Ported from RSSHub lib/routes/modelscope/models.ts (AGPL-3.0).
// ModelScope 魔搭社区 · 模型库 — ported from RSSHub's /modelscope/models.
//
// The model index is a POST/PUT JSON endpoint (`/api/v1/dolphin/models`); the
// list arrives complete enough to build entries, and the README behind each
// model is left to `preview` so a refresh is one request rather than thirty.

export const meta = {
  id: 'rome.rsshub-modelscope-models',
  name: 'ModelScope 魔搭社区 · 模型库',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: '魔搭社区最新模型，含发布组织、任务类型与标签',
  icon: 'https://modelscope.cn/favicon.ico',
}

const BASE = 'https://modelscope.cn'
const LIST = `${BASE}/api/v1/dolphin/models`

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

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
    method: 'PUT',
    headers: { accept: 'application/json', referer: `${BASE}/models` },
    body: { PageSize: 36, PageNumber: 1, SortBy: 'GmtModified', Target: '', SingleCriterion: [] },
  })

  if (!response.ok) {
    throw new Error(`魔搭返回 ${response.status} ${response.statusText}`)
  }

  const body = await response.json()
  const models = body && body.Data && body.Data.Model && body.Data.Model.Models

  if (!Array.isArray(models)) {
    throw new Error('魔搭没有返回模型列表，接口可能已经变了')
  }

  const entries = []

  for (const model of models) {
    if (!model || !model.Path || !model.Name) continue

    const tasks = Array.isArray(model.Tasks) ? model.Tasks.map((task) => task && task.ChineseName).filter(Boolean) : []
    const tags = Array.isArray(model.Tags) ? model.Tags : []

    const entry = {
      id: `modelscope:model:${model.Path}/${model.Name}`,
      title: model.ChineseName || model.Name,
      url: `${BASE}/models/${model.Path}/${model.Name}`,
      author: model.Organization && model.Organization.FullName ? model.Organization.FullName : undefined,
      summary: [model.Description, [...new Set([...tasks, ...tags])].join(' · ')].filter(Boolean).join(' · ') || undefined,
      params: { slug: `/${model.Path}/${model.Name}` },
    }

    const publishedAt = unixFromSeconds(model.CreatedTime)
    if (publishedAt !== undefined) entry.publishedAt = publishedAt

    entries.push(entry)
  }

  if (entries.length === 0) {
    throw new Error('魔搭模型列表为空，接口可能已经变了')
  }

  ctx.log.info(`modelscope-models: ${entries.length} 条`)

  return { entries, icon: 'https://modelscope.cn/favicon.ico' }
}

export async function preview(ctx) {
  const slug = ctx.item && ctx.item.params && ctx.item.params.slug
  if (!slug) return null

  const response = await ctx.fetch(`${BASE}/api/v1/models${slug}`, {
    headers: { accept: 'application/json', referer: `${BASE}/models${slug}` },
  })

  if (!response.ok) {
    throw new Error(`魔搭返回 ${response.status} ${response.statusText}`)
  }

  const body = await response.json()
  const readme = body && body.Data && body.Data.ReadMeContent

  if (typeof readme !== 'string' || readme.trim() === '') return null

  return { content: paragraphText(readme) }
}
