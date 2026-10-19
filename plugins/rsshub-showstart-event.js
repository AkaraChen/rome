// Ported from RSSHub lib/routes/showstart/event.ts (AGPL-3.0).
// 秀动网按城市与风格的演出 — one signed POST to the public activity list.
// The upstream route also names the city and style by fetching a dictionary;
// Rome has no feed title to fill, so only the list is needed.

export const meta = {
  id: 'rome.rsshub-showstart-event',
  name: '秀动网 · 按城市 - 演出更新',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: '秀动网按城市和演出风格筛选的最新演出',
  icon: 'https://www.showstart.com/favicon.ico',
  params: {
    fields: [
      {
        key: 'cityCode',
        type: 'text',
        label: '演出城市编号',
        help: '可在秀动网城市页 URL 中找到，例如杭州为 571',
        default: '',
      },
      {
        key: 'showStyle',
        type: 'text',
        label: '演出风格编号',
        help: '可选，可在秀动网风格页 URL 中找到，例如摇滚为 3',
        default: '',
      },
    ],
  },
}

const HOST = 'https://www.showstart.com'
const API = `${HOST}/api`
const CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'

const DEVICE_INFO = {
  vendorName: '',
  deviceMode: '',
  deviceName: '',
  systemName: '',
  systemVersion: '',
  cpuMode: ' ',
  cpuCores: '',
  cpuArch: '',
  memerySize: '',
  diskSize: '',
  network: '',
  resolution: '1920*1080',
  pixelResolution: '',
}

let deviceNo = null
let session = null

function uuid(length) {
  let out = ''
  for (let i = 0; i < length; i++) {
    out += CHARS[Math.floor(Math.random() * CHARS.length)]
  }
  return out
}

function md5(value) {
  const bytes = new TextEncoder().encode(String(value))
  const length = bytes.length
  const size = (((length + 8) >>> 6) + 1) * 64
  const buffer = new Uint8Array(size)
  buffer.set(bytes)
  buffer[length] = 0x80

  const view = new DataView(buffer.buffer)
  const bits = length * 8
  view.setUint32(size - 8, bits >>> 0, true)
  view.setUint32(size - 4, Math.floor(bits / 4294967296), true)

  const shifts = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
  ]
  const constants = []
  for (let i = 0; i < 64; i++) {
    constants.push(Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) | 0)
  }

  let a0 = 0x67452301
  let b0 = 0xefcdab89 | 0
  let c0 = 0x98badcfe | 0
  let d0 = 0x10325476

  for (let offset = 0; offset < size; offset += 64) {
    const words = []
    for (let i = 0; i < 16; i++) words.push(view.getUint32(offset + i * 4, true))

    let a = a0
    let b = b0
    let c = c0
    let d = d0

    for (let i = 0; i < 64; i++) {
      let f
      let g

      if (i < 16) {
        f = (b & c) | (~b & d)
        g = i
      } else if (i < 32) {
        f = (d & b) | (~d & c)
        g = (5 * i + 1) % 16
      } else if (i < 48) {
        f = b ^ c ^ d
        g = (3 * i + 5) % 16
      } else {
        f = c ^ (b | ~d)
        g = (7 * i) % 16
      }

      const sum = (f + a + constants[i] + words[g]) | 0
      a = d
      d = c
      c = b
      b = (b + ((sum << shifts[i]) | (sum >>> (32 - shifts[i])))) | 0
    }

    a0 = (a0 + a) | 0
    b0 = (b0 + b) | 0
    c0 = (c0 + c) | 0
    d0 = (d0 + d) | 0
  }

  const hex = (number) => {
    let out = ''
    for (let i = 0; i < 4; i++) {
      out += ((number >>> (i * 8)) & 0xff).toString(16).padStart(2, '0')
    }
    return out
  }

  return hex(a0) + hex(b0) + hex(c0) + hex(d0)
}

function device() {
  if (!deviceNo) deviceNo = uuid(32).toLowerCase()
  return deviceNo
}

