// Ported from RSSHub lib/routes/luogu/contest.ts (AGPL-3.0).
// 洛谷比赛列表 — the list page ships its data as JSON inside
// <script id="lentille-context">, so the listing is one request. The contest
// description is Markdown on its own page, which preview renders.

export const meta = {
  id: 'rome.rsshub-luogu-contest',
  name: '洛谷 · 比赛列表',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: '洛谷的比赛列表，含官方赛与公开赛',
  icon: 'https://www.luogu.com.cn/favicon.ico'
}

const BASE = 'https://www.luogu.com.cn'

const RULE_TYPES = { 1: 'OI', 2: 'ACM', 3: '乐多', 4: 'IOI' }
const VISIBILITY_TYPES = { 1: '官方比赛', 2: '团队公开赛', 4: '个人公开赛' }

export function pageData(html) {
  const match = /<script id="lentille-context"[^>]*>([\s\S]*?)<\/script>/.exec(html)

  if (!match) {
    throw new Error('洛谷页面没有找到 lentille-context 数据')
  }

  try {
    return JSON.parse(match[1]).data
  } catch (error) {
    throw new Error(`洛谷页面数据不是合法 JSON：${error.message}`)
  }
}

export function renderMarkdown(text) {
  const escaped = String(text == null ? '' : text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')

  return escaped
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => `<p>${block.replaceAll('\n', '<br>')}</p>`)
    .join('')
}

export async function fetch(ctx) {
  const response = await ctx.fetch(`${BASE}/contest/list`, { headers: { accept: 'text/html' } })

  if (!response.ok) {
    throw new Error(`洛谷返回 ${response.status} ${response.statusText}`)
  }

  const data = pageData(await response.text())
  const contests = data?.contests?.result

  if (!Array.isArray(contests)) {
    throw new Error('洛谷比赛列表接口没有返回数据')
  }

  const entries = contests.map((item) => {
    const entry = {
      id: `luogu:contest:${item.id}`,
      title: item.name || '（无标题）',
      url: `${BASE}/contest/${item.id}`,
      params: { contestId: item.id }
    }

    if (item.host?.name) {
      entry.author = item.host.name
    }

    const tags = []
    if (item.rated) tags.push('Rated')
    if (RULE_TYPES[item.method]) tags.push(RULE_TYPES[item.method])
    if (VISIBILITY_TYPES[item.visibility]) tags.push(VISIBILITY_TYPES[item.visibility])
    if (tags.length > 0) entry.summary = tags.join(' · ')

    const publishedAt = Number(item.startTime)
    if (Number.isFinite(publishedAt) && publishedAt > 0) {
      entry.publishedAt = Math.floor(publishedAt)
    }

    return entry
  })

  return { entries }
}

export async function preview(ctx) {
  const contestId = ctx.item?.params?.contestId
  if (!contestId) return null

  const response = await ctx.fetch(`${BASE}/contest/${contestId}`, { headers: { accept: 'text/html' } })

  if (!response.ok) {
    throw new Error(`洛谷返回 ${response.status} ${response.statusText}`)
  }

  const description = pageData(await response.text())?.contest?.description
  return description ? { content: renderMarkdown(description) } : null
}
