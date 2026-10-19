// Ported from RSSHub lib/routes/plurk/top.ts (AGPL-3.0).
/**
 * Plurk -- Top.
 *
 * The daily top lists are public JSON. `stats` is an array of [score, plurk]
 * pairs; the score itself is not shown by RSSHub and is dropped here too.
 */

export const meta = {
  id: 'rome.rsshub-plurk-top',
  name: 'Plurk · Top',
  version: '1.0.0',
  apiVersion: '1',
  view: 'socialMedia',
  description: '读取 Plurk 每日热门榜单',
  icon: 'https://www.plurk.com/favicon.ico',
  params: {
    fields: [
      {
        key: 'category',
        type: 'select',
        label: '榜单',
        help: '选择要读取的热门榜单',
        default: 'topReplurks',
        options: [
          { value: 'topReplurks', label: '热门转发' },
          { value: 'topFavorites', label: '热门收藏' },
          { value: 'topResponded', label: '热门回应' }
        ]
      },
      {
        key: 'lang',
        type: 'select',
        label: '语言',
        help: '选择榜单语言',
        default: 'en',
        options: [
          { value: 'en', label: 'English' },
          { value: 'zh', label: '中文（繁體）' }
        ]
      }
    ]
  }
};

const BASE = 'https://www.plurk.com'
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36'
const CATEGORIES = ['topReplurks', 'topFavorites', 'topResponded']

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

function plurkUrl(plurkId) {
  try {
    return `${BASE}/p/${BigInt(plurkId).toString(36)}`
  } catch {
    return `${BASE}/p/${plurkId}`
  }
}

function normalizeImages(html) {
  return String(html || '').replace(/<img\b[^>]*>/gi, (tag) => {
    const alt = /\balt="(https?:\/\/[^"]+)"/i.exec(tag)

    if (!alt) {
      return tag
    }

    return tag.replace(/\bsrc="[^"]*"/i, `src="${alt[1]}"`).replace(/\salt="[^"]*"/i, '')
  })
}

function toEntry(item) {
  const raw = String(item.content_raw || stripTags(item.content) || '').trim()
  const firstLine = raw.split('\n').map((line) => line.trim()).find(Boolean)
  const entry = {
    id: `plurk:${item.plurk_id}`,
    title: (firstLine || `Plurk ${item.plurk_id}`).slice(0, 120),
    url: plurkUrl(item.plurk_id)
  }

  if (item.owner?.display_name) {
    entry.author = item.owner.display_name
  }

  if (item.content) {
    entry.content = normalizeImages(item.content)
  } else if (raw) {
    entry.summary = raw.slice(0, 300)
  }

  const timestamp = Date.parse(item.posted)

  if (!Number.isNaN(timestamp)) {
    entry.publishedAt = Math.floor(timestamp / 1000)
  }

  return entry
}

export async function fetch(ctx) {
  const category = String(ctx.params.category || 'topReplurks')
  const lang = String(ctx.params.lang || 'en')

  if (!CATEGORIES.includes(category)) {
    throw new Error(`plurk: category 只能是 ${CATEGORIES.join('、')}`)
  }

  if (lang !== 'en' && lang !== 'zh') {
    throw new Error('plurk: lang 只能是 en 或 zh')
  }

  const url = `${BASE}/Stats/${category}?period=day&lang=${encodeURIComponent(lang)}&limit=90`
  const response = await ctx.fetch(url, { headers: { accept: 'application/json', 'user-agent': USER_AGENT } })

  if (!response.ok) {
    throw new Error(`plurk: ${category} returned ${response.status} ${response.statusText}`)
  }

  let data

  try {
    data = await response.json()
  } catch (error) {
    throw new Error(`plurk: ${category} did not return JSON: ${error.message}`)
  }

  if (!Array.isArray(data?.stats)) {
    throw new Error(`plurk: ${category} did not return a stats array; the response shape changed`)
  }

  const entries = data.stats
    .map((pair) => (Array.isArray(pair) ? pair[1] : pair))
    .filter((item) => item && item.plurk_id !== undefined)
    .map(toEntry)

  if (entries.length === 0) {
    throw new Error(`plurk: ${category} returned no entries`)
  }

  return { entries, icon: 'https://www.plurk.com/favicon.ico' }
}
