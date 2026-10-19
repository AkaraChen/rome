// Ported from RSSHub lib/routes/spotify/artist.ts (AGPL-3.0).
/**
 * Spotify -- Artist.
 *
 * The Web API's album listing needs a client id and secret, which a plugin
 * cannot ask for. The public artist embed carries the artist's top tracks
 * instead, so this route publishes those.
 */

export const meta = {
  id: 'rome.rsshub-spotify-artist',
  name: 'Spotify · Artist',
  version: '1.0.0',
  apiVersion: '1',
  view: 'audios',
  description: '读取 Spotify 艺人的热门曲目',
  icon: 'https://open.spotify.com/favicon.ico',
  params: {
    fields: [
      {
        key: 'id',
        type: 'text',
        label: '艺人 id',
        help: '可在艺人分享链接中找到，例如 6k9TBCxyr4bXwZ8Y21Kwn1',
        required: true,
        default: ''
      }
    ]
  }
};

const SITE = 'https://open.spotify.com'
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36'

function escapeHtml(text) {
  return String(text == null ? '' : text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

function trackId(uri) {
  return String(uri || '').replace(/^spotify:track:/, '')
}

function formatDuration(milliseconds) {
  const total = Math.round(Number(milliseconds) / 1000)

  if (!Number.isFinite(total) || total <= 0) {
    return ''
  }

  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

function toEntry(track, context) {
  if (!track?.uri) {
    return null
  }

  const id = trackId(track.uri)
  const duration = formatDuration(track.duration)
  const entry = {
    id: `spotify:${id}`,
    title: track.title || id,
    url: `${SITE}/track/${id}`,
    params: { preview: track.audioPreview?.url || '' }
  }

  if (track.subtitle) {
    entry.author = track.subtitle
    entry.summary = duration ? `${track.subtitle} · ${duration}` : track.subtitle
  } else if (duration) {
    entry.summary = duration
  }

  const parts = []

  if (track.audioPreview?.url) {
    parts.push(`<audio controls src="${escapeHtml(track.audioPreview.url)}"></audio>`)
  }

  parts.push(`<p>${escapeHtml(track.title || id)}${track.subtitle ? ` — ${escapeHtml(track.subtitle)}` : ''}</p>`)
  parts.push(`<p>${escapeHtml(context.artist)} 的热门曲目</p>`)
  entry.content = parts.join('')

  return entry
}

export async function fetch(ctx) {
  const id = String(ctx.params.id || '').trim()

  if (!id) {
    throw new Error('spotify: 艺人 id 不能为空')
  }

  const response = await ctx.fetch(`${SITE}/embed/artist/${encodeURIComponent(id)}`, { headers: { 'user-agent': USER_AGENT } })

  if (!response.ok) {
    throw new Error(`spotify: artist ${id} returned ${response.status} ${response.statusText}`)
  }

  const html = await response.text()
  const match = /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/.exec(html)

  if (!match) {
    throw new Error(`spotify: artist ${id} has no embed data; the page shape changed`)
  }

  let entity

  try {
    entity = JSON.parse(match[1])?.props?.pageProps?.state?.data?.entity
  } catch (error) {
    throw new Error(`spotify: artist ${id} embed data is not JSON: ${error.message}`)
  }

  if (!Array.isArray(entity?.trackList)) {
    throw new Error(`spotify: artist ${id} embed data has no track list`)
  }

  const entries = entity.trackList.map((track) => toEntry(track, { artist: entity.name || id })).filter(Boolean)

  if (entries.length === 0) {
    throw new Error(`spotify: artist ${id} returned no tracks`)
  }

  return { entries, icon: 'https://open.spotify.com/favicon.ico' }
}
