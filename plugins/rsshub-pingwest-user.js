// Ported from RSSHub lib/routes/pingwest/user.ts (AGPL-3.0).
// 品玩 — 用户主页。
//
// 用户页只用来拿真实的数字 uid（URL 里的 uid 是自定义短名），列表来自
// /api/user_data。文章和动态是两套标记，所以有两个解析函数。

export const meta = {
  id: 'rome.rsshub-pingwest-user',
  name: '品玩 · 用户',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: '抓取品玩某个用户的文章或动态',
  icon: 'https://www.pingwest.com/favicon.ico',
  params: {
    fields: [
      {
        key: 'uid',
        type: 'text',
        label: '用户 id',
        help: '用户主页 URL 中的 id，可以是自定义短名',
        default: '',
      },
      {
        key: 'type',
        type: 'select',
        label: '内容类型',
        help: 'article 为文章，state 为动态',
        default: 'article',
        options: [
          { value: 'article', label: '文章' },
          { value: 'state', label: '动态' },
        ],
      },
      {
        key: 'option',
        type: 'select',
        label: '输出方式',
        help: 'fulltext 表示打开条目时抓取全文',
        default: '',
        options: [
          { value: '', label: '摘要' },
          { value: 'fulltext', label: '全文' },
        ],
      },
    ],
  },
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

function decode(text) {
  return String(text ?? '').replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity) => {
    if (entity[0] === '#') {
      const code = entity[1] === 'x' || entity[1] === 'X'
        ? Number.parseInt(entity.slice(2), 16)
        : Number.parseInt(entity.slice(1), 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : match
    }
    return Object.prototype.hasOwnProperty.call(ENTITIES, entity) ? ENTITIES[entity] : match
  })
}

function strip(text) {
  return decode(String(text ?? '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim()
}

function absolute(href) {
  if (!href) return null
  try {
    return new URL(decode(href), 'https://www.pingwest.com/').href
  } catch {
    return null
  }
}

function image(url) {
  return url ? decode(url).split('?x-', 1)[0] : undefined
}

function chineseDate(text) {
  const value = strip(text)

  let match = /(\d{4})年(\d{1,2})月(\d{1,2})日/.exec(value)
  if (match) return Math.floor(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / 1000)

  match = /(\d{4})-(\d{1,2})-(\d{1,2})/.exec(value)
  if (match) return Math.floor(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / 1000)

  match = /(\d+)\s*(分钟|小时|天)前/.exec(value)
  if (match) {
    const unit = match[2] === '分钟' ? 60 : match[2] === '小时' ? 3600 : 86400
    return Math.floor(Date.now() / 1000) - Number(match[1]) * unit
  }

  return undefined
}

function parseArticles(html, prefix) {
  const entries = []

  for (const match of html.matchAll(/<article id="(\d+)"[^>]*>([\s\S]*?)<\/article>/g)) {
    const block = match[2]
    const title = /<a[^>]*class="title"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(block)
      || /<a[^>]*href="([^"]+)"[^>]*class="title"[^>]*>([\s\S]*?)<\/a>/.exec(block)

    if (!title) continue

    const heading = strip(title[2])
    if (!heading) continue

    const entry = {
      id: `${prefix}:${match[1]}`,
      title: heading,
      url: absolute(title[1]),
    }

    const description = /<p class="desc">([\s\S]*?)<\/p>/.exec(block)
    if (description) {
      const summary = strip(description[1])
      if (summary) entry.summary = summary
    }

    const picture = /<section class="news-img">[\s\S]*?<img[^>]*src="([^"]+)"/.exec(block)
    if (picture) entry.image = image(picture[1])

    const date = /<span class="time">([\s\S]*?)<\/span>/.exec(block)
    if (date) {
      const publishedAt = chineseDate(date[1])
      if (publishedAt !== undefined) entry.publishedAt = publishedAt
    }

    entries.push(entry)
  }

  return entries
}

