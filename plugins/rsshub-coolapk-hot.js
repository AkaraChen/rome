// Ported from RSSHub lib/routes/coolapk/hot.ts (AGPL-3.0).
/**
 * Coolapk -- 热榜.
 *
 * The API rejects requests without a per-request X-App-Token, which is derived
 * from the current unix second and a random device id. The formula below is the
 * one the Android client uses; it needs no account. MD5 is implemented here
 * because a plugin is a single module with no imports.
 */

export const meta = {
  id: 'rome.rsshub-coolapk-hot',
  name: '酷安 · 热榜',
  version: '1.0.0',
  apiVersion: '1',
  view: 'socialMedia',
  description: '读取酷安今日热门、点赞、收藏、评论与酷图榜单',
  icon: 'https://www.coolapk.com/favicon.ico',
  params: {
    fields: [
      {
        key: 'type',
        type: 'select',
        label: '榜单类型',
        help: '选择要读取的榜单',
        default: 'jrrm',
        options: [
          { value: 'jrrm', label: '今日热门' },
          { value: 'dzb', label: '点赞榜' },
          { value: 'plb', label: '评论榜' },
          { value: 'scb', label: '收藏榜' },
          { value: 'ktb', label: '酷图榜' }
        ]
      },
      {
        key: 'period',
        type: 'select',
        label: '周期',
        help: '今日热门没有周榜；酷图榜的日榜是周榜、周榜是月榜',
        default: 'daily',
        options: [
          { value: 'daily', label: '日榜' },
          { value: 'weekly', label: '周榜' }
        ]
      }
    ]
  }
};

const BASE = 'https://api.coolapk.com'
const DETAIL = 'https://api2.coolapk.com'
const JR_DAILY = `${BASE}/v6/page/dataList?url=%2Ffeed%2FstatList%3FcacheExpires%3D300%26statType%3Dday%26sortField%3Ddetailnum%26title%3D%E4%BB%8A%E6%97%A5%E7%83%AD%E9%97%A8&title=%E4%BB%8A%E6%97%A5%E7%83%AD%E9%97%A8&subTitle=&page=1`
const PERIODS = { daily: { description: '日榜', statType: 'day' }, weekly: { description: '周榜', statType: '7days' } }
const TYPES = { jrrm: '今日热门', dzb: '点赞榜', plb: '评论榜', scb: '收藏榜', ktb: '酷图榜' }
const SORT_FIELDS = { dzb: 'likenum', plb: 'replynum', scb: 'favnum' }
const USER_AGENT = 'Dalvik/2.1.0 (Linux; U; Android 10; Redmi K30 5G MIUI/V12.0.3.0.QGICMXM) (#Build; Redmi; Redmi K30 5G; QKQ1.191222.002 test-keys; 10) +CoolMarket/11.0-2101202'

function utf8Bytes(text) {
  const out = []

  for (let i = 0; i < text.length; i++) {
    let code = text.codePointAt(i)

    if (code > 0xffff) {
      i++
    }

    if (code < 0x80) {
      out.push(code)
    } else if (code < 0x800) {
      out.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f))
    } else if (code < 0x10000) {
      out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f))
    } else {
      out.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 0x3f), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f))
    }
  }

  return Uint8Array.from(out)
}

function wordToHexLe(word) {
  let hex = ''

  for (let i = 0; i < 4; i++) {
    hex += ((word >>> (i * 8)) & 0xff).toString(16).padStart(2, '0')
  }

  return hex
}

