// Ported from RSSHub lib/routes/zcool/user.ts (AGPL-3.0).
// 站酷 用户作品 — RSSHub 的 /zcool/user/:uid 路由。
//
// 用户主页把作品列表放在 <script id="__NEXT_DATA__"> 里，是完整的 JSON，
// 所以这里一个请求、一次 JSON.parse，不用解析 HTML。
//
// uid 可以是数字 id（www.zcool.com.cn/u/568339）也可以是个性域名前缀
// （baiyong.zcool.com.cn），两种地址都能取到同一个 JSON。

export const meta = {
  id: 'rome.rsshub-zcool-user',
  name: '站酷 · 用户作品',
  version: '1.0.0',
  apiVersion: '1',
  view: 'pictures',
  description: '站酷某位用户发布的作品与文章',
  icon: 'https://www.zcool.com.cn/favicon.ico',
  params: {
    fields: [
      {
        key: 'uid',
        type: 'text',
        label: '用户 id',
        help: '数字用户 id（主页网址 /u/<id>）或个性域名前缀（<前缀>.zcool.com.cn）',
        default: '',
        required: true,
      },
    ],
  },
}

const BASE = 'https://www.zcool.com.cn'

function pageUrl(uid) {
  return /^\d+$/.test(uid) ? `${BASE}/u/${uid}` : `https://${uid}.zcool.com.cn`
}

/// 作品和文章在站点上是两种地址，作品用 idStr 拼 /work/，文章拼 /article/。
function workUrl(item) {
  const id = item.idStr ?? item.id

  if (!id) return null

  const kind = String(item.objectTypeStr ?? '').includes('文章') ? 'article' : 'work'

  return `${BASE}/${kind}/${id}.html`
}

export async function fetch(ctx) {
  const uid = String(ctx.params.uid ?? '').trim()

  if (!uid) {
    throw new Error('请填写用户 id，例如 568339 或 baiyong')
  }

  if (!/^[A-Za-z0-9_-]+$/.test(uid)) {
    throw new Error(`用户 id「${uid}」看起来不是一个数字 id 或个性域名前缀`)
  }

  const url = pageUrl(uid)

  ctx.log.debug(`zcool: GET ${url}`)

  const response = await ctx.fetch(url, { headers: { accept: 'text/html' } })

  if (!response.ok) {
    throw new Error(`站酷返回 ${response.status} ${response.statusText}`)
  }

  const html = await response.text()
  const script = /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/.exec(html)

  if (!script) {
    throw new Error('站酷用户页里没有找到 __NEXT_DATA__，页面结构可能已经变了')
  }

  let page

  try {
    page = JSON.parse(script[1]).props.pageProps
  } catch {
    throw new Error('站酷用户页的 __NEXT_DATA__ 不是合法 JSON，页面结构可能已经变了')
  }

  const works = page.workList

  if (!Array.isArray(works)) {
    throw new Error('站酷用户页里没有 workList 数组，页面结构可能已经变了')
  }

  const author = page.userInfo?.username
  const entries = []

  for (const work of works) {
    const link = workUrl(work)

    if (!link || !work.title) continue

    const entry = {
      id: `zcool:${new URL(link).pathname}`,
      title: work.title,
      url: link,
    }

    if (author) entry.author = author

    const image = work.cover2x || work.cover3x || work.cover
    if (image) entry.image = image

    const publishedAt = Number(work.publishTime)

    if (Number.isFinite(publishedAt) && publishedAt > 0) {
      entry.publishedAt = Math.floor(publishedAt / 1000)
    }

    entries.push(entry)
  }

  if (entries.length === 0) {
    throw new Error(`站酷用户「${uid}」没有读到任何作品，页面结构可能已经变了`)
  }

  ctx.log.info(`zcool: 用户 ${uid} ${entries.length} 条`)

  return { entries }
}

export async function preview(ctx) {
  const url = ctx.item?.url

  if (!url) return null

  const content = await ctx.article(url)

  return content === null ? null : { content }
}
