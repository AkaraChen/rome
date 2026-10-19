// Ported from RSSHub lib/routes/dockerhub/build.ts (AGPL-3.0).
// Docker Hub 镜像构建记录 — two JSON requests: the tag, then the repository
// metadata the feed description wants. The entry id includes every image
// digest, so a rebuild of the same tag is a new entry and a metadata edit is
// not.

export const meta = {
  id: 'rome.rsshub-dockerhub-build',
  name: 'Docker Hub · Image New Build',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: '追踪 Docker Hub 镜像指定标签的最后构建记录',
  icon: 'https://hub.docker.com/favicon.ico',
  params: {
    fields: [
      {
        key: 'owner',
        type: 'text',
        label: '镜像所有者',
        help: '官方镜像填 library，例如 library/mysql 的所有者为 library',
        default: '',
      },
      {
        key: 'image',
        type: 'text',
        label: '镜像名称',
        help: '例如 mysql',
        default: '',
      },
      {
        key: 'tag',
        type: 'text',
        label: '镜像标签',
        help: '默认为 latest',
        default: 'latest',
      },
    ],
  },
}

function bytes(value) {
  return Math.floor(Date.parse(value) / 1000)
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
  const tag = String(ctx.params.tag ?? '').trim() || 'latest'

  if (!owner) {
    throw new Error('缺少镜像所有者：官方镜像请填 library，例如 library/mysql')
  }

  if (!image) {
    throw new Error('缺少镜像名称，例如 mysql')
  }

  const namespace = `${owner}/${image}`
  const base = `https://hub.docker.com/v2/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(image)}`

  ctx.log.debug(`dockerhub-build: GET ${base}/tags/${tag}`)

  const tagData = await json(ctx, `${base}/tags/${encodeURIComponent(tag)}`)
  const metadata = await json(ctx, base)

  const images = Array.isArray(tagData.images) ? tagData.images : []

  if (images.length === 0) {
    throw new Error('镜像标签没有构建信息，接口可能已经变了')
  }

  // The published layer URL wants the digest with the colon turned into a
  // hyphen, and only the first architecture's digest is used.
  const first = images[0]
  const digest = String(first.digest ?? '').replace(':', '-')
  const size = Number(first.size)

  // Digest + architecture identifies the build itself. Metadata changes do not
  // make a new entry, which matches the upstream route's behaviour.
  const identity = images
    .map((item) => `${item.os}/${item.architecture}/${item.digest}`)
    .sort()
    .join('|')

  const entry = {
    id: `dockerhub:build:${namespace}:${tag}:${identity}`,
    title: `${namespace}:${tag} 已构建`,
    url: `https://hub.docker.com/layers/docker/${namespace}/${tag}/images/${digest}`,
    author: owner,
  }

  const publishedAt = bytes(tagData.last_updated)
  if (Number.isFinite(publishedAt)) entry.publishedAt = publishedAt

  const facts = []
  if (Number.isFinite(size)) facts.push(`${(size / 1_000_000).toFixed(2)} MB`)
  if (images.length > 1) facts.push(`${images.length} 个架构`)
  entry.summary = facts.join(' · ')

  if (metadata.description) {
    entry.content = `<p>${escape(metadata.description)}</p>`
  }

  ctx.log.info(`dockerhub-build: ${namespace}:${tag}`)

  return { entries: [entry], icon: 'https://hub.docker.com/favicon.ico' }
}
