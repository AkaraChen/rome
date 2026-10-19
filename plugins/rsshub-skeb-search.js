// Ported from RSSHub lib/routes/skeb/search.ts (AGPL-3.0).
/**
 * Skeb -- Search Results.
 *
 * Search runs against Skeb's public Algolia index. The application id and
 * search key below are the ones the site ships in its own front end; they are
 * read-only search credentials and need no user configuration.
 */

export const meta = {
  id: 'rome.rsshub-skeb-search',
  name: 'Skeb · 搜索',
  version: '1.0.0',
  apiVersion: '1',
  view: 'pictures',
  description: '搜索 Skeb 上的作品',
  icon: 'https://skeb.jp/favicon.ico',
  params: {
    fields: [
      {
        key: 'keyword',
        type: 'text',
        label: '关键词',
        help: '要搜索的作品关键词，例如 初音ミク',
        required: true,
        default: ''
      }
    ]
  }
};

const BASE = 'https://skeb.jp'
const ALGOLIA = 'https://hb1jt3kre9-dsn.algolia.net/1/indexes/*/queries'
const ALGOLIA_APP_ID = 'HB1JT3KRE9'
const ALGOLIA_KEY = '9a4ce7d609e71bf29e977925e4c6740c'
const GENRE_FILTER = 'genre:art OR genre:comic OR genre:voice OR genre:novel OR genre:video OR genre:music OR genre:correction'
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36'

function escapeHtml(text) {
  return String(text == null ? '' : text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function largestImage(image) {
  let url = image?.src || ''
  let width = 0

  for (const candidate of String(image?.srcset || '').split(',')) {
    const [candidateUrl, descriptor] = candidate.trim().split(/\s+/, 2)
    const size = descriptor ? Number(descriptor.replace(/[wx]$/, '')) : 1

    if (candidateUrl && Number.isFinite(size) && size > width) {
      url = candidateUrl
      width = size
    }
  }

  return url
}

function toWork(work) {
  if (!work || !work.path || work.private) {
    return null
  }

  const image = largestImage(work.thumbnail_image_urls)
  const body = String(work.body || '')
  const parts = []

  if (image) {
    parts.push(`<p><img src="${escapeHtml(image)}"></p>`)
  }

  if ((work.genre === 'music' || work.genre === 'voice') && work.preview_url) {
    parts.push(`<audio controls src="${escapeHtml(work.preview_url)}"></audio>`)
  }

  if (body) {
    parts.push(`<p>${escapeHtml(body).replace(/\n/g, '<br>')}</p>`)
  }

  const entry = {
    id: `skeb:${work.path}`,
    title: work.path,
    url: `${BASE}${work.path}`,
    content: parts.join('')
  }

  if (image) {
    entry.image = image
  }

  if (body) {
    entry.summary = body.slice(0, 300)
  }

  return entry
}

export async function fetch(ctx) {
  const keyword = String(ctx.params.keyword || '').trim()

  if (!keyword) {
    throw new Error('skeb: 搜索关键词不能为空')
  }

  const body = {
    requests: [
      {
        indexName: 'User',
        query: keyword,
        params: 'hitsPerPage=40',
        filters: 'genres:art OR genres:comic OR genres:voice OR genres:novel OR genres:video OR genres:music OR genres:correction'
      },
      {
        indexName: 'Request',
        query: keyword,
        params: `hitsPerPage=40&filters=${encodeURIComponent(GENRE_FILTER)}`
      }
    ]
  }

  const response = await ctx.fetch(ALGOLIA, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
      'x-algolia-application-id': ALGOLIA_APP_ID,
      'x-algolia-api-key': ALGOLIA_KEY,
      'user-agent': USER_AGENT
    },
    body
  })

  if (!response.ok) {
    throw new Error(`skeb: search returned ${response.status} ${response.statusText}`)
  }

  let data

  try {
    data = await response.json()
  } catch (error) {
    throw new Error(`skeb: search did not return JSON: ${error.message}`)
  }

  const hits = data?.results?.[1]?.hits

  if (!Array.isArray(hits)) {
    throw new Error('skeb: search did not return a hits array; the response shape changed')
  }

  const entries = hits.map(toWork).filter(Boolean)

  if (entries.length === 0) {
    throw new Error(`skeb: search for ${keyword} returned no entries`)
  }

  return { entries, icon: 'https://skeb.jp/favicon.ico' }
}
