// Ported from OpenCLI clis/crates/search.js (Apache-2.0).
// crates.io 包搜索 — OpenCLI's `crates search` command.
//
// crates.io requires a descriptive User-Agent on API traffic, which the adapter
// sends and this keeps. No key, no cookies, no browser.
//
// Ported from clis/crates/search.js and utils.js.

export const meta = {
  id: 'rome.opencli-crates-search',
  name: 'crates.io · 包搜索',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: '按关键词搜索 crates.io 上的 Rust 包',
  icon: 'https://crates.io/favicon.ico',
  params: {
    fields: [
      {
        key: 'query',
        type: 'text',
        label: '关键词',
        help: '搜索词，例如 serde、async runtime',
        default: '',
      },
      {
        key: 'limit',
        type: 'number',
        label: '条数',
        help: '最多返回多少条（1-100）',
        default: 20,
      },
    ],
  },
}

const API = 'https://crates.io/api/v1/crates'

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

function toEntry(crate) {
  const name = String(crate?.name ?? crate?.id ?? '').trim()

  if (!name) {
    throw new Error('crates.io 返回了一条没有名称的记录，接口可能已经变了')
  }

  const version = String(crate.newest_version ?? crate.max_stable_version ?? crate.max_version ?? '').trim()
  const description = String(crate.description ?? '').trim()
  const repository = String(crate.repository ?? crate.homepage ?? '').trim()
  const downloads = crate.downloads != null ? Number(crate.downloads) : null
  const recentDownloads = crate.recent_downloads != null ? Number(crate.recent_downloads) : null

  const parts = []

  if (version) parts.push(`v${version}`)
  if (downloads !== null) parts.push(`${count(downloads)} 次下载`)
  if (recentDownloads !== null) parts.push(`近 90 天 ${count(recentDownloads)}`)
  if (repository) parts.push(repository)

  const entry = {
    // The crate name is its permanent registry id and the last segment of its
    // page address.
    id: `crates:${name}`,
    title: name,
    url: `https://crates.io/crates/${name}`,
  }

  if (description) entry.content = description
  if (parts.length > 0) entry.summary = parts.join(' · ')

  const updated = Date.parse(crate.updated_at)
  if (Number.isFinite(updated)) entry.publishedAt = Math.floor(updated / 1000)

  return entry
}

export async function fetch(ctx) {
  const query = String(ctx.params?.query ?? '').trim()

  if (!query) {
    throw new Error('请填写搜索关键词')
  }

  const limit = integer(ctx.params?.limit, 20, 1, 100)
  const url = `${API}?q=${encodeURIComponent(query)}&per_page=${limit}`

  ctx.log.debug(`opencli-crates-search: GET ${url}`)

  const response = await ctx.fetch(url, {
    headers: {
      accept: 'application/json',
      // crates.io's data-access policy asks for a descriptive agent.
      'user-agent': 'rome-opencli-crates (Rome reader plugin)',
    },
  })

  if (!response.ok) {
    throw new Error(`crates.io 返回 ${response.status} ${response.statusText}`)
  }

  const body = await response.json()

  if (!Array.isArray(body?.crates)) {
    throw new Error('crates.io 没有返回 crates 数组，接口可能已经变了')
  }

  if (body.crates.length === 0) {
    throw new Error(`crates.io 没有找到与 "${query}" 匹配的包`)
  }

  const entries = body.crates.slice(0, limit).map(toEntry)

  ctx.log.info(`opencli-crates-search: ${entries.length} 条（${query}）`)

  return { entries }
}
