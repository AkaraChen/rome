// Ported from RSSHub lib/routes/dockerhub/repositories.ts (AGPL-3.0).
// Docker Hub 某个所有者下的仓库列表 — one JSON request, no article pages.

export const meta = {
  id: 'rome.rsshub-dockerhub-repositories',
  name: 'Docker Hub · Owner Repositories',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: '列出 Docker Hub 指定所有者名下的镜像仓库',
  icon: 'https://hub.docker.com/favicon.ico',
  params: {
    fields: [
      {
        key: 'owner',
        type: 'text',
        label: '镜像所有者',
        help: '例如 library 或 diygod',
        default: '',
      },
    ],
  },
}

const PAGE_SIZE = 10

function escape(text) {
  return String(text ?? '').replace(/[&<>"]/g, (ch) => {
    if (ch === '&') return '&amp;'
    if (ch === '<') return '&lt;'
    if (ch === '>') return '&gt;'
    return '&quot;'
  })
}

export async function fetch(ctx) {
  const owner = String(ctx.params.owner ?? '').trim().toLowerCase()

  if (!owner) {
    throw new Error('缺少镜像所有者，例如 library 或 diygod')
  }

  const url = `https://hub.docker.com/v2/repositories/${encodeURIComponent(owner)}?page_size=${PAGE_SIZE}`
  ctx.log.debug(`dockerhub-repositories: GET ${url}`)

  const response = await ctx.fetch(url, { headers: { accept: 'application/json' } })

  if (!response.ok) {
    throw new Error(`Docker Hub 返回 ${response.status} ${response.statusText}`)
  }

  const body = await response.json()
  const repos = body?.results

  if (!Array.isArray(repos)) {
    throw new Error('Docker Hub 没有返回仓库列表，接口可能已经变了')
  }

  const entries = repos.map((repo) => {
    const entry = {
      // An owner/name pair is the repository's permanent identity.
      id: `dockerhub:repo:${owner}/${repo.name}`,
      title: repo.name,
      url: `https://hub.docker.com/r/${owner}/${repo.name}`,
      author: owner,
      summary: `★ ${repo.star_count ?? 0} · 拉取 ${repo.pull_count ?? 0}`,
    }

    const publishedAt = Math.floor(Date.parse(repo.last_updated) / 1000)
    if (Number.isFinite(publishedAt)) entry.publishedAt = publishedAt

    const parts = []
    if (repo.description) parts.push(escape(repo.description))
    if (repo.status_description) parts.push(`状态：${escape(repo.status_description)}`)
    parts.push(`星标：${repo.star_count ?? 0}`)
    parts.push(`拉取：${repo.pull_count ?? 0}`)
    entry.content = `<p>${parts.join('<br>')}</p>`

    return entry
  })

  if (entries.length === 0) {
    throw new Error(`Docker Hub 没有找到所有者 ${owner} 的仓库`)
  }

  ctx.log.info(`dockerhub-repositories: ${owner} ${entries.length} 个仓库`)

  return { entries, icon: 'https://hub.docker.com/favicon.ico' }
}
