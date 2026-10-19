// Ported from RSSHub lib/routes/guancha/personalpage.ts (AGPL-3.0).
// 观察者网个人主页 — the 风闻 community publishes a user's posts as JSON on
// app.guancha.cn. The article body is left to preview.

export const meta = {
  id: 'rome.rsshub-guancha-personalpage',
  name: '观察者网 · 个人主页文章',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: '观察者网风闻社区用户个人主页的文章',
  icon: 'https://www.guancha.cn/favicon.ico',
  params: {
    fields: [
      {
        key: 'uid',
        type: 'text',
        label: '用户 id',
        help: '可在个人主页 URL 中找到，例如 243983',
        required: true,
        default: ''
      }
    ]
  }
}

const API = 'https://app.guancha.cn/user/get-published-list'
const SITE = 'https://user.guancha.cn'

function chinaSeconds(text) {
  const match = /(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(String(text))
  if (!match) return undefined
  const milliseconds = Date.parse(`${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6] || '00'}+08:00`)
  return Number.isFinite(milliseconds) ? Math.floor(milliseconds / 1000) : undefined
}

export async function fetch(ctx) {
  const uid = String(ctx.params.uid || '').trim()

  if (!uid) {
    throw new Error('观察者网用户 id 不能为空，请在个人主页 URL 中查找')
  }

  const url = `${API}?page_size=20&page_no=1&uid=${encodeURIComponent(uid)}`
  const response = await ctx.fetch(url, {
    headers: { accept: 'application/json', referer: `${SITE}/` }
  })

  if (!response.ok) {
    throw new Error(`观察者网返回 ${response.status} ${response.statusText}`)
  }

  const payload = await response.json()
  const items = payload?.data?.items

  if (!Array.isArray(items) || items.length === 0) {
    throw new Error(`观察者网用户 ${uid} 没有返回文章`)
  }

  const entries = items.map((item) => {
    const entry = {
      id: `guancha:user:${item.id}`,
      title: item.title || '（无标题）',
      url: `${SITE}/main/content?id=${item.id}`,
      params: { url: `${SITE}/main/content?id=${item.id}` }
    }

    if (item.user_nick) {
      entry.author = item.user_nick
    }

    if (item.summary) {
      entry.summary = item.summary
    }

    if (item.pic) {
      entry.image = item.pic
    }

    const publishedAt = chinaSeconds(item.pass_at || item.created_at)
    if (publishedAt !== undefined) {
      entry.publishedAt = publishedAt
    }

    return entry
  })

  return { entries }
}

export async function preview(ctx) {
  const url = ctx.item?.params?.url || ctx.item?.url
  if (!url) return null
  const content = await ctx.article(url)
  return content === null ? null : { content }
}
