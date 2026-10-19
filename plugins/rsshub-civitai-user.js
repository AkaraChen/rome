// Ported from RSSHub lib/routes/civitai/user.ts (AGPL-3.0).
// Civitai — 用户的文章。
//
// 公开 REST 接口 /api/v1/articles?username= 按作者过滤，列表里没有正文，
// 正文要另开 /api/v1/articles/<id>。正文里的媒体写成 <edge-media> 自定义
// 标签，渲染时换成普通的 img/video/audio。

export const meta = {
  id: 'rome.rsshub-civitai-user',
  name: 'Civitai · 用户文章',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: '抓取 Civitai 某个用户发表的文章',
  icon: 'https://civitai.com/favicon.ico',
  params: {
    fields: [
      {
        key: 'username',
        type: 'text',
        label: '用户名',
        help: 'Civitai 用户名，即个人主页 URL 中的名字',
        default: '',
      },
    ],
  },
}

const IMAGE_BASE = 'https://image.civitai.com/xG1nkqKTMzGDvpLrqFT7WA'
const MEDIA_TYPES = ['image', 'video', 'audio']
const EXTENSIONS = { video: 'mp4', audio: 'mp3', image: 'jpeg' }

function seconds(value) {
  const milliseconds = Date.parse(value)
  return Number.isFinite(milliseconds) ? Math.floor(milliseconds / 1000) : undefined
}

function attribute(attributes, name) {
  const match = new RegExp(`\\b${name}="([^"]*)"`).exec(attributes)
  return match ? match[1] : null
}

/// edge-media 的 url 要么是绝对地址，要么是图床上的相对路径。
function mediaSource(url, type, filename) {
  if (/^https?:\/\//.test(url)) return url
  const name = filename || `${url}.${EXTENSIONS[type]}`
  return `${IMAGE_BASE}/${url}/original=true/${encodeURIComponent(name)}`
}

function renderMedia(html) {
  return String(html ?? '').replace(/<edge-media\b([^>]*)>(?:<\/edge-media>)?/g, (match, attributes) => {
    const url = attribute(attributes, 'url')
    const type = attribute(attributes, 'type')

    if (!url || !MEDIA_TYPES.includes(type)) return ''

    const src = mediaSource(url, type, attribute(attributes, 'filename'))
    if (type === 'image') return `<img src="${src}">`
    return `<${type} src="${src}" controls preload="metadata"></${type}>`
  })
}

function coverUrl(cover) {
  if (!cover?.url) return undefined
  return `${IMAGE_BASE}/${cover.url}/${cover.name ?? ''}`
}

export async function fetch(ctx) {
  const username = String(ctx.params.username || '').trim()

  if (!username) {
    throw new Error('请填写 Civitai 用户名')
  }

  const url = `https://civitai.com/api/v1/articles?username=${encodeURIComponent(username)}&limit=20`

  ctx.log.debug(`civitai: GET ${url}`)

  const response = await ctx.fetch(url, { headers: { accept: 'application/json' } })

  if (!response.ok) {
    throw new Error(`Civitai 返回 ${response.status} ${response.statusText}`)
  }

  const body = await response.json()

  if (!Array.isArray(body?.items)) {
    throw new Error('Civitai 接口没有返回 items 数组，接口可能已经变了')
  }

  if (body.items.length === 0) {
    throw new Error(`Civitai 用户 ${username} 没有文章`)
  }

  const entries = []

  for (const article of body.items) {
    if (!article?.id || !article.title) continue

    const entry = {
      id: `civitai-article:${article.id}`,
      title: article.title,
      url: `https://civitai.com/articles/${article.id}`,
      params: { articleId: article.id },
    }

    if (article.user?.username) entry.author = article.user.username

    const publishedAt = seconds(article.publishedAt)
    if (publishedAt !== undefined) entry.publishedAt = publishedAt

    const image = coverUrl(article.coverImage)
    if (image) entry.image = image

    const tags = (article.tags ?? []).map((tag) => tag?.name).filter(Boolean)
    if (tags.length > 0) entry.summary = tags.join(' · ')

    entries.push(entry)
  }

  if (entries.length === 0) {
    throw new Error('Civitai 接口没有返回任何文章')
  }

  ctx.log.info(`civitai: ${username} 共 ${entries.length} 篇`)

  return { entries }
}

export async function preview(ctx) {
  const articleId = ctx.item?.params?.articleId
  if (!articleId) return null

  const url = `https://civitai.com/api/v1/articles/${articleId}`

  ctx.log.debug(`civitai: GET ${url}`)

  const response = await ctx.fetch(url, { headers: { accept: 'application/json' } })

  if (!response.ok) {
    throw new Error(`Civitai 返回 ${response.status} ${response.statusText}`)
  }

  const article = await response.json()

  if (typeof article?.content !== 'string' || article.content === '') return null

  return { content: renderMedia(article.content) }
}
