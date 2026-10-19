// Ported from OpenCLI clis/npm/search.js (Apache-2.0).
// npm 包搜索 — OpenCLI's `npm search` command.
//
// The npm registry's search endpoint is public and returns download counts and
// the publisher inline, so one request is enough. No key, no cookies, no
// browser.
//
// Ported from clis/npm/search.js and utils.js.

export const meta = {
  id: 'rome.opencli-npm-search',
  name: 'npm · 包搜索',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: '按关键词搜索 npm 仓库中的 JavaScript 包',
  icon: 'https://www.npmjs.com/favicon.ico',
  params: {
    fields: [
      {
        key: 'query',
        type: 'text',
        label: '关键词',
        help: '搜索词，例如 react、graphql client',
        default: '',
      },
      {
        key: 'limit',
        type: 'number',
        label: '条数',
        help: '最多返回多少条（1-250）',
        default: 20,
      },
    ],
  },
}

const API = 'https://registry.npmjs.org/-/v1/search'

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

function toEntry(object) {
  const pkg = object?.package ?? {}
  const name = String(pkg.name ?? '').trim()

  if (!name) {
    throw new Error('npm 返回了一条没有名称的记录，接口可能已经变了')
  }

  const version = String(pkg.version ?? '').trim()
  const description = String(pkg.description ?? '').trim()
  const license = String(pkg.license ?? '').trim()
  const publisher = String(pkg.publisher?.username ?? '').trim()
  const weekly = object.downloads?.weekly != null ? Number(object.downloads.weekly) : null
  const dependents = object.dependents != null ? Number(object.dependents) : null

  const parts = []

  if (version) parts.push(`v${version}`)
  if (weekly !== null) parts.push(`${count(weekly)} 周下载`)
  if (dependents !== null) parts.push(`${count(dependents)} 个依赖者`)
  if (license) parts.push(license)
  if (publisher) parts.push(publisher)

  const entry = {
    // The package name is the registry's own id; scoped names keep their
    // `@scope/` prefix.
    id: `npm:${name}`,
    title: name,
    url: typeof pkg.links?.npm === 'string' && pkg.links.npm
      ? pkg.links.npm
      : `https://www.npmjs.com/package/${name}`,
  }

  if (publisher) entry.author = publisher
  if (description) entry.content = description
  if (parts.length > 0) entry.summary = parts.join(' · ')

  const updated = Date.parse(object.updated)
  if (Number.isFinite(updated)) entry.publishedAt = Math.floor(updated / 1000)

  return entry
}

export async function fetch(ctx) {
  const query = String(ctx.params?.query ?? '').trim()

  if (!query) {
    throw new Error('请填写搜索关键词')
  }

  const limit = integer(ctx.params?.limit, 20, 1, 250)
  const url = `${API}?text=${encodeURIComponent(query)}&size=${limit}`

  ctx.log.debug(`opencli-npm-search: GET ${url}`)

  const response = await ctx.fetch(url, {
    headers: {
      accept: 'application/json',
      'user-agent': 'rome-opencli-npm (Rome reader plugin)',
    },
  })

  if (!response.ok) {
    throw new Error(`npm 返回 ${response.status} ${response.statusText}`)
  }

  const body = await response.json()

  if (!Array.isArray(body?.objects)) {
    throw new Error('npm 没有返回 objects 数组，接口可能已经变了')
  }

  if (body.objects.length === 0) {
    throw new Error(`npm 没有找到与 "${query}" 匹配的包`)
  }

  const entries = body.objects.slice(0, limit).map(toEntry)

  ctx.log.info(`opencli-npm-search: ${entries.length} 条（${query}）`)

  return { entries }
}
