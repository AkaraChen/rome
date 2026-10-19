// Ported from RSSHub lib/routes/bilibili/audio.ts (AGPL-3.0).
// Bilibili 歌单 — /bilibili/audio/:id
//
// Two unauthenticated endpoints on the same host: one names the playlist, the
// other lists its songs. Both are plain JSON and answer without cookies, which
// is what makes this shippable as a plugin.
//
// The site's own ids: a playlist is a `sid` (the `am` number in the web URL),
// a song is addressed as `au<sid>`.

export const meta = {
  id: 'rome.rsshub-bilibili-audio',
  name: '哔哩哔哩 · 歌单',
  version: '1.0.0',
  apiVersion: '1',
  view: 'audios',
  description: '哔哩哔哩音频歌单的全部曲目',
  icon: 'https://www.bilibili.com/favicon.ico',
  params: {
    fields: [
      {
        key: 'id',
        type: 'text',
        label: '歌单 ID',
        help: '歌单页 URL 中的 am 后面的数字，例如 10624',
        placeholder: '10624',
        default: '',
      },
    ],
  },
}

const HOST = 'https://www.bilibili.com'

function seconds(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.floor(parsed) : undefined
}

/// The audio API answers with a `code` even when the HTTP status is 200, so a
/// wrong playlist id looks like success until the body is read.
async function json(ctx, url) {
  const response = await ctx.fetch(url, { headers: { referer: `${HOST}/` } })

  if (!response.ok) {
    throw new Error(`Bilibili 返回 ${response.status}（${url}）`)
  }

  const body = await response.json()

  if (body.code !== 0) {
    throw new Error(`Bilibili 接口报错 ${body.code}：${body.message || body.msg || '未知错误'}`)
  }

  return body.data
}

export async function fetch(ctx) {
  const id = String(ctx.params.id || '').trim()

  if (!/^\d+$/.test(id)) {
    throw new Error('请填写歌单 ID（歌单页 URL 中 am 后面的数字）')
  }

  const menu = await json(ctx, `${HOST}/audio/music-service-c/web/menu/info?sid=${id}`)
  const songs = await json(ctx, `${HOST}/audio/music-service-c/web/song/of-menu?sid=${id}&pn=1&ps=100`)

  if (!Array.isArray(songs?.data)) {
    throw new Error('Bilibili 没有返回歌单曲目，接口可能已经变了')
  }

  const entries = songs.data.map((song) => {
    const sid = song.statistic?.sid ?? song.id

    const entry = {
      id: `bilibili-audio:${sid}`,
      title: song.title,
      url: `${HOST}/audio/au${sid}`,
      author: song.author,
      summary: song.intro || undefined,
    }

    if (song.cover) entry.image = song.cover

    const publishedAt = seconds(song.passtime)
    if (publishedAt !== undefined) entry.publishedAt = publishedAt

    return entry
  })

  ctx.log.info(`bilibili-audio: ${entries.length} 首（${menu?.title || id}）`)

  return { entries }
}
