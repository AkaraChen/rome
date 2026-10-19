// Ported from RSSHub lib/routes/cls/telegraph.tsx (AGPL-3.0).
// 财联社 · 电报 — ported from RSSHub's /cls/telegraph.
//
// Every 财联社 API call is signed: the query parameters are sorted by name,
// SHA1'd as a string, and the MD5 of that hex digest is appended as `sign`.
// QuickJS has neither hash in WebCrypto, so both are implemented below. The
// parameters here are plain ASCII, so building the string by hand matches what
// URLSearchParams would produce.
//
// Two endpoints sit behind one route: the whole telegraph is served from the
// site's generic cache endpoint, and a category filter switches to the roll
// list endpoint, which is the only one that accepts `category`.

export const meta = {
  id: 'rome.rsshub-cls-telegraph',
  name: '财联社 · 电报',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: '财联社电报快讯，可按看盘、公司、加红等分类筛选',
  icon: 'https://www.cls.cn/favicon.ico',
  params: {
    fields: [
      {
        key: 'category',
        type: 'select',
        label: '分类',
        help: '选择要订阅的电报分类，默认为全部',
        default: '',
        options: [
          { value: '', label: '全部' },
          { value: 'watch', label: '看盘' },
          { value: 'announcement', label: '公司' },
          { value: 'red', label: '加红' },
          { value: 'remind', label: '提醒' },
          { value: 'fund', label: '基金' },
          { value: 'hk', label: '港股' },
          { value: 'hk_us', label: '港美股' },
        ],
      },
    ],
  },
}

const SITE = 'https://www.cls.cn'
const CACHE_API = `${SITE}/api/cache`
const ROLL_API = `${SITE}/v1/roll/get_roll_list`

// --- MD5 -------------------------------------------------------------------

const MD5_SHIFTS = [7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21]

let md5Table = null

function md5Constants() {
  if (md5Table) return md5Table
  const table = new Uint32Array(64)
  for (let i = 0; i < 64; i++) table[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296)
  md5Table = table
  return table
}

function rotateLeft(value, amount) {
  return ((value << amount) | (value >>> (32 - amount))) >>> 0
}

function littleEndianHex(value) {
  let out = ''
  for (let i = 0; i < 4; i++) out += ((value >>> (i * 8)) & 0xff).toString(16).padStart(2, '0')
  return out
}

function md5Hex(input) {
  const bytes = new TextEncoder().encode(input)
  const k = md5Constants()
  const length = bytes.length
  const padded = new Uint8Array((((length + 8) >> 6) + 1) * 64)
  padded.set(bytes)
  padded[length] = 0x80

  const view = new DataView(padded.buffer)
  const bits = length * 8
  view.setUint32(padded.length - 8, bits >>> 0, true)
  view.setUint32(padded.length - 4, Math.floor(bits / 4294967296), true)

  let a0 = 0x67452301
  let b0 = 0xefcdab89
  let c0 = 0x98badcfe
  let d0 = 0x10325476

  for (let offset = 0; offset < padded.length; offset += 64) {
    const chunk = new Uint32Array(16)
    for (let i = 0; i < 16; i++) chunk[i] = view.getUint32(offset + i * 4, true)

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
      const temp = d
      d = c
      c = b
      b = (b + rotateLeft((a + f + k[i] + chunk[g]) >>> 0, MD5_SHIFTS[i])) >>> 0
      a = temp
    }

    a0 = (a0 + a) >>> 0
    b0 = (b0 + b) >>> 0
    c0 = (c0 + c) >>> 0
    d0 = (d0 + d) >>> 0
  }

  return littleEndianHex(a0) + littleEndianHex(b0) + littleEndianHex(c0) + littleEndianHex(d0)
}

// --- SHA-1 -----------------------------------------------------------------

function sha1Hex(input) {
  const bytes = new TextEncoder().encode(input)
  const length = bytes.length
  const padded = new Uint8Array((((length + 8) >> 6) + 1) * 64)
  padded.set(bytes)
  padded[length] = 0x80

  const view = new DataView(padded.buffer)
  const bits = length * 8
  view.setUint32(padded.length - 8, Math.floor(bits / 4294967296), false)
  view.setUint32(padded.length - 4, bits >>> 0, false)

  let h0 = 0x67452301
  let h1 = 0xefcdab89
  let h2 = 0x98badcfe
  let h3 = 0x10325476
  let h4 = 0xc3d2e1f0

  const schedule = new Uint32Array(80)

  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let i = 0; i < 16; i++) schedule[i] = view.getUint32(offset + i * 4, false)
    for (let i = 16; i < 80; i++) schedule[i] = rotateLeft(schedule[i - 3] ^ schedule[i - 8] ^ schedule[i - 14] ^ schedule[i - 16], 1)

    let a = h0
    let b = h1
    let c = h2
    let d = h3
    let e = h4

    for (let i = 0; i < 80; i++) {
      let f
      let k
      if (i < 20) {
        f = (b & c) | (~b & d)
        k = 0x5a827999
      } else if (i < 40) {
        f = b ^ c ^ d
        k = 0x6ed9eba1
      } else if (i < 60) {
        f = (b & c) | (b & d) | (c & d)
        k = 0x8f1bbcdc
      } else {
        f = b ^ c ^ d
        k = 0xca62c1d6
      }
      const temp = (rotateLeft(a, 5) + f + e + k + schedule[i]) >>> 0
      e = d
      d = c
      c = rotateLeft(b, 30)
      b = a
      a = temp
    }

    h0 = (h0 + a) >>> 0
    h1 = (h1 + b) >>> 0
    h2 = (h2 + c) >>> 0
    h3 = (h3 + d) >>> 0
    h4 = (h4 + e) >>> 0
  }

  return [h0, h1, h2, h3, h4].map((value) => value.toString(16).padStart(8, '0')).join('')
}

