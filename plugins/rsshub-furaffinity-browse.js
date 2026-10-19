// Ported from RSSHub lib/routes/furaffinity/browse.ts (AGPL-3.0).
/**
 * FurAffinity -- Browse.
 *
 * The FAExport service mirrors public FA listings as JSON, which is the only
 * endpoint that works without a browser. It does not provide publication dates.
 */

export const meta = {
  id: 'rome.rsshub-furaffinity-browse',
  name: 'FurAffinity · Browse',
  version: '1.0.0',
  apiVersion: '1',
  view: 'pictures',
  description: '读取 FurAffinity 公共浏览页的作品列表',
  icon: 'https://www.furaffinity.net/favicon.ico',
  params: {
    fields: [
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
      }
    ]
  }
};

const API = 'https://faexport.spangle.org.uk/browse.json'

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
  const mode = String(ctx.params.mode || 'sfw')

  if (mode !== 'sfw' && mode !== 'nsfw') {
    throw new Error('furaffinity: mode 只能是 sfw 或 nsfw')
  }

  const url = mode === 'sfw' ? `${API}?sfw=1` : API
  const response = await ctx.fetch(url, { headers: { referer: 'https://faexport.spangle.org.uk/' } })

  if (!response.ok) {
    throw new Error(`furaffinity: browse returned ${response.status} ${response.statusText}`)
  }

  const data = await response.json()

  if (!Array.isArray(data)) {
    throw new Error('furaffinity: browse did not return a JSON array')
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
