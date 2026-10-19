// Ported from RSSHub lib/routes/dockerhub/tag.ts (AGPL-3.0).
// Docker Hub 镜像标签更新 — the tags endpoint lists every pushed tag and the
// architectures it carries. The entry id is tag name plus the set of image
// digests, so re-pushing a tag produces a new entry.

export const meta = {
  id: 'rome.rsshub-dockerhub-tag',
  name: 'Docker Hub · Image New Tag',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: '追踪 Docker Hub 镜像标签的更新与架构支持',
  icon: 'https://hub.docker.com/favicon.ico',
  params: {
    fields: [
      {
        key: 'owner',
        type: 'text',
        label: '镜像所有者',
        help: '官方镜像填 library，例如 library/mysql',
        default: '',
      },
      {
        key: 'image',
        type: 'text',
        label: '镜像名称',
        help: '例如 mariadb',
        default: '',
      },
      {
        key: 'limits',
        type: 'number',
        label: '标签数量',
        help: '返回多少个标签，默认为 10',
        default: 10,
        min: 1,
        max: 100,
      },
    ],
  },
}

function escape(text) {
  return String(text ?? '').replace(/[&<>"]/g, (ch) => {
    if (ch === '&') return '&amp;'
    if (ch === '<') return '&lt;'
    if (ch === '>') return '&gt;'
    return '&quot;'
  })
}

async function json(ctx, url) {
  const response = await ctx.fetch(url, { headers: { accept: 'application/json' } })

  if (!response.ok) {
    throw new Error(`Docker Hub 返回 ${response.status} ${response.statusText}`)
  }

  return response.json()
}

export async function fetch(ctx) {
  const owner = String(ctx.params.owner ?? '').trim()
  const image = String(ctx.params.image ?? '').trim()
  const limits = Number.parseInt(ctx.params.limits, 10)
  const pageSize = Number.isFinite(limits) ? Math.min(Math.max(limits, 1), 100) : 10

  if (!owner) {
    throw new Error('缺少镜像所有者：官方镜像请填 library，例如 library/mysql')
  }

  if (!image) {
    throw new Error('缺少镜像名称，例如 mariadb')
  }

  const namespace = `${owner}/${image}`
  const base = `https://hub.docker.com/v2/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(image)}`

  ctx.log.debug(`dockerhub-tag: GET ${base}/tags/?page_size=${pageSize}`)

  const tags = await json(ctx, `${base}/tags/?page_size=${pageSize}`)
  const metadata = await json(ctx, base)
  const results = tags?.results

  if (!Array.isArray(results)) {
    throw new Error('Docker Hub 没有返回标签列表，接口可能已经变了')
  }

  const entries = results.map((item) => {
    const images = Array.isArray(item.images) ? item.images : []
    const architectures = images.length > 0
      ? images.map((img) => `${img.os}/${img.architecture}`).join(', ')
      : '未知架构'

    // The digest set is what changes when a tag is re-pushed. The tag name
    // alone is not enough: it is reused for every rebuild.
    const identity = images
      .map((img) => `${img.os}/${img.architecture}/${img.digest}`)
      .sort()
      .join('|')

    const digest = String(item.digest ?? '').replace(':', '-')
    const layer = owner === 'library'
      ? `https://hub.docker.com/layers/${image}/${namespace}/${item.name}/images/${digest}`
      : `https://hub.docker.com/layers/${namespace}/${item.name}/images/${digest}`

    const entry = {
      id: `dockerhub:tag:${namespace}:${item.name}:${identity}`,
      title: `${namespace}:${item.name} 已更新`,
      url: layer,
      author: owner,
      summary: `支持 ${architectures}`,
    }

    const publishedAt = Math.floor(Date.parse(item.tag_last_pushed) / 1000)
    if (Number.isFinite(publishedAt)) entry.publishedAt = publishedAt

    return entry
  })

  if (entries.length === 0) {
    throw new Error(`Docker Hub 没有找到 ${namespace} 的标签`)
  }

  ctx.log.info(`dockerhub-tag: ${namespace} ${entries.length} 个标签`)

  return {
    entries,
    icon: 'https://hub.docker.com/favicon.ico',
  }
}
