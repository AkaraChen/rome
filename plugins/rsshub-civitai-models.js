// Ported from RSSHub lib/routes/civitai/models.ts (AGPL-3.0).
// Civitai — 最新模型。
//
// 公开 REST 接口 /api/v1/models 直接给列表，每项的第一个版本带发布时间和
// 预览图。站点自己的 tRPC 接口要求登录，这里不碰。

export const meta = {
  id: 'rome.rsshub-civitai-models',
  name: 'Civitai · 最新模型',
  version: '1.0.0',
  apiVersion: '1',
  view: 'pictures',
  description: '抓取 Civitai 上最新发布的模型',
  icon: 'https://civitai.com/favicon.ico',
}

const IMAGE_LIMIT = 3

function seconds(value) {
  const milliseconds = Date.parse(value)
  return Number.isFinite(milliseconds) ? Math.floor(milliseconds / 1000) : undefined
}

export async function fetch(ctx) {
  const url = 'https://civitai.com/api/v1/models?limit=20&sort=Newest'

  ctx.log.debug(`civitai: GET ${url}`)

  const response = await ctx.fetch(url, { headers: { accept: 'application/json' } })

  if (!response.ok) {
    throw new Error(`Civitai 返回 ${response.status} ${response.statusText}`)
  }

  const body = await response.json()

  if (!Array.isArray(body?.items)) {
    throw new Error('Civitai 接口没有返回 items 数组，接口可能已经变了')
  }

  const entries = []

  for (const model of body.items) {
    if (!model?.id || !model.name) continue

    const version = model.modelVersions?.[0]
    const images = (version?.images ?? []).filter((image) => image?.url).slice(0, IMAGE_LIMIT)

    const entry = {
      id: `civitai:${model.id}`,
      title: model.name,
      url: `https://civitai.com/models/${model.id}`,
    }

    if (model.creator?.username) entry.author = model.creator.username

    const publishedAt = seconds(version?.publishedAt)
    if (publishedAt !== undefined) entry.publishedAt = publishedAt

    if (images.length > 0) entry.image = images[0].url

    if (Array.isArray(model.tags) && model.tags.length > 0) {
      entry.summary = model.tags.join(' · ')
    }

    const gallery = images.map((image) => `<img src="${image.url}">`).join('')
    const description = typeof model.description === 'string' ? model.description : ''
    if (gallery || description) entry.content = `${gallery}${description}`

    entries.push(entry)
  }

  if (entries.length === 0) {
    throw new Error('Civitai 接口没有返回任何模型')
  }

  ctx.log.info(`civitai: ${entries.length} 个模型`)

  return { entries }
}
