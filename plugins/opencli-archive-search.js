// Ported from OpenCLI clis/archive/search.js (Apache-2.0).
// Internet Archive 搜索 — OpenCLI 的 `archive search`.
//
// Advanced Search 公开接口，覆盖书籍、影片、音频、软件和网页归档。
// 移植自 clis/archive/search.js。

export const meta = {
  id: 'rome.opencli-archive-search',
  name: 'Internet Archive · 搜索',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: '在 Internet Archive 中搜索书籍、影片、音频和软件。',
  icon: 'https://archive.org/favicon.ico',
  params: {
    fields: [
      {
        key: 'query',
        type: 'text',
        label: '关键词',
        help: '匹配标题、描述、作者或主题',
        default: '',
      },
      {
        key: 'mediatype',
        type: 'select',
        label: '媒体类型',
        default: '',
        options: [
          { value: '', label: '全部' },
          { value: 'texts', label: '文本' },
          { value: 'movies', label: '影片' },
          { value: 'audio', label: '音频' },
          { value: 'software', label: '软件' },
          { value: 'image', label: '图片' },
          { value: 'web', label: '网页' },
          { value: 'data', label: '数据' },
          { value: 'collection', label: '合集' },
        ],
      },
      {
        key: 'sort',
        type: 'select',
        label: '排序',
        default: 'downloads',
        options: [
          { value: 'downloads', label: '下载量' },
          { value: 'date', label: '日期' },
          { value: 'addeddate', label: '入库日期' },
          { value: 'week', label: '本周' },
          { value: 'title', label: '标题' },
        ],
      },
      {
        key: 'limit',
        type: 'number',
        label: '条数',
        help: '最多 100 条',
        default: 20,
        min: 1,
        max: 100,
      },
    ],
  },
}

const SEARCH = 'https://archive.org/advancedsearch.php'
const SORTS = ['downloads', 'date', 'addeddate', 'week', 'title']
const MEDIATYPES = ['texts', 'movies', 'audio', 'software', 'image', 'web', 'data', 'collection']
const IDENTIFIER = /^[A-Za-z0-9._-]+$/

function integer(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(Math.max(parsed, min), max)
}

function seconds(value) {
  const text = String(value ?? '').slice(0, 10)

  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return undefined

  const milliseconds = Date.parse(text)
  return Number.isFinite(milliseconds) ? Math.floor(milliseconds / 1000) : undefined
}

export async function fetch(ctx) {
  const query = String(ctx.params?.query ?? '').trim()

  if (!query) {
    throw new Error('请填写搜索关键词')
  }

  const mediatype = String(ctx.params?.mediatype ?? '').trim()
  const sort = String(ctx.params?.sort ?? 'downloads').trim().toLowerCase()
  const limit = integer(ctx.params?.limit, 20, 1, 100)

  if (mediatype && !MEDIATYPES.includes(mediatype)) {
    throw new Error(`Internet Archive 媒体类型不合法：${mediatype}`)
  }

  if (!SORTS.includes(sort)) {
    throw new Error(`Internet Archive 排序方式不合法：${sort}`)
  }

  const fullQuery = mediatype ? `(${query}) AND mediatype:${mediatype}` : query

  const url = new URL(SEARCH)
  url.searchParams.set('q', fullQuery)
  url.searchParams.set('output', 'json')
  url.searchParams.set('rows', String(limit))
  url.searchParams.set('sort[]', `${sort} desc`)

  for (const field of ['identifier', 'title', 'creator', 'date', 'mediatype', 'downloads']) {
    url.searchParams.append('fl[]', field)
  }

  ctx.log.debug(`opencli-archive-search: GET ${url.href}`)

  const response = await ctx.fetch(url, {
    headers: {
      accept: 'application/json',
      'user-agent': 'opencli/1.0 (+https://github.com/jackwener/opencli)',
    },
  })

  if (!response.ok) {
    throw new Error(`Internet Archive 返回 HTTP ${response.status}`)
  }

  const data = await response.json()
  const docs = data?.response?.docs

  if (!Array.isArray(docs)) {
    throw new Error('Internet Archive 返回了意料之外的数据，response.docs 不是数组')
  }

  if (docs.length === 0) {
    throw new Error(`Internet Archive 没有找到与 "${query}" 匹配的条目`)
  }

  const entries = []

  for (const [index, doc] of docs.slice(0, limit).entries()) {
    const identifier = String(doc?.identifier ?? '')

    // identifier 是详情页地址的一部分，也是去重键；不合法的行不能猜。
    if (!IDENTIFIER.test(identifier)) {
      throw new Error(`Internet Archive 返回了缺少合法 identifier 的行：${JSON.stringify(doc?.identifier)}`)
    }

    const creator = Array.isArray(doc.creator)
      ? doc.creator.join(', ')
      : String(doc.creator ?? '')

    const downloads = Number(doc.downloads ?? 0)

    if (!Number.isFinite(downloads)) {
      throw new Error(`Internet Archive 返回的 "${identifier}" 下载量不是数字`)
    }

    const date = doc.date ? String(doc.date).slice(0, 10) : ''
    const parts = [`#${index + 1}`]

    if (doc.mediatype) parts.push(String(doc.mediatype))
    parts.push(`下载 ${downloads}`)
    if (date) parts.push(date)

    const entry = {
      id: `archive:${identifier}`,
      title: String(doc.title ?? '').trim() || identifier,
      url: `https://archive.org/details/${identifier}`,
      summary: parts.join(' · '),
      // Archive 自己的缩略图服务按 identifier 取封面。
      image: `https://archive.org/services/img/${identifier}`,
      params: { identifier },
    }

    if (creator.trim()) entry.author = creator.trim()

    const publishedAt = seconds(doc.date)
    if (publishedAt !== undefined) entry.publishedAt = publishedAt

    entries.push(entry)
  }

  ctx.log.info(`opencli-archive-search: ${entries.length} 条（${query}）`)

  return { entries }
}
