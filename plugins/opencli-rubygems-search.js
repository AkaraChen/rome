// Ported from OpenCLI clis/rubygems/search.js (Apache-2.0).
// RubyGems 搜索 — OpenCLI's `rubygems search` command.
//
// The public RubyGems index answers anonymous reads and returns gem metadata
// inline. No key, no cookies, no browser.
//
// Ported from clis/rubygems/search.js and utils.js.

export const meta = {
  id: 'rome.opencli-rubygems-search',
  name: 'RubyGems · Gem 搜索',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: '按关键词搜索 RubyGems.org 上的 Ruby gem',
  icon: 'https://rubygems.org/favicon.ico',
  params: {
    fields: [
      {
        key: 'query',
        type: 'text',
        label: '关键词',
        help: '搜索词，例如 rails、redis',
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

const API = 'https://rubygems.org/api/v1/search.json'

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

function toEntry(gem) {
  const name = String(gem?.name ?? '').trim()

  if (!name) {
    throw new Error('RubyGems 返回了一条没有名称的记录，接口可能已经变了')
  }

  const version = String(gem.version ?? '').trim()
  const downloads = gem.downloads != null ? Number(gem.downloads) : null
  const licenses = Array.isArray(gem.licenses) ? gem.licenses.filter(Boolean).join(', ') : ''
  const authors = String(gem.authors ?? '').trim()
  const info = String(gem.info ?? '').trim()

  const parts = []

  if (version) parts.push(`v${version}`)
  if (downloads !== null) parts.push(`${count(downloads)} 次下载`)
  if (licenses) parts.push(licenses)

  const entry = {
    // The gem name is the registry's own id and the last segment of its page.
    id: `rubygems:${name}`,
    title: name,
    url: `https://rubygems.org/gems/${name}`,
  }

  if (authors) entry.author = authors
  if (info) entry.content = info
  if (parts.length > 0) entry.summary = parts.join(' · ')

  return entry
}

export async function fetch(ctx) {
  const query = String(ctx.params?.query ?? '').trim()

  if (!query) {
    throw new Error('请填写搜索关键词')
  }

  const limit = integer(ctx.params?.limit, 30, 1, 100)
  const url = `${API}?query=${encodeURIComponent(query)}&page=1`

  ctx.log.debug(`opencli-rubygems-search: GET ${url}`)

  const response = await ctx.fetch(url, {
    headers: {
      accept: 'application/json',
      'user-agent': 'rome-opencli-rubygems (Rome reader plugin)',
    },
  })

  if (!response.ok) {
    throw new Error(`RubyGems 返回 ${response.status} ${response.statusText}`)
  }

  const body = await response.json()

  if (!Array.isArray(body)) {
    throw new Error('RubyGems 没有返回数组，接口可能已经变了')
  }

  if (body.length === 0) {
    throw new Error(`RubyGems 没有找到与 "${query}" 匹配的 gem`)
  }

  const entries = body.slice(0, limit).map(toEntry)

  ctx.log.info(`opencli-rubygems-search: ${entries.length} 条（${query}）`)

  return { entries }
}
