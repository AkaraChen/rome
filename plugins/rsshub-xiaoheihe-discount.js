// Ported from RSSHub lib/routes/xiaoheihe/discount.ts (AGPL-3.0).
// 小黑盒 · 游戏折扣 — ported from RSSHub's /xiaoheihe/discount/:platform.
//
// The endpoint is signed with the same hkey scheme as the news route (see the
// note in rsshub-xiaoheihe-news.js): the key comes from an MD5-derived number,
// the checksum from a two-digit hash of that key, and `_time` is the plain
// timestamp even though the key derivation uses `timestamp + 1`.
//
// The four platform filters are not one shape. PC returns a flat `price` with a
// heybox coin price beside it; Switch, PSN and Xbox return `platform_infos[]`,
// one entry per store region, each with its own price and deadline. `discount`
// is a percentage off, so the displayed 折 is `(100 - discount) / 10`.

export const meta = {
  id: 'rome.rsshub-xiaoheihe-discount',
  name: '小黑盒 · 游戏折扣',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: '小黑盒各平台游戏折扣，含现价、原价、史低标记与截止时间',
  icon: 'https://www.xiaoheihe.cn/favicon.ico',
  params: {
    fields: [
      {
        key: 'platform',
        type: 'select',
        label: '平台',
        help: '选择要订阅的平台分类',
        default: '',
        options: [
          { value: '', label: '请选择平台' },
          { value: 'pc', label: 'PC' },
          { value: 'switch', label: 'Switch' },
          { value: 'psn', label: 'PSN' },
          { value: 'xbox', label: 'Xbox' },
        ],
      },
    ],
  },
}

const SITE = 'https://www.xiaoheihe.cn'
const API = 'https://api.xiaoheihe.cn/game/get_game_list_v3/'
const STEAM = 'https://store.steampowered.com'

const PLATFORMS = {
  pc: { key: 'pc', desc: 'PC' },
  switch: { key: 'switch', desc: 'Switch' },
  psn: { key: 'ps4', desc: 'PSN' },
  xbox: { key: 'xbox', desc: 'Xbox' },
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

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

function signed(url) {
  const time = Math.trunc(Date.now() / 1000)
  const salt = md5Hex(Math.random().toString()).toUpperCase()
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

// --- entry shaping ---------------------------------------------------------

function discountLabel(discount) {
  return `${(100 - discount) / 10}折`
}

function lowestLabel(price, superLowest) {
  if (!price || !('is_lowest' in price) || price.is_lowest === 0) return ''
  if (superLowest) return '[超史低]'
  if (price.is_lowest === 1 && price.new_lowest === 1) return '[新史低]'
  if (price.is_lowest === 1) return '[史低]'
  return ''
}

function heyboxPrice(heybox) {
  if (!heybox || !heybox.coupon_info || typeof heybox.cost_coin !== 'number') return ''
  const reduce = Number(heybox.coupon_info.max_reduce) || 0
  const price = heybox.cost_coin / 1000 - reduce
  const text = Number.isSafeInteger(price) ? price.toFixed(0) : price.toFixed(2)
  return `券后价: ${text} [${heybox.coupon_info.coupon_desc}]`
}

/// The list asks the CDN for a 460x215 webp; the original asset is the same URL
/// without the transform query and is a jpg or png the reader can decode.
function still(url) {
  if (typeof url !== 'string' || url === '') return undefined
  const cut = url.indexOf('?')
  return cut === -1 ? url : url.slice(0, cut)
}

function priceLines(price, label) {
  const lines = []
  if (price.current) lines.push(`当前价格: ${price.current} ${label}`.trim())
  if (price.initial) lines.push(`原价: ${price.initial}`)
  if (price.discount && price.discount > 0) lines.push(`折扣力度: ${discountLabel(price.discount)}`)
  if (price.deadline_date) lines.push(`截止时间: ${price.deadline_date}`)
  return lines
}

function descriptionLines(game, platform) {
  const lines = []

  if (Array.isArray(game.platform_infos) && game.platform_infos.length > 0) {
    for (const entry of game.platform_infos) {
      if (!entry || !entry.price) continue
      if (entry.key) lines.push(`平台: ${String(entry.key).toUpperCase()}`)
      lines.push(...priceLines(entry.price, lowestLabel(entry.price)))
    }
  } else if (game.price) {
    lines.push(`平台: ${platform.desc}`)
    if (game.heybox_price) {
      const coupon = heyboxPrice(game.heybox_price)
      const price = `当前价格: ${game.price.current ?? ''} ${coupon}`.trim()
      lines.push(`${price} ${lowestLabel(game.price, game.heybox_price.super_lowest)}`.trim())
    } else {
      lines.push(...priceLines(game.price, lowestLabel(game.price)))
    }
  }

  if (game.score) lines.push(`评分: ${game.score}`)

  return lines
}

export async function fetch(ctx) {
  const platform = PLATFORMS[ctx.params.platform]

  if (!platform) {
    throw new Error('请选择平台：pc、switch、psn 或 xbox')
  }

  const url = `${API}?filter_head=${platform.key}&offset=0&limit=30&os_type=web&app=heybox&client_type=mobile&version=999.0.3&x_client_type=web&x_os_type=Mac&x_app=heybox&heybox_id=-1&include_filter=-1`
  const response = await ctx.fetch(signed(url), { headers: { accept: 'application/json' } })

  if (!response.ok) {
    throw new Error(`小黑盒返回 ${response.status} ${response.statusText}`)
  }

  const body = await response.json()
  const games = body && body.result && body.result.games

  if (!Array.isArray(games)) {
    throw new Error(`小黑盒没有返回折扣列表（${(body && body.msg) || '未知原因'}），接口可能已经变了`)
  }

  const entries = []

  for (const game of games) {
    if (!game || !game.name || !game.steam_appid) continue

    const image = still(game.image)
    const lines = descriptionLines(game, platform)
    const url = platform.key === 'pc'
      ? `${STEAM}/app/${game.steam_appid}`
      : `${SITE}/game/share_game_detail?appid=${game.steam_appid}&title=${encodeURIComponent(game.name)}`

    const entry = {
      id: `xiaoheihe:discount:${platform.key}:${game.steam_appid}`,
      title: game.name_en ? `${game.name}/${game.name_en}` : game.name,
      url,
      summary: lines.slice(0, 3).join(' · ') || undefined,
      content: [
        image ? `<p><img src="${escapeHtml(image)}" alt="${escapeHtml(game.name)}"></p>` : null,
        `<p><strong>${escapeHtml(game.name)}</strong></p>`,
        ...lines.map((line) => `<p>${escapeHtml(line)}</p>`),
      ].filter(Boolean).join(''),
    }

    if (image) entry.image = image

    entries.push(entry)
  }

  if (entries.length === 0) {
    throw new Error(`小黑盒 ${platform.desc} 折扣列表为空，接口可能已经变了`)
  }

  ctx.log.info(`xiaoheihe-discount: ${platform.desc} ${entries.length} 条`)

  return { entries, icon: 'https://www.xiaoheihe.cn/favicon.ico' }
}
