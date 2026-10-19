// Ported from RSSHub lib/routes/firefox/release.ts (AGPL-3.0).
// Firefox 发行说明 — 一个页面就是一条记录。
//
// 版本号在 .c-release-version 里，日期在 .c-release-date 里（例如
// October 13, 2026），正文是 .c-release-notes 这一整节。版本号加平台就是
// 稳定 id：同一份发行说明不会被重复插入。

export const meta = {
  id: 'rome.rsshub-firefox-release',
  name: 'Mozilla · 发行说明',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: 'Firefox 各平台的发行说明',
  icon: 'https://www.mozilla.org/favicon.ico',
  params: {
    fields: [
      {
        key: 'platform',
        type: 'select',
        label: '平台',
        help: '要读哪个通道的发行说明',
        default: 'desktop',
        required: false,
        options: [
          { value: 'desktop', label: '桌面版' },
          { value: 'android', label: 'Android' },
          { value: 'beta', label: 'Beta' },
          { value: 'nightly', label: 'Nightly' },
          { value: 'ios', label: 'iOS' },
        ],
      },
    ],
  },
}

const BASE = 'https://www.mozilla.org/en-US/firefox'

const SLUGS = {
  desktop: 'releasenotes',
  beta: 'beta/notes',
  nightly: 'nightly/notes',
  android: 'android/releasenotes',
  ios: 'ios/notes',
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

function decode(text) {
  return String(text).replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity) => {
    if (entity[0] === '#') {
      const code = entity[1] === 'x' || entity[1] === 'X'
        ? Number.parseInt(entity.slice(2), 16)
        : Number.parseInt(entity.slice(1), 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : match
    }
    return Object.prototype.hasOwnProperty.call(ENTITIES, entity) ? ENTITIES[entity] : match
  })
}

function stripTags(html) {
  return decode(String(html).replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim()
}

function seconds(text) {
  if (!text) return undefined
  const milliseconds = Date.parse(`${text} UTC`)
  return Number.isFinite(milliseconds) ? Math.floor(milliseconds / 1000) : undefined
}

export async function fetch(ctx) {
  const platform = String(ctx.params.platform ?? 'desktop').trim() || 'desktop'

  if (!Object.prototype.hasOwnProperty.call(SLUGS, platform)) {
    throw new Error(`不支持的平台 ${platform}，可选 desktop、android、beta、nightly、ios`)
  }

  const url = `${BASE}/${SLUGS[platform]}`

  ctx.log.debug(`firefox: GET ${url}`)

  const response = await ctx.fetch(url, { headers: { accept: 'text/html' } })

  if (!response.ok) {
    throw new Error(`Firefox 发行说明返回 ${response.status} ${response.statusText}`)
  }

  const html = await response.text()
  const version = /<span class="[^"]*c-release-version[^"]*"[^>]*>([\s\S]*?)<\/span>/.exec(html)
  const date = /<p class="[^"]*c-release-date[^"]*"[^>]*>([\s\S]*?)<\/p>/.exec(html)
  const notes = /<section class="[^"]*c-release-notes[^"]*"[^>]*>([\s\S]*?)<\/section>/.exec(html)
  const canonical = /<link[^>]+rel="canonical"[^>]+href="([^"]+)"/.exec(html)

  const number = version ? stripTags(version[1]) : ''

  if (!number) {
    throw new Error(`Firefox ${platform} 发行说明没有版本号，页面结构可能已经改变`)
  }

  const entry = {
    id: `firefox:release:${platform}:${number}`,
    title: `Firefox ${platform} ${number} 发行说明`,
    url: canonical ? new URL(decode(canonical[1]), url).href : url,
  }

  if (notes && notes[1].trim()) entry.content = notes[1].trim()

  const publishedAt = seconds(date ? stripTags(date[1]) : undefined)
  if (publishedAt !== undefined) entry.publishedAt = publishedAt

  return { entries: [entry], icon: 'https://www.mozilla.org/favicon.ico' }
}
