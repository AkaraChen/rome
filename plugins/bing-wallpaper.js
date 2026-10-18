// 必应每日壁纸 — a pictures plugin.
//
// A pictures source is mostly two fields, `image` and `view`, and one idea: the
// image has to be an absolute URL, because there is no page here to resolve a
// relative one against.
//
// The endpoint returns the last several days in a single request, which is what
// makes a fresh install useful on its first refresh instead of a grid with one
// tile in it. The id is the date the wallpaper belongs to -- a permanent
// identity, unlike its position in the list.

export const meta = {
  id: 'rome.bing-wallpaper',
  name: '必应每日壁纸',
  version: '1.0.0',
  apiVersion: '1',
  view: 'pictures',
  description: '必应首页每日壁纸，含最近数天',
}

export const settings = {
  fields: [
    {
      key: 'market',
      type: 'select',
      label: '地区',
      default: 'zh-CN',
      options: [
        { value: 'zh-CN', label: '中国' },
        { value: 'en-US', label: '美国' },
        { value: 'ja-JP', label: '日本' },
        { value: 'en-GB', label: '英国' },
      ],
    },
    { key: 'days', type: 'number', label: '取回天数', default: 8, min: 1, max: 8 },
  ],
}

const API = 'https://www.bing.com/HPImageArchive.aspx'
const ORIGIN = 'https://www.bing.com'

function integer(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(Math.max(parsed, min), max)
}

/// `copyright` is a caption followed by its credit: "多巴达恩城堡…，威尔士 (©
/// joe daniel price/Getty Images)". The credit is worth keeping, but not as the
/// title.
function splitCopyright(copyright) {
  const text = String(copyright ?? '')
  const at = text.indexOf(' (©')
  if (at === -1) return { title: text, credit: '' }
  return { title: text.slice(0, at), credit: text.slice(at + 1).replace(/^\(|\)$/g, '') }
}

/// `startdate` is `YYYYMMDD`, and the date is the whole identity of a wallpaper,
/// so this is the id rather than anything the response happens to order by.
function dateOf(startdate) {
  const match = /^(\d{4})(\d{2})(\d{2})$/.exec(String(startdate))
  if (!match) return undefined
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / 1000
}

export async function fetch(ctx) {
  const market = String(ctx.settings.market || 'zh-CN')
  const days = integer(ctx.settings.days, 8, 1, 8)

  const url = `${API}?format=js&idx=0&n=${days}&mkt=${market}`
  ctx.log.debug(`bing: GET ${url}`)

  const response = await ctx.fetch(url, { headers: { accept: 'application/json' } })

  if (!response.ok) {
    throw new Error(`必应壁纸接口返回 ${response.status} ${response.statusText}`)
  }

  const body = await response.json()

  if (!Array.isArray(body.images)) {
    // The endpoint answers an unknown market with an error object rather than
    // an empty list, so say which one was asked for.
    throw new Error(`必应壁纸接口没有返回 images 数组（mkt=${market}）`)
  }

  // `startdate` is the id below and `urlbase` builds the picture. An image
  // missing either would become `bing:undefined`, so it is dropped rather than
  // allowed to collide with the next one.
  const usable = body.images.filter((image) => image.startdate && image.urlbase)

  if (usable.length === 0) {
    throw new Error(`必应壁纸接口返回的图片缺少日期或地址（mkt=${market}）`)
  }

  const entries = usable.map((image) => {
    const { title, credit } = splitCopyright(image.copyright)
    // `url` is a 1920x1080 jpg with tracking parameters; `urlbase` is the same
    // image without them, so the picture is built from that.
    const picture = `${ORIGIN}${image.urlbase}_1920x1080.jpg`

    const entry = {
      id: `bing:${image.startdate}`,
      title: title || `必应壁纸 ${image.startdate}`,
      url: picture,
      image: picture,
      author: credit || undefined,
      content: image.copyright,
      summary: credit,
    }

    const publishedAt = dateOf(image.startdate)
    if (publishedAt !== undefined) entry.publishedAt = publishedAt

    return entry
  })

  ctx.log.info(`bing: ${entries.length} 张 (${market})`)

  return { entries }
}
