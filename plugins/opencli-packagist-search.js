// Ported from OpenCLI clis/packagist/search.js (Apache-2.0).
// Packagist 包搜索 — OpenCLI's `packagist search` command.
//
// Packagist's search endpoint is public and unauthenticated. It returns the
// Composer package name, downloads, favers and repository inline.
//
// Ported from clis/packagist/search.js and utils.js.

export const meta = {
  id: 'rome.opencli-packagist-search',
  name: 'Packagist · 包搜索',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: '按关键词搜索 Packagist 上的 PHP 包',
  icon: 'https://packagist.org/favicon.ico',
  params: {
    fields: [
      {
        key: 'query',
        type: 'text',
        label: '关键词',
        help: '搜索词，例如 symfony、laravel http',
        default: '',
      },
      {
        key: 'limit',
        type: 'number',
        label: '条数',
        help: '最多返回多少条（1-100，单页）',
        default: 30,
      },
    ],
  },
}

const API = 'https://packagist.org/search.json'

function integer(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10)

  if (!Number.isFinite(parsed)) {
    return fallback
  }

  return Math.min(Math.max(parsed, min), max)
}

function count(value) {
  const number = Number(value)
  return Number.isFinite(number) ? String(number).replace(/\B(?=(\d{3})+(?!\d))/g, ',') : ''
}

function toEntry(row) {
  const name = String(row?.name ?? '').trim()

  // A Composer package name is `<vendor>/<package>`, and that string is the
  // registry's own id.
  if (!name) {
    throw new Error('Packagist 返回了一条没有名称的记录，接口可能已经变了')
  }

  const description = String(row.description ?? '').trim()
  const repository = String(row.repository ?? '').trim()
  const downloads = row.downloads != null ? Number(row.downloads) : null
  const favers = row.favers != null ? Number(row.favers) : null

  const parts = []

  if (downloads !== null) parts.push(`${count(downloads)} 次下载`)
  if (favers !== null) parts.push(`${count(favers)} 收藏`)
  if (repository) parts.push(repository)

  const entry = {
    id: `packagist:${name}`,
    title: name,
    url: String(row.url ?? '').trim() || `https://packagist.org/packages/${name}`,
  }

  if (description) entry.content = description
  if (parts.length > 0) entry.summary = parts.join(' · ')

  return entry
}

export async function fetch(ctx) {
  const query = String(ctx.params?.query ?? '').trim()

  if (!query) {
    throw new Error('请填写搜索关键词')
  }

  const limit = integer(ctx.params?.limit, 30, 1, 100)
  const url = `${API}?q=${encodeURIComponent(query)}&per_page=${limit}`

  ctx.log.debug(`opencli-packagist-search: GET ${url}`)

  const response = await ctx.fetch(url, {
    headers: {
      accept: 'application/json',
      'user-agent': 'rome-opencli-packagist (Rome reader plugin)',
    },
  })

  if (!response.ok) {
    throw new Error(`Packagist 返回 ${response.status} ${response.statusText}`)
  }

  const body = await response.json()

  if (!Array.isArray(body?.results)) {
    throw new Error('Packagist 没有返回 results 数组，接口可能已经变了')
  }

  if (body.results.length === 0) {
    throw new Error(`Packagist 没有找到与 "${query}" 匹配的包`)
  }

  const entries = body.results.slice(0, limit).map(toEntry)

  ctx.log.info(`opencli-packagist-search: ${entries.length} 条（${query}）`)

  return { entries }
}
