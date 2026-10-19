// Ported from RSSHub lib/routes/furaffinity/search.ts (AGPL-3.0).
/**
 * FurAffinity -- Search.
 *
 * FAExport proxies FA search as JSON. routeParams is kept as a raw query
 * string because the upstream route accepts any combination of order_by,
 * order_direction, range, pattern and type.
 */

export const meta = {
  id: 'rome.rsshub-furaffinity-search',
  name: 'FurAffinity · Search',
  version: '1.0.0',
  apiVersion: '1',
  view: 'pictures',
  description: '按关键词搜索 FurAffinity 的公开作品',
  icon: 'https://www.furaffinity.net/favicon.ico',
  params: {
    fields: [
      {
        key: 'query',
        type: 'text',
        label: '搜索关键词',
        help: '要搜索的内容',
        required: true,
        default: ''
      },
      {
        key: 'mode',
        type: 'select',
        label: '内容分级',
        help: '选择 sfw 只看安全内容，选择 nsfw 包含 R18',
        default: 'sfw',
        options: [
          { value: 'sfw', label: '安全内容' },
          { value: 'nsfw', label: '包含 R18' }
        ]
      },
      {
        key: 'routeParams',
        type: 'text',
        label: '附加搜索参数',
        help: '例如 order_by=date&range=7days&type=art，留空则按相关度排序',
        default: 'order_by=relevancy'
      }
    ]
  }
};

function toEntry(item) {
  if (!item || !item.link) {
    return null
  }

  const entry = {
    id: `furaffinity:${item.id || item.link}`,
    title: item.title || '（无标题）',
    url: item.link,
    params: { image: item.thumbnail || '' }
  }

  if (item.name) {
    entry.author = item.name
    entry.summary = `作者：${item.name}`
  }

  if (item.thumbnail) {
    entry.image = item.thumbnail
  }

  return entry
}

export async function fetch(ctx) {
  const query = String(ctx.params.query || '').trim()
  const mode = String(ctx.params.mode || 'sfw')
  const routeParams = String(ctx.params.routeParams || '').trim() || 'order_by=relevancy'

  if (!query) {
    throw new Error('furaffinity: 搜索关键词不能为空')
  }

  if (mode !== 'sfw' && mode !== 'nsfw') {
    throw new Error('furaffinity: mode 只能是 sfw 或 nsfw')
  }

  const search = new URLSearchParams(routeParams)
  search.set('q', query)
  search.set('full', '1')

  if (mode === 'sfw') {
    search.set('sfw', '1')
  } else {
    search.delete('sfw')
  }

  const url = `https://faexport.spangle.org.uk/search.json?${search.toString()}`
  const response = await ctx.fetch(url, { headers: { referer: 'https://faexport.spangle.org.uk/' } })

  if (!response.ok) {
    throw new Error(`furaffinity: search returned ${response.status} ${response.statusText}`)
  }

  const data = await response.json()

  if (!Array.isArray(data)) {
    throw new Error('furaffinity: search did not return a JSON array')
  }

  return {
    entries: data.map(toEntry).filter(Boolean),
    icon: 'https://www.furaffinity.net/favicon.ico'
  }
}

export async function preview(ctx) {
  const image = ctx.item.params?.image
  const content = await ctx.article(ctx.item.url)

  if (!content && !image) {
    return null
  }

  return { content: `${image ? `<p><img src="${image}"></p>` : ''}${content || ''}` }
}
