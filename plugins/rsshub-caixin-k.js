// Ported from RSSHub lib/routes/caixin/k.ts (AGPL-3.0).
// Caixin — the K newswire (财新一线).
//
// A public JSON list endpoint; productIdList 8 and 28 are the wire's two
// products. The text field carries inline HTML links, which are stripped for
// the summary and left to the host extractor for the body.

export const meta = {
  id: 'rome.rsshub-caixin-k',
  name: '财新 · 一线',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: '财新一线快讯',
  icon: 'https://k.caixin.com/favicon.ico',
}

const API = 'https://k.caixin.com/app/v1/list?productIdList=8%2C28&uid=&unit=1&name=&code=&deviceType=&device=&userTag=&p=1&c=20'

function strip(html) {
  return String(html).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
}

export async function fetch(ctx) {
  const response = await ctx.fetch(API, { headers: { accept: 'application/json' } })

  if (!response.ok) {
    throw new Error(`财新一线返回 ${response.status} ${response.statusText}`)
  }

  const payload = await response.json()
  const list = payload?.data?.list

  if (!Array.isArray(list)) {
    throw new Error('财新一线接口结构已变化')
  }

  const entries = []

  for (const item of list) {
    const code = item.oneline_news_code
    if (!code) continue

    const entry = {
      id: `caixin:k:${code}`,
      title: strip(item.title),
      url: `https://k.caixin.com/web/detail_${code}`,
      author: '财新一线',
    }

    const summary = strip(item.text || '')
    if (summary) entry.summary = summary

    // ts is milliseconds.
    const milliseconds = Number(item.ts)
    if (Number.isFinite(milliseconds) && milliseconds > 0) {
      entry.publishedAt = Math.floor(milliseconds / 1000)
    }

    entries.push(entry)
  }

  if (entries.length === 0) {
    throw new Error('财新一线接口返回为空')
  }

  return { entries }
}

export async function preview(ctx) {
  const url = ctx.item?.url
  if (!url) return null
  const content = await ctx.article(url)
  return content === null ? null : { content }
}