// --- signing ---------------------------------------------------------------

/// Sort by name, hash the query string, append the signature. `Subject_Id` is
/// capitalised, which is why the sort cannot be skipped for some routes.
function signedQuery(params) {
  const pairs = Object.entries(params).filter(([, value]) => value !== undefined)
  pairs.sort((left, right) => (left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0))
  const query = pairs.map(([key, value]) => `${key}=${value}`).join('&')
  return `${query}&sign=${md5Hex(sha1Hex(query))}`
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function trimTitle(item) {
  if (item.title) return item.title
  if (item.brief) return item.brief
  const content = String(item.content ?? '').trim()
  return content.length > 60 ? `${content.slice(0, 60)}…` : content
}

export async function fetch(ctx) {
  const category = ctx.params.category
  const url = category
    ? `${ROLL_API}?${signedQuery({ appName: 'CailianpressWeb', category, os: 'web', sv: '8.7.9' })}`
    : `${CACHE_API}?${signedQuery({ appName: 'CailianpressWeb', name: 'telegraph', os: 'web', sv: '8.7.9' })}`

  const response = await ctx.fetch(url, { headers: { accept: 'application/json' } })

  if (!response.ok) {
    throw new Error(`财联社返回 ${response.status} ${response.statusText}`)
  }

  const body = await response.json()
  const roll = body && body.data && body.data.roll_data

  if (!Array.isArray(roll)) {
    throw new Error(`财联社没有返回电报列表（${(body && body.msg) || '未知原因'}），接口可能已经变了`)
  }

  const entries = []

  for (const item of roll) {
    if (!item || item.id === undefined) continue

    const images = Array.isArray(item.images) ? item.images : []
    const subjects = Array.isArray(item.subjects) ? item.subjects.map((subject) => subject && subject.subject_name).filter(Boolean) : []
    const content = String(item.content ?? '').trim()

    const entry = {
      id: `cls:telegraph:${item.id}`,
      title: trimTitle(item),
      url: item.shareurl || `${SITE}/detail/${item.id}`,
      summary: item.brief || undefined,
      content: [
        content ? `<p>${escapeHtml(content)}</p>` : null,
        ...images.map((image) => `<p><img src="${escapeHtml(image)}"></p>`),
        subjects.length > 0 ? `<p>${escapeHtml(subjects.join(' · '))}</p>` : null,
      ].filter(Boolean).join(''),
    }

    if (item.author) entry.author = item.author
    if (images.length > 0) entry.image = images[0]

    const publishedAt = Number(item.ctime)
    if (Number.isFinite(publishedAt) && publishedAt > 0) entry.publishedAt = Math.floor(publishedAt)

    entries.push(entry)
  }

  if (entries.length === 0) {
    throw new Error('财联社电报列表为空，接口可能已经变了')
  }

  ctx.log.info(`cls-telegraph: ${entries.length} 条`)

  return { entries, icon: 'https://www.cls.cn/favicon.ico' }
}

/// A telegraph is often complete in the list; the detail page is where the
/// longer ones are, and `__NEXT_DATA__` is the only place it is served.
export async function preview(ctx) {
  const url = ctx.item && ctx.item.url
  if (!url) return null

  const response = await ctx.fetch(url)
  if (!response.ok) {
    throw new Error(`财联社返回 ${response.status} ${response.statusText}`)
  }

  const html = await response.text()
  const match = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/)
  if (!match) return null

  const detail = JSON.parse(match[1]).props?.pageProps?.articleDetail
  if (!detail) return null

  const images = Array.isArray(detail.images) ? detail.images : []
  const content = [
    ...images.map((image) => `<p><img src="${escapeHtml(image)}"></p>`),
    detail.content || (detail.brief ? `<p>${escapeHtml(detail.brief)}</p>` : ''),
  ].join('')

  return content ? { content } : null
}