/// 动态的列表项带 `pt` 时间戳，正文在 .news-detail 里，链接取正文里的第一条。
function parseStates(html, prefix) {
  const entries = []

  for (const match of html.matchAll(/<article\b[^>]*\bpt="(\d+)"[^>]*>([\s\S]*?)<\/article>/g)) {
    const block = match[2]
    const link = /<a[^>]*href="([^"]+)"/.exec(block)
    const detail = /<section class="news-detail">([\s\S]*?)<\/section>/.exec(block)
    const text = strip(detail?.[1] ?? block).replace(/展开全文$/, '')

    if (!text) continue

    const entry = {
      id: `${prefix}:state:${match[1]}`,
      title: text.slice(0, 80),
      url: absolute(link?.[1]),
      summary: text,
    }

    const picture = /<img[^>]*src="([^"]+)"/.exec(block)
    if (picture) entry.image = image(picture[1])

    const publishedAt = Number(match[1])
    if (Number.isFinite(publishedAt) && publishedAt > 0) entry.publishedAt = publishedAt

    entries.push(entry)
  }

  return entries
}

export async function fetch(ctx) {
  const uid = String(ctx.params.uid || '').trim()
  const type = String(ctx.params.type || 'article').trim() || 'article'
  const option = String(ctx.params.option || '').trim()

  if (!uid) {
    throw new Error('请填写用户 id')
  }

  if (type !== 'article' && type !== 'state') {
    throw new Error('内容类型只能是 article 或 state')
  }

  const profileUrl = `https://www.pingwest.com/user/${encodeURIComponent(uid)}/${type}`

  ctx.log.debug(`pingwest: GET ${profileUrl}`)

  const profileResponse = await ctx.fetch(profileUrl, { headers: { accept: 'text/html' } })

  if (!profileResponse.ok) {
    throw new Error(`品玩用户页返回 ${profileResponse.status} ${profileResponse.statusText}`)
  }

  const profile = await profileResponse.text()
  const nameTag = /<span[^>]*\bid="J_userId"[^>]*>([\s\S]*?)<\/span>/.exec(profile)
  const realUid = nameTag ? /data-user-id="(\d+)"/.exec(nameTag[0])?.[1] : undefined
  const sign = /<p[^>]*id="J_userSign"[^>]*>([\s\S]*?)<\/p>/.exec(profile)
  const avatarTag = /<img[^>]*\bid="J_userAvatar"[^>]*>/.exec(profile)
  const avatar = avatarTag
    ? /(?:data-source-img|src)="([^"]+)"/.exec(avatarTag[0])?.[1]
    : undefined

  if (!realUid) {
    throw new Error('品玩用户页没有找到数字用户 id，用户可能不存在')
  }

  const url = `https://www.pingwest.com/api/user_data?page=1&user_id=${realUid}&tab=${type}`

  ctx.log.debug(`pingwest: GET ${url}`)

  const response = await ctx.fetch(url, { headers: { accept: 'application/json' } })

  if (!response.ok) {
    throw new Error(`品玩返回 ${response.status} ${response.statusText}`)
  }

  const body = await response.json()
  const html = body?.data?.list

  if (typeof html !== 'string' || html === '') {
    throw new Error('品玩用户接口没有返回内容，该用户可能没有这一类的条目')
  }

  const entries = type === 'article'
    ? parseArticles(html, `pingwest-user-${realUid}`)
    : parseStates(html, `pingwest-user-${realUid}`)

  if (entries.length === 0) {
    throw new Error('品玩用户接口没有返回任何条目，页面结构可能已经变了')
  }

  for (const entry of entries) {
    entry.params = { fulltext: option === 'fulltext' }
  }

  const result = { entries }

  if (avatar) result.icon = decode(avatar)
  if (sign) ctx.log.debug(`pingwest: ${strip(sign[1])}`)

  ctx.log.info(`pingwest: 用户 ${uid} 共 ${entries.length} 条`)

  return result
}

export async function preview(ctx) {
  if (!ctx.item?.params?.fulltext) return null

  const url = ctx.item?.url
  if (!url) return null

  const content = await ctx.article(url)
  return content === null ? null : { content }
}
