// Ported from RSSHub lib/routes/radio/album.ts (AGPL-3.0).
// 云听 专辑 — RSSHub 的 /radio/album/:id 路由。
//
// 云听的专辑接口是 POST 一个表单，返回 JSON。它要求一组固定的请求头，
// 其中只有 equipmentSource 是必需的；其余的是这个接口一贯带着的，缺了会 4xx。
//
// 条目本身就是一段音频，所以 url 直接给音频流地址：audios 视图点开就是播放。
// 分享页地址放进 params，方便以后需要时用。

export const meta = {
  id: 'rome.rsshub-radio-album',
  name: '云听 · 专辑',
  version: '1.0.0',
  apiVersion: '1',
  view: 'audios',
  description: '云听（radio.cn）专辑下的全部节目音频',
  icon: 'https://www.radio.cn/favicon.ico',
  params: {
    fields: [
      {
        key: 'id',
        type: 'text',
        label: '专辑 id',
        help: '可在专辑页网址 https://www.radio.cn/pc-portal/sanji/detail.html?columnId=<专辑 id> 中找到',
        default: '',
        required: true,
      },
    ],
  },
}

const API = 'https://ytapi.radio.cn/ytsrv/srv/wifimusicbox/demand/detail'
const SHARE = 'https://ytweb.radio.cn/share/albumPlay'

/// 接口给的播放地址有高、中、低三档，还有可能是一个 .m3u8 播放列表；
/// 后者不能直接当音频文件播，退回到 downloadUrl。
function audioUrl(item) {
  for (const candidate of [item.playUrlHigh, item.playUrlMedium, item.playUrlLow, item.playUrl]) {
    if (typeof candidate === 'string' && candidate) {
      return candidate.endsWith('.m3u8') ? item.downloadUrl : candidate
    }
  }

  return null
}

/// 云听把时间写成「2026-10-19 14:31:04」，按东八区读。
function seconds(local) {
  if (!local) return undefined

  const milliseconds = Date.parse(`${String(local).replace(' ', 'T')}+08:00`)

  return Number.isFinite(milliseconds) ? Math.floor(milliseconds / 1000) : undefined
}

export async function fetch(ctx) {
  const id = ctx.params.id

  if (!id) {
    throw new Error('请填写专辑 id，可在专辑页网址的 columnId 中找到')
  }

  const body = new URLSearchParams({
    pageIndex: '0',
    sortType: '',
    mobileId: '',
    providerCode: '25010',
    pid: id,
    paySongFlag: '1',
    richText: '1',
    h5flag: '1',
  })

  ctx.log.debug(`radio: POST ${API} pid=${id}`)

  const response = await ctx.fetch(API, {
    method: 'POST',
    headers: {
      accept: 'application/json, text/plain, */*',
      'content-type': 'application/x-www-form-urlencoded',
      equipmentSource: 'WEB',
      equipmentType: '3',
      platformCode: 'H5',
      productId: '1605403829833195520',
      providerCode: '25010',
      referer: 'https://ytweb.radio.cn/',
      timestamp: String(Date.now()),
      version: '4.0.0',
    },
    body,
  })

  if (!response.ok) {
    throw new Error(`云听返回 ${response.status} ${response.statusText}`)
  }

  const data = await response.json()
  const episodes = data.con

  if (!Array.isArray(episodes)) {
    throw new Error('云听专辑接口没有返回 con 数组，接口可能已经变了')
  }

  const entries = []

  for (const episode of episodes) {
    const url = audioUrl(episode)

    // 没有播放地址的条目留在列表里没有意义，也会让 id 撞在一起。
    if (!url || !episode.id || !episode.name) continue

    const entry = {
      id: `radio:${episode.id}`,
      title: episode.name,
      url,
      image: episode.logoUrl || undefined,
      params: { page: `${SHARE}?correlateId=${episode.id}&columnId=${id}` },
    }

    if (episode.anchorperson) entry.author = episode.anchorperson
    if (episode.duration) entry.summary = `时长 ${episode.duration}`

    const publishedAt = seconds(episode.createTime)
    if (publishedAt !== undefined) entry.publishedAt = publishedAt

    entries.push(entry)
  }

  if (entries.length === 0) {
    throw new Error('云听专辑里没有读到任何节目，接口可能已经变了')
  }

  ctx.log.info(`radio: 专辑 ${data.columnName ?? id} ${entries.length} 条`)

  return { entries }
}
