// Ported from RSSHub lib/routes/github/pulls.ts (AGPL-3.0).
// GitHub 仓库 Pull Request — /github/pull/:user/:repo/:state/:labels
//
// Every pull request is also an issue, so the same endpoint answers this route;
// the filter is the opposite of the issues plugin's — keep the ones that carry
// `pull_request`, and read the page URL from it.

export const meta = {
  id: 'rome.rsshub-github-pulls',
  name: 'GitHub · 仓库 Pull Request',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: 'GitHub 仓库的 Pull Request 列表',
  icon: 'https://github.com/favicon.ico',
  params: {
    fields: [
      {
        key: 'user',
        type: 'text',
        label: '用户名',
        help: '仓库所有者的 GitHub 用户名',
        placeholder: 'DIYgod',
        default: '',
      },
      {
        key: 'repo',
        type: 'text',
        label: '仓库名',
        help: '仓库名称',
        placeholder: 'RSSHub',
        default: '',
      },
      {
        key: 'state',
        type: 'select',
        label: '状态',
        default: 'open',
        options: [
          { value: 'open', label: '开启' },
          { value: 'closed', label: '已关闭' },
          { value: 'all', label: '全部' },
        ],
      },
      {
        key: 'labels',
        type: 'text',
        label: '标签',
        help: '用英文逗号分隔的标签名，例如 bug,help wanted',
        placeholder: 'bug,help wanted',
        default: '',
      },
    ],
  },
}

const API = 'https://api.github.com'
const STATES = new Set(['open', 'closed', 'all'])

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
    throw new Error('GitHub 上找不到这个仓库')
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
  const repo = String(ctx.params.repo || '').trim()

  if (!user || !repo) {
    throw new Error('请填写仓库的用户名和仓库名')
  }

  const state = STATES.has(ctx.params.state) ? ctx.params.state : 'open'
  const labels = String(ctx.params.labels || '').trim()

  const url = new URL(`${API}/repos/${encodeURIComponent(user)}/${encodeURIComponent(repo)}/issues`)
  url.searchParams.set('state', state)
  if (labels) url.searchParams.set('labels', labels)
  url.searchParams.set('sort', 'created')
  url.searchParams.set('direction', 'desc')
  url.searchParams.set('per_page', '100')

  const issues = await github(ctx, url)

  if (!Array.isArray(issues)) {
    throw new Error('GitHub 没有返回 Issue 数组，接口可能已经变了')
  }

  const entries = issues
    .filter((issue) => issue.pull_request)
    .map((issue) => {
      const entry = {
        id: `github-pulls:${user}/${repo}#${issue.number}`,
        title: issue.title,
        url: issue.html_url,
        author: issue.user?.login,
        summary: firstLine(issue.body, 140) || '暂无描述',
      }

      const publishedAt = Date.parse(issue.created_at || '')
      if (Number.isFinite(publishedAt)) entry.publishedAt = Math.floor(publishedAt / 1000)

      return entry
    })

  ctx.log.info(`github-pulls: ${entries.length} 条（${user}/${repo}，${state}）`)

  return { entries }
}

export async function preview(ctx) {
  const content = await ctx.article(ctx.item.url)
  return content ? { content } : null
}
