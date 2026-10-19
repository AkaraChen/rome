// Ported from RSSHub lib/routes/oschina/user.ts (AGPL-3.0).
// OSCHINA — one author's blog.
//
// The uid may be a number or a vanity ident; a vanity ident is resolved through
// the site's own lookup first. The blog list is a public JSON API, and the body
// of each post is read from the blog API in preview.

export const meta = {
  id: 'rome.rsshub-oschina-user',
  name: '开源中国 · 用户博客',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: '开源中国指定用户的博客',
  icon: 'https://www.oschina.net/favicon.ico',
  params: {
    fields: [
      {
        key: 'uid',
        type: 'text',
        label: '用户 id',
        help: '用户博客网址末尾的数字或自定义标识，例如 5499730',
        default: '',
      },
    ],
  },
}

const API = 'https://apiv1.oschina.net'
const BLOG = 'https://my.oschina.net'

function shanghaiSeconds(text) {
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(String(text).trim())
  if (!match) return undefined
  return Math.floor(Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]) - 8,
    Number(match[5]),
    Number(match[6] || 0),
  ) / 1000)
}

async function resolveUser(ctx, uid) {
  if (/^\d+$/.test(uid)) return uid

  const response = await ctx.fetch(`${API}/oschinapi/user/byIdent?ident=${encodeURIComponent(uid)}`, {
    headers: { accept: 'application/json' },
  })

  if (!response.ok) {
    throw new Error(`开源中国返回 ${response.status} ${response.statusText}`)
  }

  const payload = await response.json()
  const id = payload?.result
  if (payload?.code !== 200 || id === null || id === undefined) {
    throw new Error(`找不到用户 ${uid}`)
  }

  return String(id)
}

export async function fetch(ctx) {
  const uid = String(ctx.params.uid || '').trim()

  if (!uid) {
    throw new Error('请填写用户 id，例如 5499730')
  }

  const userId = await resolveUser(ctx, uid)
  const query = new URLSearchParams({ userId, pageNum: '1', pageSize: '10' })
  const response = await ctx.fetch(`${API}/oschinapi/blog/otherUser/web?${query}`, {
    headers: { accept: 'application/json' },
  })

  if (!response.ok) {
    throw new Error(`开源中国返回 ${response.status} ${response.statusText}`)
  }

  const payload = await response.json()
  const records = payload?.result?.records

  if (!Array.isArray(records)) {
    throw new Error('开源中国用户博客接口结构已变化')
  }

  const entries = []

  for (const item of records) {
    if (!item?.id) continue

    const entry = {
      id: `oschina:blog:${item.id}`,
      title: String(item.title || '').trim(),
      url: `${BLOG}/u/${userId}/blog/${item.id}`,
      params: { blogId: String(item.id) },
    }

    const summary = String(item.detail || '').trim()
    if (summary) entry.summary = summary

    if (item.userVo?.name) entry.author = item.userVo.name
    if (item.imgUrl) entry.image = item.imgUrl

    const publishedAt = shanghaiSeconds(item.createTime)
    if (publishedAt !== undefined) entry.publishedAt = publishedAt

    entries.push(entry)
  }

  if (entries.length === 0) {
    throw new Error('该用户没有公开的博客')
  }

  return { entries }
}

export async function preview(ctx) {
  const blogId = ctx.item?.params?.blogId
  if (!blogId) return null

  const response = await ctx.fetch(`${API}/oschinapi/blog/detail?id=${encodeURIComponent(blogId)}`, {
    headers: { accept: 'application/json' },
  })

  if (!response.ok) {
    throw new Error(`开源中国返回 ${response.status} ${response.statusText}`)
  }

  const payload = await response.json()
  if (payload?.code !== 200 || !payload?.result?.content) return null

  return { content: payload.result.content }
}
