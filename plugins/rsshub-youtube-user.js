// Ported from RSSHub lib/routes/youtube/user.ts (AGPL-3.0).
/**
 * YouTube -- Channel with user handle.
 *
 * A handle has to be resolved to its channel id first. The channel page still
 * carries that id in its initial data, so the page is read once and the same
 * public browse call is used afterwards.
 */

export const meta = {
  id: 'rome.rsshub-youtube-user',
  name: 'YouTube · 用户频道',
  version: '1.0.0',
  apiVersion: '1',
  view: 'videos',
  description: '按 @ 名称读取 YouTube 频道的最新视频',
  icon: 'https://www.youtube.com/favicon.ico',
  params: {
    fields: [
      {
        key: 'username',
        type: 'text',
        label: '频道名称',
        help: '包含 @ 的频道名称，例如 @JFlaMusic',
        required: true,
        default: ''
      },
      {
        key: 'routeParams',
        type: 'text',
        label: '附加参数',
        help: '兼容旧路由的 embed 与 filterShorts 参数；公共浏览接口不区分短视频，此参数会被忽略',
        default: ''
      }
    ]
  }
};

const ENDPOINT = 'https://www.youtube.com/youtubei/v1/browse?prettyPrint=false'
const PLAYER = 'https://www.youtube.com/youtubei/v1/player?prettyPrint=false'
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36'
const CLIENT = { clientName: 'WEB', clientVersion: '2.20240101.00.00', hl: 'en', gl: 'US' }

function relativeDate(text) {
  const match = /(\d+)\s+(second|minute|hour|day|week|month|year)s?\s+ago/i.exec(String(text || ''))

  if (!match) {
    return undefined
  }

  const units = { second: 1, minute: 60, hour: 3600, day: 86400, week: 604800, month: 2592000, year: 31536000 }
  return Math.floor(Date.now() / 1000) - Number(match[1]) * units[match[2].toLowerCase()]
}

function escapeHtml(text) {
  return String(text == null ? '' : text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function collectLockups(node, found) {
  if (Array.isArray(node)) {
    for (const child of node) {
      collectLockups(child, found)
    }
    return
  }

  if (!node || typeof node !== 'object') {
    return
  }

  if (node.lockupViewModel?.contentId) {
    found.push(node.lockupViewModel)
    return
  }

  for (const value of Object.values(node)) {
    collectLockups(value, found)
  }
}

function findRenderer(node, key) {
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = findRenderer(child, key)

      if (hit) {
        return hit
      }
    }
    return undefined
  }

  if (!node || typeof node !== 'object') {
    return undefined
  }

  if (node[key]) {
    return node[key]
  }

  for (const value of Object.values(node)) {
    const hit = findRenderer(value, key)

    if (hit) {
      return hit
    }
  }

  return undefined
}

function toEntry(lockup) {
  const metadata = lockup.metadata?.lockupMetadataViewModel
  const videoId = lockup.contentId
  const rows = metadata?.metadata?.contentMetadataViewModel?.metadataRows || []
  const parts = rows.flatMap((row) => row.metadataParts || []).map((part) => part.text?.content).filter(Boolean)
  const sources = lockup.contentImage?.thumbnailViewModel?.image?.sources || []
  const image = sources.length > 0 ? sources[sources.length - 1].url : `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`

  const entry = {
    id: `youtube:${videoId}`,
    title: metadata?.title?.content || `YouTube ${videoId}`,
    url: `https://www.youtube.com/watch?v=${videoId}`,
    image,
    params: { videoId }
  }

  if (parts.length > 0) {
    entry.author = parts[0]
  }

  if (parts.length > 1) {
    entry.summary = parts.slice(1).join(' · ')
  }

  const published = parts.find((part) => /ago$/i.test(part))

  if (published) {
    const timestamp = relativeDate(published)

    if (timestamp !== undefined) {
      entry.publishedAt = timestamp
    }
  }

  return entry
}

async function resolveChannelId(ctx, username) {
  const response = await ctx.fetch(`https://www.youtube.com/${username}`, { headers: { 'user-agent': USER_AGENT } })

  if (!response.ok) {
    throw new Error(`youtube: ${username} returned ${response.status} ${response.statusText}`)
  }

  const html = await response.text()
  const match = /"externalId":"(UC[\w-]{21}[AQgw])"/.exec(html) || /"channelId":"(UC[\w-]{21}[AQgw])"/.exec(html)

  if (!match) {
    throw new Error(`youtube: could not find a channel id for ${username}`)
  }

  return match[1]
}

export async function fetch(ctx) {
  let username = String(ctx.params.username || '').trim()

  if (!username) {
    throw new Error('youtube: 频道名称不能为空，例如 @JFlaMusic')
  }

  if (!username.startsWith('@') && !/^UC[\w-]{21}[AQgw]$/.test(username)) {
    username = `@${username}`
  }

  const channelId = /^UC[\w-]{21}[AQgw]$/.test(username) ? username : await resolveChannelId(ctx, username)

  // The Videos tab of a channel.
  const response = await ctx.fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': USER_AGENT },
    body: { context: { client: CLIENT }, browseId: channelId, params: 'EgZ2aWRlb3PyBgQKAjoA' }
  })

  if (!response.ok) {
    throw new Error(`youtube: channel ${channelId} returned ${response.status} ${response.statusText}`)
  }

  const text = await response.text()
  let data

  try {
    data = JSON.parse(text)
  } catch (error) {
    throw new Error(`youtube: channel ${channelId} did not return JSON: ${error.message}`)
  }

  const lockups = []
  collectLockups(data, lockups)

  if (lockups.length === 0) {
    throw new Error(`youtube: channel ${channelId} returned no videos; the response shape changed`)
  }

  const seen = new Set()
  const entries = []

  for (const lockup of lockups) {
    if (seen.has(lockup.contentId)) {
      continue
    }

    seen.add(lockup.contentId)
    entries.push(toEntry(lockup))
  }

  const channel = findRenderer(data, 'channelMetadataRenderer')

  return {
    entries,
    icon: channel?.avatar?.thumbnails?.at(-1)?.url || 'https://www.youtube.com/favicon.ico'
  }
}

export async function preview(ctx) {
  const videoId = ctx.item.params?.videoId

  if (!videoId) {
    return null
  }

  const response = await ctx.fetch(PLAYER, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': USER_AGENT },
    body: { context: { client: CLIENT }, videoId }
  })

  if (!response.ok) {
    throw new Error(`youtube: player ${videoId} returned ${response.status} ${response.statusText}`)
  }

  const data = await response.json()
  const description = data?.videoDetails?.shortDescription

  if (!description) {
    return null
  }

  const paragraphs = description.split(/\n{2,}/).map((part) => `<p>${escapeHtml(part).replace(/\n/g, '<br>')}</p>`).join('')

  return { content: paragraphs }
}
