// Ported from OpenCLI clis/maven/search.js (Apache-2.0).
// Maven Central 构件搜索 — OpenCLI's `maven search` command.
//
// The Solr endpoint behind search.maven.org is public and unauthenticated. It
// returns one document per artifact, with the latest version and publish time
// inline.
//
// Ported from clis/maven/search.js and utils.js.

export const meta = {
  id: 'rome.opencli-maven-search',
  name: 'Maven Central · 构件搜索',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: '按关键词搜索 Maven Central 构件',
  icon: 'https://search.maven.org/favicon.ico',
  params: {
    fields: [
      {
        key: 'query',
        type: 'text',
        label: '关键词',
        help: '搜索词，例如 jackson、guava、ai.koog',
        default: '',
      },
      {
        key: 'limit',
        type: 'number',
        label: '条数',
        help: '最多返回多少条（1-200）',
        default: 30,
      },
    ],
  },
}

const API = 'https://search.maven.org/solrsearch/select'

function integer(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10)

  if (!Number.isFinite(parsed)) {
    return fallback
  }

  return Math.min(Math.max(parsed, min), max)
}

function toEntry(document) {
  const groupId = String(document?.g ?? '').trim()
  const artifactId = String(document?.a ?? '').trim()

  // `groupId:artifactId` is the artifact's permanent coordinate and the id
  // below; a row missing either half is not addressable.
  if (!groupId || !artifactId) {
    throw new Error('Maven Central 返回了一条缺少 groupId 或 artifactId 的记录，接口可能已经变了')
  }

  const coordinate = `${groupId}:${artifactId}`
  const version = String(document.latestVersion ?? '').trim()
  const packaging = String(document.p ?? '').trim()
  const versions = document.versionCount != null ? Number(document.versionCount) : null
  const repository = String(document.repositoryId ?? '').trim()

  const parts = []

  if (version) parts.push(`最新 ${version}`)
  if (versions !== null) parts.push(`${versions} 个版本`)
  if (packaging) parts.push(packaging)
  if (repository) parts.push(repository)

  const entry = {
    id: `maven:${coordinate}`,
    title: coordinate,
    url: `https://central.sonatype.com/artifact/${groupId}/${artifactId}`,
  }

  if (parts.length > 0) entry.summary = parts.join(' · ')

  const timestamp = Number(document.timestamp)

  if (Number.isFinite(timestamp) && timestamp > 0) {
    // Solr reports milliseconds; entries are unix seconds.
    entry.publishedAt = Math.floor(timestamp / 1000)
  }

  return entry
}

export async function fetch(ctx) {
  const query = String(ctx.params?.query ?? '').trim()

  if (!query) {
    throw new Error('请填写搜索关键词')
  }

  const limit = integer(ctx.params?.limit, 30, 1, 200)
  const url = `${API}?q=${encodeURIComponent(query)}&rows=${limit}&wt=json`

  ctx.log.debug(`opencli-maven-search: GET ${url}`)

  const response = await ctx.fetch(url, {
    headers: {
      accept: 'application/json',
      'user-agent': 'rome-opencli-maven (Rome reader plugin)',
    },
  })

  if (!response.ok) {
    throw new Error(`Maven Central 返回 ${response.status} ${response.statusText}`)
  }

  const body = await response.json()

  if (!Array.isArray(body?.response?.docs)) {
    throw new Error('Maven Central 没有返回 response.docs 数组，接口可能已经变了')
  }

  if (body.response.docs.length === 0) {
    throw new Error(`Maven Central 没有找到与 "${query}" 匹配的构件`)
  }

  const entries = body.response.docs.slice(0, limit).map(toEntry)

  ctx.log.info(`opencli-maven-search: ${entries.length} 条（${query}）`)

  return { entries }
}
