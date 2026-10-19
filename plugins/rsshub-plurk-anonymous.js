// Ported from RSSHub lib/routes/plurk/anonymous.ts (AGPL-3.0).
/**
 * Plurk -- Anonymous.
 *
 * Anonymous plurks are the whispers published on plurk.com/anonymous. The JSON
 * endpoint returns them as an object keyed by plurk id, alongside two metadata
 * keys that are not plurks.
 */

export const meta = {
  id: 'rome.rsshub-plurk-anonymous',
  name: 'Plurk · Anonymous',
  version: '1.0.0',
  apiVersion: '1',
  view: 'socialMedia',
  description: '读取 Plurk 匿名噗的最新内容',
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

function plurkUrl(plurkId) {
  try {
    return `${BASE}/p/${BigInt(plurkId).toString(36)}`
  } catch {
    return `${BASE}/p/${plurkId}`
  }
}

// Plurk writes images twice in some fields, with the full-size URL in alt.
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
    title: (firstLine || `匿名 Plurk ${item.plurk_id}`).slice(0, 120),
    url: plurkUrl(item.plurk_id),
    author: '匿名'
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
  const response = await ctx.fetch(`${BASE}/Stats/getAnonymousPlurks?offset=0&limit=200`, {
    headers: { accept: 'application/json', 'user-agent': USER_AGENT }
  })

  if (!response.ok) {
    throw new Error(`plurk: anonymous returned ${response.status} ${response.statusText}`)
  }

  let data

  try {
    data = await response.json()
  } catch (error) {
    throw new Error(`plurk: anonymous did not return JSON: ${error.message}`)
  }

  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('plurk: anonymous did not return a keyed object; the response shape changed')
  }

  const entries = Object.values(data)
    .filter((item) => item && typeof item === 'object' && item.plurk_id !== undefined)
    .map(toEntry)

  if (entries.length === 0) {
    throw new Error('plurk: anonymous returned no entries')
  }

  return { entries, icon: 'https://www.plurk.com/favicon.ico' }
}
