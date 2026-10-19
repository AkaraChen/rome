// Ported from RSSHub lib/routes/plurk/hotlinks.ts (AGPL-3.0).
/**
 * Plurk -- Hotlinks.
 *
 * The hotlinks page is backed by a public JSON endpoint. Each item is a link
 * with a pre-rendered snippet and no timestamp, so entries sort by fetch order.
 */

export const meta = {
  id: 'rome.rsshub-plurk-hotlinks',
  name: 'Plurk · Hotlinks',
  version: '1.0.0',
  apiVersion: '1',
  view: 'socialMedia',
  description: '读取 Plurk 热门链接榜',
  icon: 'https://www.plurk.com/favicon.ico'
};

const BASE = 'https://www.plurk.com'
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36'

function decodeEntities(text) {
  return String(text == null ? '' : text)
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&apos;', "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
}

function stripTags(html) {
  return decodeEntities(String(html || '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim()
}

function plurkSlug(item) {
  const match = /plurk\.com\/p\/([0-9a-z]+)/i.exec(item.link_url || '')

  if (match) {
    return match[1]
  }

  return item.link_url
}

export async function fetch(ctx) {
  const response = await ctx.fetch(`${BASE}/hotlinks/getLinks?offset=0&count=30`, {
    headers: { accept: 'application/json', 'user-agent': USER_AGENT }
  })

  if (!response.ok) {
    throw new Error(`plurk: hotlinks returned ${response.status} ${response.statusText}`)
  }

  let data

  try {
    data = await response.json()
  } catch (error) {
    throw new Error(`plurk: hotlinks did not return JSON: ${error.message}`)
  }

  if (!Array.isArray(data)) {
    throw new Error('plurk: hotlinks did not return a JSON array; the response shape changed')
  }

  const entries = data.map((item) => {
    const text = stripTags(item.rendered)
    const image = /<img\b[^>]*\bsrc="([^"]+)"/i.exec(item.rendered || '')
    const entry = {
      id: `plurk:${plurkSlug(item)}`,
      title: text || item.link_url || 'Plurk hotlink',
      url: item.link_url
    }

    if (image) {
      entry.image = decodeEntities(image[1])
    }

    if (item.num_plurks) {
      entry.summary = `${Number(item.num_plurks).toLocaleString('en-US')} 次分享`
    }

    return entry
  }).filter((entry) => entry.url)

  if (entries.length === 0) {
    throw new Error('plurk: hotlinks returned no entries')
  }

  return { entries, icon: 'https://www.plurk.com/favicon.ico' }
}
