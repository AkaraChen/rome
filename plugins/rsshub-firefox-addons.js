// Ported from RSSHub lib/routes/firefox/addons.ts (AGPL-3.0).
// Firefox 扩展更新 — addons.mozilla.org 的公开 API v5。
//
// 两个请求：扩展本身的元数据，和它的版本列表。版本号是永久标识，所以
// id 用「扩展 id + 版本号」，重发同一版本不会变成新条目。

export const meta = {
  id: 'rome.rsshub-firefox-addons',
  name: 'Mozilla · 扩展更新',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: 'Firefox 扩展的版本更新记录',
  icon: 'https://addons.mozilla.org/favicon.ico',
  params: {
    fields: [
      {
        key: 'id',
        type: 'text',
        label: '扩展 ID',
        help: '扩展页面 URL 中的 id，例如 ublock-origin',
        default: '',
        required: true,
      },
    ],
  },
}

const API = 'https://addons.mozilla.org/api/v5/addons/addon'
const PAGE = 'https://addons.mozilla.org/zh-CN/firefox/addon'

// 名称和说明是多语言的：优先中文，其次英文，再次任意一种。
function localized(value) {
  if (typeof value === 'string') return value
  if (!value || typeof value !== 'object') return undefined
  return value['zh-CN'] ?? value['en-US'] ?? Object.values(value)[0]
}

function seconds(iso) {
  if (!iso) return undefined
  const milliseconds = Date.parse(iso)
  return Number.isFinite(milliseconds) ? Math.floor(milliseconds / 1000) : undefined
}

export async function fetch(ctx) {
  const id = String(ctx.params.id ?? '').trim()

  if (!id) {
    throw new Error('请填写扩展 ID，例如 ublock-origin')
  }

  const slug = encodeURIComponent(id)
  const infoUrl = `${API}/${slug}/?lang=zh-CN`
  const versionsUrl = `${API}/${slug}/versions/?lang=zh-CN`

  ctx.log.debug(`firefox: GET ${infoUrl}`)

  const [infoResponse, versionsResponse] = await Promise.all([
    ctx.fetch(infoUrl, { headers: { accept: 'application/json' } }),
    ctx.fetch(versionsUrl, { headers: { accept: 'application/json' } }),
  ])

  if (!infoResponse.ok) {
    throw new Error(`Firefox 扩展信息返回 ${infoResponse.status} ${infoResponse.statusText}`)
  }
  if (!versionsResponse.ok) {
    throw new Error(`Firefox 扩展版本返回 ${versionsResponse.status} ${versionsResponse.statusText}`)
  }

  const info = await infoResponse.json()
  const versions = await versionsResponse.json()

  if (!Array.isArray(versions.results)) {
    throw new Error('Firefox 扩展接口没有返回 results 数组，接口可能已经变了')
  }

  const link = `${PAGE}/${slug}/versions/`
  const author = Array.isArray(info.authors) ? info.authors.map((a) => a.name).join(', ') : undefined

  const entries = versions.results.map((version) => {
    const entry = {
      // 扩展 id + 版本号，两者都不会被复用。
      id: `firefox:addon:${info.slug ?? id}:${version.version}`,
      title: `v${version.version}`,
      url: link,
    }

    const notes = localized(version.release_notes)
    if (notes) entry.content = notes
    if (author) entry.author = author

    const publishedAt = seconds(version.file?.created)
    if (publishedAt !== undefined) entry.publishedAt = publishedAt

    return entry
  })

  if (entries.length === 0) {
    throw new Error(`Firefox 扩展 ${id} 没有返回任何版本`)
  }

  return {
    entries,
    icon: 'https://addons.mozilla.org/favicon.ico',
  }
}