function md5(text) {
  const message = utf8Bytes(String(text))
  const length = message.length
  const padded = (((length + 8) >> 6) + 1) << 6
  const bytes = new Uint8Array(padded)
  bytes.set(message)
  bytes[length] = 0x80
  const view = new DataView(bytes.buffer)
  const bits = length * 8
  view.setUint32(padded - 8, bits >>> 0, true)
  view.setUint32(padded - 4, Math.floor(bits / 4294967296), true)

  const shifts = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21
  ]
  const constants = new Uint32Array(64)

  for (let i = 0; i < 64; i++) {
    constants[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296)
  }

  let a0 = 0x67452301
  let b0 = 0xefcdab89
  let c0 = 0x98badcfe
  let d0 = 0x10325476

  for (let offset = 0; offset < padded; offset += 64) {
    const chunk = new Uint32Array(16)

    for (let i = 0; i < 16; i++) {
      chunk[i] = view.getUint32(offset + i * 4, true)
    }

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

      f = (f + a + constants[i] + chunk[g]) | 0
      a = d
      d = c
      c = b
      b = (b + ((f << shifts[i]) | (f >>> (32 - shifts[i])))) | 0
    }

    a0 = (a0 + a) | 0
    b0 = (b0 + b) | 0
    c0 = (c0 + c) | 0
    d0 = (d0 + d) | 0
  }

  return [a0, b0, c0, d0].map(wordToHexLe).join('')
}

function base64(bytes) {
  const table = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  let out = ''

  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]
    const b1 = bytes[i + 1]
    const b2 = bytes[i + 2]
    out += table[b0 >> 2]
    out += table[((b0 & 3) << 4) | ((b1 || 0) >> 4)]
    out += b1 === undefined ? '=' : table[((b1 & 15) << 2) | ((b2 || 0) >> 6)]
    out += b2 === undefined ? '=' : table[b2 & 63]
  }

  return out
}

function deviceId() {
  const hex = () => Math.floor(Math.random() * 16).toString(16)
  const group = (size) => Array.from({ length: size }, hex).join('')
  return `${group(8)}-${group(4)}-${group(4)}-${group(4)}-${group(12)}`
}

function appToken() {
  const id = deviceId()
  const now = Math.floor(Date.now() / 1000)
  const raw = `token://com.coolapk.market/c67ef5943784d09750dcfbb31020f0ab?${md5(String(now))}$${id}&com.coolapk.market`
  return `${md5(base64(utf8Bytes(raw)))}${id}0x${now.toString(16)}`
}

function headers() {
  return {
    accept: 'application/json',
    'X-Requested-With': 'XMLHttpRequest',
    'X-App-Id': 'com.coolapk.market',
    'X-App-Token': appToken(),
    'X-Sdk-Int': '29',
    'X-Sdk-Locale': 'zh-CN',
    'X-App-Version': '11.0',
    'X-Api-Version': '11',
    'X-App-Code': '2101202',
    'User-Agent': USER_AGENT
  }
}

function flatten(data) {
  const out = []

  for (const item of data || []) {
    if (item?.entityType === 'card' && Array.isArray(item.entities)) {
      out.push(...item.entities)
    } else {
      out.push(item)
    }
  }

  return out
}

