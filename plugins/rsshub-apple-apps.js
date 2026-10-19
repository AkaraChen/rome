// Ported from RSSHub lib/routes/apple/apps.ts (AGPL-3.0).
// Apple App Store 更新 — /apple/apps/update/:country/:id/:platform
//
// The App Store's own catalog API, the one the web storefront calls. Its
// `authorization` header is literally the word `Bearer` with no token — the
// endpoint is public, and the header is what its gateway expects.
//
// Two query details matter and both are easy to get wrong: `platform=iphone`
// is what makes the response carry `platformAttributes` at all, and
// `additionalPlatforms` is what makes it carry the other platforms'. Without
// them the app answers with no version history and the feed comes back empty.

export const meta = {
  id: 'rome.rsshub-apple-apps',
  name: 'Apple · App Store 更新',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: 'App Store 应用版本更新记录',
  icon: 'https://www.apple.com/favicon.ico',
  params: {
    fields: [
      {
        key: 'country',
        type: 'text',
        label: '国家或地区',
        help: 'App Store 地区代码，来自应用页面 URL，例如 us、cn',
        placeholder: 'us',
        default: '',
      },
      {
        key: 'id',
        type: 'text',
        label: '应用 ID',
        help: '应用页面 URL 中的 id 数字，例如 GarageBand 为 id408709785',
        placeholder: 'id408709785',
        default: '',
      },
      {
        key: 'platform',
        type: 'select',
        label: '平台',
        help: '默认为全部平台',
        default: 'All',
        options: [
          { value: 'All', label: '全部' },
          { value: 'iOS', label: 'iOS' },
          { value: 'macOS', label: 'macOS' },
          { value: 'tvOS', label: 'tvOS' },
        ],
      },
    ],
  },
}

const API = 'https://apps.apple.com/api/apps/v1/catalog'

// The API's names for the platforms, which are not the ones the option values
// use.
const PLATFORMS = {
  ios: 'ios',
  macos: 'mac',
  tvos: 'appletv',
}

function firstLine(text, limit) {
  const line = String(text ?? '').replace(/\s+/g, ' ').trim()
  if (!line) return undefined
  return line.length > limit ? `${line.slice(0, limit - 1)}…` : line
}

export async function fetch(ctx) {
  const country = String(ctx.params.country || '').trim()
  const id = String(ctx.params.id || '').trim()

  if (!country) {
    throw new Error('请填写 App Store 地区代码（例如 us）')
  }

  if (!id) {
    throw new Error('请填写应用 ID（例如 id408709785）')
  }

  const platform = String(ctx.params.platform || 'All').trim()
  const wanted = PLATFORMS[platform.toLowerCase()]

  const url = new URL(`${API}/${encodeURIComponent(country)}/apps/${encodeURIComponent(id.replace(/^id/, ''))}`)
  url.searchParams.set('platform', 'iphone')
  url.searchParams.set('additionalPlatforms', 'appletv,ipad,iphone,mac,realityDevice,watch')
  url.searchParams.set('extend', 'versionHistory,description')
  url.searchParams.set('l', 'en-US')

  const response = await ctx.fetch(url, {
    headers: {
      authorization: 'Bearer',
      origin: 'https://apps.apple.com',
      accept: 'application/json',
    },
  })

  if (response.status === 404) {
    throw new Error(`App Store 上找不到 ${country} 区的 ${id}`)
  }

  if (!response.ok) {
    throw new Error(`App Store 返回 ${response.status}`)
  }

  const app = (await response.json()).data?.[0]?.attributes

  if (!app) {
    throw new Error('App Store 没有返回应用信息，接口可能已经变了')
  }

  const currentUrl = `https://apps.apple.com/${country}/app/${id}`
  const histories = Object.entries(app.platformAttributes || {})

  if (histories.length === 0) {
    throw new Error('App Store 没有返回版本记录，应用可能尚未发布')
  }

  const entries = []

  for (const [platformId, attribute] of histories) {
    if (wanted && platformId !== wanted) continue

    for (const version of attribute.versionHistory || []) {
      const entry = {
        id: `apple-apps:${country}/${id}/${platformId}#${version.versionDisplay}`,
        title: `${app.name} ${version.versionDisplay}（${platformId}）`,
        url: currentUrl,
        author: app.artistName,
        summary: firstLine(version.releaseNotes, 140) || `版本 ${version.versionDisplay}`,
      }

      const publishedAt = Date.parse(version.releaseTimestamp || '')
      if (Number.isFinite(publishedAt)) entry.publishedAt = Math.floor(publishedAt / 1000)

      entries.push(entry)
    }
  }

  entries.sort((a, b) => (b.publishedAt || 0) - (a.publishedAt || 0))

  ctx.log.info(`apple-apps: ${entries.length} 条（${country}/${id}，${platform}）`)

  return { entries }
}
