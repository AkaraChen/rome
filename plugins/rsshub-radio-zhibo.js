// Ported from RSSHub lib/routes/radio/zhibo.ts (AGPL-3.0).
// 云听 直播 — RSSHub 的 /radio/zhibo/:id 路由。
//
// 这个接口要一个签名：sign = MD5("columnId=…&pageNo=…&pageSize=…&timestamp=…&key=<固定密钥>")
// 大写，连同 timestamp 一起放进请求头。运行时的 WebCrypto 不提供 MD5，
// 所以这里自带一份实现（在 Node 的 crypto 上按标准测试向量核对过）。
//
// 条目是回听音频，url 直接给音频流地址；标题带上节目日期，因为同一档节目
// 每天都会出现一次。

export const meta = {
  id: 'rome.rsshub-radio-zhibo',
  name: '云听 · 直播',
  version: '1.0.0',
  apiVersion: '1',
  view: 'audios',
  description: '云听（radio.cn）电台直播节目的回听音频',
  icon: 'https://www.radio.cn/favicon.ico',
  params: {
    fields: [
      {
        key: 'id',
        type: 'text',
        label: '直播 id',
        help: '可在点播页网址 https://www.radio.cn/pc-portal/sanji/zhibo_2.html?name=<直播 id> 中找到',
        default: '',
        required: true,
      },
    ],
  },
}

const API = 'https://ytmsout.radio.cn/web/appProgram/pageByColumn'

/// 站点自己的签名密钥，写死在它的前端里。
const KEY = 'f0fc4c668392f9f9a447e48584c214ee'

const MD5_SHIFTS = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
  5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
]

/// MD5, 十六进制小写。K 表按定义现算（floor(2^32 * |sin(i+1)|)），
/// 省掉一行 64 个常量，也省掉抄错一个的机会。
function md5(input) {
  const K = new Uint32Array(64)

  for (let i = 0; i < 64; i += 1) {
    K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296)
  }

  const bytes = new TextEncoder().encode(input)
  const padded = new Uint8Array((((bytes.length + 8) >> 6) + 1) * 64)

  padded.set(bytes)
  padded[bytes.length] = 0x80

  const bits = bytes.length * 8
  const view = new DataView(padded.buffer)

  view.setUint32(padded.length - 8, bits >>> 0, true)
  view.setUint32(padded.length - 4, Math.floor(bits / 4294967296), true)

  let a = 0x67452301
  let b = 0xefcdab89
  let c = 0x98badcfe
  let d = 0x10325476

  const words = new Uint32Array(16)

  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let i = 0; i < 16; i += 1) {
      words[i] = view.getUint32(offset + i * 4, true)
    }

    let A = a
    let B = b
    let C = c
    let D = d

    for (let i = 0; i < 64; i += 1) {
      let f
      let g

      if (i < 16) {
        f = (B & C) | (~B & D)
        g = i
      } else if (i < 32) {
        f = (D & B) | (~D & C)
        g = (5 * i + 1) % 16
      } else if (i < 48) {
        f = B ^ C ^ D
        g = (3 * i + 5) % 16
      } else {
        f = C ^ (B | ~D)
        g = (7 * i) % 16
      }

      f = (f + A + K[i] + words[g]) | 0
      A = D
      D = C
      C = B
      B = (B + ((f << MD5_SHIFTS[i]) | (f >>> (32 - MD5_SHIFTS[i])))) | 0
    }

    a = (a + A) | 0
    b = (b + B) | 0
    c = (c + C) | 0
    d = (d + D) | 0
  }

  const out = new Uint8Array(16)
  const outView = new DataView(out.buffer)

  outView.setUint32(0, a, true)
  outView.setUint32(4, b, true)
  outView.setUint32(8, c, true)
  outView.setUint32(12, d, true)

  return Array.from(out, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

/// 直播接口给的播放地址可能是 .m3u8 播放列表，退回 downloadUrl。
function audioUrl(item) {
  for (const candidate of [item.playUrlHigh, item.playUrlLow]) {
    if (typeof candidate === 'string' && candidate) {
      return candidate.endsWith('.m3u8') ? item.downloadUrl : candidate
    }
  }

  return null
}

/// 节目表按东八区的日期分档，所以日期要在 +08:00 里算。
function shanghaiDay(milliseconds) {
  const date = new Date(Number(milliseconds) + 8 * 3600 * 1000)
  const pad = (value) => String(value).padStart(2, '0')

  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
}

export async function fetch(ctx) {
  const id = ctx.params.id

  if (!id) {
    throw new Error('请填写直播 id，可在点播页网址的 name 中找到')
  }

  const params = `columnId=${id}&pageNo=0&pageSize=100`
  const timestamp = Date.now()
  const sign = md5(`${params}&timestamp=${timestamp}&key=${KEY}`).toUpperCase()

  ctx.log.debug(`radio: GET ${API}?${params}`)

  const response = await ctx.fetch(`${API}?${params}`, {
    headers: {
      sign,
      timestamp: String(timestamp),
      'content-type': 'application/json',
      equipmentId: '0000',
      platformCode: 'WEB',
    },
  })

  if (!response.ok) {
    throw new Error(`云听返回 ${response.status} ${response.statusText}`)
  }

  const body = await response.json()
  const programs = body.data?.data

  if (body.code !== 0) {
    throw new Error(`云听接口返回 code=${body.code}：${body.message ?? '没有说明'}`)
  }

  if (!Array.isArray(programs)) {
    throw new Error('云听直播接口没有返回 data.data 数组，接口可能已经变了')
  }

  const entries = []

  for (const program of programs) {
    const url = audioUrl(program)

    if (!url || !program.id || !program.name) continue

    const entry = {
      id: `radio:${program.id}`,
      title: `${shanghaiDay(program.programDate ?? program.startTime)} ${program.name}`,
      url,
    }

    if (program.des) entry.summary = program.des
    else if (program.durationStr) entry.summary = `时长 ${program.durationStr}`

    const publishedAt = Number(program.startTime)

    if (Number.isFinite(publishedAt)) {
      entry.publishedAt = Math.floor(publishedAt / 1000)
    }

    entries.push(entry)
  }

  if (entries.length === 0) {
    throw new Error('云听直播里没有读到任何节目，接口可能已经变了')
  }

  ctx.log.info(`radio: 直播 ${id} ${entries.length} 条`)

  return { entries }
}