function textOf(html) {
  return String(html || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
}

function feedId(item) {
  const match = /\/feed\/(\d+)/.exec(item.url || '')
  return match ? match[1] : item.url
}

function toEntry(item) {
  if (!item || item.entityType === 'sponsorCard' || !item.url) {
    return null
  }

  const message = String(item.message || '')
  const pictures = (item.picArr || []).filter(Boolean)
  const plain = textOf(message)
  const type = Number.parseInt(item.type)
  let title = plain.slice(0, 120) || item.title || `酷安 ${feedId(item)}`

  if (type === 12) {
    title = item.title || title
  } else if ((type === 10 || type === 11) && item.message_title) {
    title = `${item.message_title} 更多：${title}`
  }

  const entry = {
    id: `coolapk:${feedId(item)}`,
    title,
    url: `https://www.coolapk.com${item.url}`,
    author: item.username,
    content: `<p>${message.replace(/\n/g, '<br>')}</p>${pictures.map((url) => `<p><img src="${url}"></p>`).join('')}`,
    params: { detail: Boolean(item.issummary), feedUrl: item.url }
  }

  const image = item.pic || pictures[0]

  if (image) {
    entry.image = image
  }

  if (plain) {
    entry.summary = plain.slice(0, 300)
  }

  const timestamp = Number(item.dateline)

  if (Number.isFinite(timestamp) && timestamp > 0) {
    entry.publishedAt = timestamp
  }

  return entry
}

function hotUrl(type, period) {
  if (type === 'jrrm') {
    return JR_DAILY
  }

  if (type === 'ktb') {
    // The picture board counts in weeks, not days.
    const trans = period === 'daily' ? { description: '周榜', statDays: '7days' } : { description: '月榜', statDays: '30days' }
    const link = `#/feed/coolPictureList?statDays=${trans.statDays}&listType=statFavNum&buildCard=1&title=${trans.description}&page=1`
    return `${BASE}/v6/page/dataList?url=${encodeURIComponent(link)}`
  }

  const { description, statType } = PERIODS[period]
  const link = `#/feed/statList?statType=${statType}&sortField=${SORT_FIELDS[type]}&title=${description}&page=1`
  return `${BASE}/v6/page/dataList?url=${encodeURIComponent(link)}`
}

export async function fetch(ctx) {
  const type = String(ctx.params.type || 'jrrm')
  const period = String(ctx.params.period || 'daily')

  if (!TYPES[type]) {
    throw new Error('coolapk: 榜单类型只能是 jrrm、dzb、plb、scb 或 ktb')
  }

  if (!PERIODS[period]) {
    throw new Error('coolapk: 周期只能是 daily 或 weekly')
  }

  const response = await ctx.fetch(hotUrl(type, period), { headers: headers() })

  if (!response.ok) {
    throw new Error(`coolapk: ${type} list returned ${response.status} ${response.statusText}`)
  }

  let data

  try {
    data = await response.json()
  } catch (error) {
    throw new Error(`coolapk: ${type} list did not return JSON: ${error.message}`)
  }

  if (!Array.isArray(data?.data)) {
    throw new Error(`coolapk: ${type} list did not return a data array; the response shape changed`)
  }

  const entries = flatten(data.data).map(toEntry).filter(Boolean)

  if (entries.length === 0) {
    throw new Error(`coolapk: ${type} list returned no entries`)
  }

  return { entries, icon: 'https://www.coolapk.com/favicon.ico' }
}

export async function preview(ctx) {
  const feedUrl = ctx.item.params?.feedUrl

  if (!ctx.item.params?.detail || !feedUrl) {
    return null
  }

  const match = /\/feed\/(\d+)/.exec(feedUrl)

  if (!match) {
    return null
  }

  const response = await ctx.fetch(`${DETAIL}/v6/feed/detail?id=${match[1]}`, { headers: headers() })

  if (!response.ok) {
    return null
  }

  const data = (await response.json())?.data

  if (!data) {
    return null
  }

  // Long articles are cut off in list responses; the detail carries the parts.
  if (data.message_raw_output) {
    let parts

    try {
      parts = JSON.parse(data.message_raw_output)
    } catch {
      parts = null
    }

    if (Array.isArray(parts)) {
      const html = parts.map((part) => {
        if (part.type === 'text') {
          return String(part.message || '').split('\n').filter(Boolean).map((line) => `<p>${line}</p>`).join('')
        }

        if (part.type === 'image') {
          return `<p><img src="${part.url}"></p>${part.description ? `<p>${part.description}</p>` : ''}`
        }

        if (part.type === 'shareUrl') {
          return `<p><a href="${part.url}">${part.title || part.url}</a></p>`
        }

        return ''
      }).join('')

      return { content: `${data.pic ? `<p><img src="${data.pic}"></p>` : ''}${html}` }
    }
  }

  if (data.message) {
    return { content: `<p>${String(data.message).replace(/\n/g, '<br>')}</p>` }
  }

  return null
}
