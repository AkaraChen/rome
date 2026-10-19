// Ported from RSSHub lib/routes/furaffinity/art.ts (AGPL-3.0).
/**
 * FurAffinity -- Gallery / Scraps / Favorites.
 *
 * FAExport exposes each public folder as a JSON array. The API carries no
 * publication date, so entries sort by when Rome first sees them.
 */

export const meta = {
  id: 'rome.rsshub-furaffinity-art',
  name: 'FurAffinity · Gallery',
  version: '1.0.0',
  apiVersion: '1',
  view: 'pictures',
  description: '读取 FurAffinity 用户的画廊、收藏与 scraps',
  icon: 'https://www.furaffinity.net/favicon.ico',
  params: {
    fields: [
      {
        key: 'username',
        type: 'text',
        label: '用户名',
        help: '可在用户主页 URL 中找到',
        required: true,
        default: ''
      },
      {
        key: 'folder',
        type: 'select',
        label: '目录',
        help: '选择要读取的作品目录',
        default: 'gallery',
        options: [
          { value: 'gallery', label: '画廊 Gallery' },
          { value: 'scraps', label: '草图 Scraps' },
          { value: 'favorites', label: '收藏 Favorites' }
        ]
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
  const username = String(ctx.params.username || '').trim()
  const folder = String(ctx.params.folder || 'gallery')
  const mode = String(ctx.params.mode || 'sfw')

  if (!username) {
    throw new Error('furaffinity: 用户名不能为空')
  }

  if (!['gallery', 'scraps', 'favorites'].includes(folder)) {
    throw new Error('furaffinity: folder 只能是 gallery、scraps 或 favorites')
  }

  if (mode !== 'sfw' && mode !== 'nsfw') {
    throw new Error('furaffinity: mode 只能是 sfw 或 nsfw')
  }

  const base = `https://faexport.spangle.org.uk/user/${encodeURIComponent(username)}/${folder}.json?full=1`
  const url = mode === 'sfw' ? `${base}&sfw=1` : base
  const response = await ctx.fetch(url, { headers: { referer: 'https://faexport.spangle.org.uk/' } })

  if (!response.ok) {
    throw new Error(`furaffinity: ${folder} of ${username} returned ${response.status} ${response.statusText}`)
  }

  const data = await response.json()

  if (!Array.isArray(data)) {
    throw new Error(`furaffinity: ${folder} did not return a JSON array`)
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