async function post(ctx, path, token, payload) {
  const deviceId = device()
  const traceId = `${uuid(32)}${Date.now()}`
  const body = payload ? JSON.stringify(payload) : ''
  const sign = md5(`${token}web${deviceId}${body}${path}999web${traceId}`)

  const cookie = [`token=${deviceId}`]
  if (session?.accessToken) cookie.push(`accessToken=${session.accessToken}`)
  if (session?.idToken) cookie.push(`idToken=${session.idToken}`)

  const response = await ctx.fetch(`${API}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cdeviceinfo: encodeURIComponent(JSON.stringify(DEVICE_INFO)),
      cdeviceno: deviceId,
      cookie: cookie.join('; '),
      crpsign: sign,
      crtraceid: traceId,
      csappid: 'web',
      cterminal: 'web',
      cusat: token,
      cusid: '',
      cusit: '',
      cusname: '',
      cusut: '',
      cversion: '999',
    },
    body: payload ? body : undefined,
  })

  if (!response.ok) {
    throw new Error(`秀动网返回 ${response.status} ${response.statusText}`)
  }

  return response.json()
}

async function token(ctx) {
  if (session && session.expiresAt > Date.now() / 1000 + 60) {
    return session.accessToken
  }

  const body = await post(ctx, '/waf/gettoken', md5(String(Date.now())))
  const grant = body?.result?.accessToken

  if (!body.success || !grant?.access_token) {
    throw new Error('秀动网没有返回访问令牌，接口可能已经变了')
  }

  session = {
    accessToken: grant.access_token,
    idToken: body.result.idToken?.id_token || '',
    expiresAt: Number(grant.expire) || Date.now() / 1000 + 600,
  }

  return session.accessToken
}

async function api(ctx, path, payload) {
  const accessToken = await token(ctx)
  const body = await post(ctx, path, accessToken, payload)

  if (body.status !== 200 || !body.result) {
    throw new Error(`秀动网接口 ${path} 返回 ${body.msg || body.status}`)
  }

  return body.result
}

function showSeconds(value) {
  const match = /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})\s+(\d{1,2}):(\d{2})/.exec(String(value ?? ''))
  if (!match) return undefined

  const milliseconds = Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]) - 8,
    Number(match[5]),
  )

  return Number.isFinite(milliseconds) ? Math.floor(milliseconds / 1000) : undefined
}

function toEntry(item) {
  const entry = {
    id: `showstart:event:${item.id}`,
    title: String(item.title ?? '').trim(),
    url: `${HOST}/event/${item.id}`,
  }

  if (item.poster) entry.image = item.poster
  if (item.performers) entry.author = item.performers

  const publishedAt = showSeconds(item.showTime)
  if (publishedAt !== undefined) entry.publishedAt = publishedAt

  const facts = [item.showTime, item.cityName, item.siteName, item.price].filter(Boolean)
  if (facts.length > 0) entry.summary = facts.join(' · ')

  return entry
}

export async function fetch(ctx) {
  const cityCode = String(ctx.params.cityCode ?? '').trim()
  const showStyle = String(ctx.params.showStyle ?? '').trim()

  if (!cityCode) {
    throw new Error('缺少演出城市编号：可在秀动网城市页 URL 中找到，例如杭州为 571')
  }

  if (!/^\d+$/.test(cityCode)) {
    throw new Error(`演出城市编号应为数字，收到 ${cityCode}`)
  }

  if (showStyle && !/^\d+$/.test(showStyle)) {
    throw new Error(`演出风格编号应为数字，收到 ${showStyle}`)
  }

  const payload = {
    cityCode,
    pageNo: '1',
    pageSize: '30',
  }

  if (showStyle) payload.showStyle = showStyle

  ctx.log.debug(`showstart-event: city ${cityCode} style ${showStyle || 'all'}`)

  const result = await api(ctx, '/web/activity/list', payload)
  const activities = Array.isArray(result.result) ? result.result : []
  const entries = activities.map(toEntry).filter((entry) => entry.title && entry.url)

  if (entries.length === 0) {
    throw new Error(`秀动网没有找到城市 ${cityCode} 的演出`)
  }

  ctx.log.info(`showstart-event: ${cityCode} ${entries.length} 场演出`)

  return { entries, icon: 'https://www.showstart.com/favicon.ico' }
}
