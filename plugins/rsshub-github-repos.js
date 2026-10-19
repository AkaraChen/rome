// Ported from RSSHub lib/routes/github/repos.ts (AGPL-3.0).
// GitHub 用户仓库 — /github/repos/:user/:type/:sort
//
// The public REST API without a token: 60 requests an hour per address, which
// a refresh every few minutes fits inside. The route also accepts a token in
// RSSHub, but this plugin has no settings for one — an unauthenticated source
// works for everyone, and the rate limit is reported clearly when it is hit.

export const meta = {
  id: 'rome.rsshub-github-repos',
  name: 'GitHub · 用户仓库',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: 'GitHub 用户或组织的公开仓库列表',
  icon: 'https://github.com/favicon.ico',
  params: {
    fields: [
      {
        key: 'user',
        type: 'text',
        label: '用户名',
        help: 'GitHub 用户名或组织名',
        placeholder: 'DIYgod',
        default: '',
      },
      {
        key: 'type',
        type: 'select',
        label: '仓库类型',
        default: 'all',
        options: [
          { value: 'all', label: '全部' },
          { value: 'owner', label: '本人所有' },
          { value: 'member', label: '所属组织' },
          { value: 'public', label: '公开' },
          { value: 'private', label: '私有' },
          { value: 'forks', label: 'Fork' },
          { value: 'sources', label: '非 Fork' },
        ],
      },
      {
        key: 'sort',
        type: 'select',
        label: '排序',
        default: 'created',
        options: [
          { value: 'created', label: '创建时间' },
          { value: 'updated', label: '更新时间' },
          { value: 'pushed', label: '推送时间' },
          { value: 'full_name', label: '名称' },
        ],
      },
    ],
  },
}

const API = 'https://api.github.com'
const TYPES = new Set(['all', 'owner', 'member', 'public', 'private', 'forks', 'sources'])
const SORTS = new Set(['created', 'updated', 'pushed', 'full_name'])

/// A body is a whole description; a list wants one line of it.
function firstLine(text, limit) {
  const line = String(text ?? '').replace(/\s+/g, ' ').trim()
  if (!line) return undefined
  return line.length > limit ? `${line.slice(0, limit - 1)}…` : line
}

async function github(ctx, url) {
  const response = await ctx.fetch(url, {
    headers: {
      accept: 'application/vnd.github+json',
      'user-agent': 'rome',
    },
  })

  if (response.status === 404) {
    throw new Error('GitHub 上找不到这个用户或仓库')
  }

  if (response.status === 403 || response.status === 429) {
    throw new Error('GitHub 接口限流了（未登录每小时 60 次），稍后再试')
  }

  if (!response.ok) {
    throw new Error(`GitHub 返回 ${response.status}（${url}）`)
  }

  return response.json()
}

export async function fetch(ctx) {
  const user = String(ctx.params.user || '').trim()

  if (!user) {
    throw new Error('请填写 GitHub 用户名')
  }

  const type = TYPES.has(ctx.params.type) ? ctx.params.type : 'all'
  const sort = SORTS.has(ctx.params.sort) ? ctx.params.sort : 'created'

  const url = new URL(`${API}/users/${encodeURIComponent(user)}/repos`)
  url.searchParams.set('type', type)
  url.searchParams.set('sort', sort)
  url.searchParams.set('direction', 'desc')
  url.searchParams.set('per_page', '100')

  const repos = await github(ctx, url)

  if (!Array.isArray(repos)) {
    throw new Error('GitHub 没有返回仓库数组，接口可能已经变了')
  }

  const entries = repos.map((repo) => {
    const entry = {
      id: `github-repos:${repo.full_name}`,
      title: repo.name,
      url: repo.html_url,
      author: repo.owner?.login,
      summary: firstLine(repo.description, 140) || '暂无描述',
    }

    // The date the route sorts by is the date it shows, so the list reads in
    // the order it claims to.
    const stamp = sort === 'updated' ? repo.updated_at : sort === 'pushed' ? repo.pushed_at : repo.created_at
    const publishedAt = Date.parse(stamp || repo.created_at || '')

    if (Number.isFinite(publishedAt)) entry.publishedAt = Math.floor(publishedAt / 1000)

    return entry
  })

  ctx.log.info(`github-repos: ${entries.length} 个仓库（${user}，${type}/${sort}）`)

  return { entries }
}
