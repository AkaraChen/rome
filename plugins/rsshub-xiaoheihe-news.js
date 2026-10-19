// Ported from RSSHub lib/routes/xiaoheihe/news.ts (AGPL-3.0).
// 小黑盒 · 游戏新闻 — ported from RSSHub's /xiaoheihe/news.
//
// `api.xiaoheihe.cn` rejects unsigned requests with "非法请求", so every URL is
// signed with the same hkey scheme the web client uses: a key drawn from a
// fixed alphabet by an MD5-derived number, a two-digit checksum of that key,
// and a `nonce`. The signature covers the path and the timestamp, so it has to
// be recomputed per request. WebCrypto has no MD5, so one is implemented below.
//
// RSSHub follows each item into `/bbs/app/api/share/data/` to replace the list
// description with the full body. That endpoint now answers "错误的帖子" for
// every news item, so there is no `preview`: the list's own description is the
// most the site will give, and it is a real summary rather than a stub.

export const meta = {
  id: 'rome.rsshub-xiaoheihe-news',
  name: '小黑盒 · 游戏新闻',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: '小黑盒游戏新闻，含摘要、话题标签与配图',
  icon: 'https://www.xiaoheihe.cn/favicon.ico',
}

const SITE = 'https://www.xiaoheihe.cn'
const FEED = 'https://api.xiaoheihe.cn/bbs/app/feeds/news?os_type=web&app=heybox&client_type=mobile&version=999.0.3&x_client_type=web&x_os_type=Mac&x_app=heybox&heybox_id=-1&appid=900018355&offset=0&limit=20'

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

// --- MD5 -------------------------------------------------------------------
// Only used to derive the request signature; the inputs are ASCII, but the
// encoder is correct for any string so it can be reused without surprises.

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

// --- signing ---------------------------------------------------------------

const DICT = 'JKMNPQRTX1234OABCDFG56789H'

function convertByte(value) {
  return value & 0x80 ? 0xff & ((value << 1) ^ 0x1b) : value << 1
}

function c3(value) {
  return convertByte(value) ^ value
}

function c2(value) {
  return c3(convertByte(value))
}

function c1(value) {
  return c2(c3(convertByte(value)))
}

function c0(value) {
  return c1(value) ^ c2(value) ^ c3(value)
}

function checksum(data) {
  return ([
    c0(data[0]) ^ c1(data[1]) ^ c2(data[2]) ^ c3(data[3]),
    c3(data[0]) ^ c0(data[1]) ^ c1(data[2]) ^ c2(data[3]),
    c2(data[0]) ^ c3(data[1]) ^ c0(data[2]) ^ c1(data[3]),
    c1(data[0]) ^ c2(data[1]) ^ c3(data[2]) ^ c0(data[3]),
  ].reduce((total, value) => total + value)) % 100
}

function timestamp() {
  return Math.trunc(Date.now() / 1000)
}

/// `nonce` is an uppercase hex MD5 of a random string, as the client sends it.
function nonce() {
  return md5Hex(Math.random().toString()).toUpperCase()
}

/// Port of the heybox-url helper. `_time` is the plain timestamp the query
/// carries; the key derivation uses `timestamp + 1` internally, which is why a
/// naive port that sends the incremented value is rejected as 非法请求.
function signed(url, time, salt) {
  const pathname = new URL(url).pathname
  const path = '/' + pathname.split('/').filter(Boolean).join('/') + '/'
  const nonceHash = md5Hex((salt + DICT).replace(/\D/g, '')).toLowerCase()
  const number = md5Hex(`${time + 1}${path}${nonceHash}`)
    .replace(/\D/g, '')
    .slice(0, 9)
    .padEnd(9, '0')

  let key = ''
  let rest = Number(number)
  for (let i = 0; i < 5; i++) {
    const index = rest % DICT.length
    rest = Math.trunc(rest / DICT.length)
    key += DICT[index]
  }

  const suffix = String(checksum([...key].slice(-4).map((character) => character.codePointAt(0)))).padStart(2, '0')
  const result = new URL(url)
  const query = `hkey=${key}${suffix}&_time=${time}&nonce=${salt}`
  result.search += result.search ? `&${query}` : query
  return result.href
}

// --- route -----------------------------------------------------------------

function paragraphs(text) {
  const value = String(text ?? '').trim()
  if (!value) return ''
  return value
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${escapeHtml(paragraph.trim())}</p>`)
    .join('')
}

function tagsOf(link) {
  const names = []
  for (const hash of Array.isArray(link.hashtags) ? link.hashtags : []) {
    if (hash && hash.name) names.push(hash.name)
  }
  return names
}

export async function fetch(ctx) {
  const time = timestamp()
  const url = signed(FEED, time, nonce())
  const response = await ctx.fetch(url, { headers: { accept: 'application/json' } })

  if (!response.ok) {
    throw new Error(`小黑盒返回 ${response.status} ${response.statusText}`)
  }

  const body = await response.json()
  const links = body && body.result && body.result.links

  if (!Array.isArray(links)) {
    throw new Error(`小黑盒没有返回新闻列表（${(body && body.msg) || '未知原因'}），接口可能已经变了`)
  }

  const entries = []

  for (const link of links) {
    if (!link || link.linkid === undefined || !link.title) continue

    const image = (Array.isArray(link.imgs) && link.imgs[0]) || (Array.isArray(link.thumbs) && link.thumbs[0]) || undefined
    const tags = tagsOf(link)
    const description = link.description || ''

    const entry = {
      id: `xiaoheihe:news:${link.linkid}`,
      title: link.title,
      url: `${SITE}/app/bbs/link/${link.linkid}`,
      summary: description || undefined,
      content: [
        image ? `<p><img src="${escapeHtml(image)}" alt="${escapeHtml(link.title)}"></p>` : null,
        paragraphs(description),
        tags.length > 0 ? `<p>${escapeHtml(tags.join(' · '))}</p>` : null,
      ].filter(Boolean).join(''),
    }

    if (image) entry.image = image

    const publishedAt = Number(link.modify_at)
    if (Number.isFinite(publishedAt) && publishedAt > 0) entry.publishedAt = Math.floor(publishedAt)

    entries.push(entry)
  }

  if (entries.length === 0) {
    throw new Error('小黑盒新闻列表为空，接口可能已经变了')
  }

  ctx.log.info(`xiaoheihe-news: ${entries.length} 条`)

  return { entries, icon: 'https://www.xiaoheihe.cn/favicon.ico' }
}
