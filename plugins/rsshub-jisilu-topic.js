// Ported from RSSHub lib/routes/jisilu/topic.ts (AGPL-3.0).
// Jisilu — one topic.
//
// The topic id is a path segment and may be Chinese text, so it is percent
// encoded. The listing markup is the same as the category and explore pages.

export const meta = {
  id: 'rome.rsshub-jisilu-topic',
  name: '集思录 · 话题',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: '集思录指定话题下的讨论',
  icon: 'https://www.jisilu.cn/favicon.ico',
  params: {
    fields: [
      {
        key: 'id',
        type: 'text',
        label: '话题 id',
        help: '可在话题页网址中找到，例如 可转债',
        default: '',
      },
    ],
  },
}

const ROOT = 'https://www.jisilu.cn'

function decode(text) {
  const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }
  return String(text).replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity) => {
    if (entity[0] === '#') {
      const code = entity[1] === 'x' || entity[1] === 'X'
        ? Number.parseInt(entity.slice(2), 16)
        : Number.parseInt(entity.slice(1), 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : match
    }
    return Object.prototype.hasOwnProperty.call(entities, entity) ? entities[entity] : match
  })
}

function strip(html) {
  return decode(String(html).replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim()
}

function shanghaiSeconds(text) {
  const match = /^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})/.exec(String(text).trim())
  if (!match) return undefined
  return Math.floor(Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]) - 8,
    Number(match[5]),
  ) / 1000)
}

function parseListing(html) {
  let body = html
  const start = body.indexOf('aw-question-list')
  if (start !== -1) body = body.slice(start)
  const end = body.indexOf('<div class="pagination')
  if (end !== -1) body = body.slice(0, end)

  const entries = []
  const seen = new Set()

  for (const part of body.split('<div class="aw-item">').slice(1)) {
    if (!part.includes('aw-questoin-content')) continue

    const link = /<h4>[\s\S]*?<a[^>]*href="(https:\/\/www\.jisilu\.cn\/question\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(part)
    if (!link) continue

    const url = link[1]
    const question = /\/question\/(\d+)/.exec(url)
    const answer = /[?&#]answer_id=(\d+)/.exec(url)
    const id = question
      ? `jisilu:question:${question[1]}${answer ? `:answer:${answer[1]}` : ''}`
      : `jisilu:${url}`
    if (seen.has(id)) continue
    seen.add(id)

    const title = strip(link[2])
    if (!title) continue

    const entry = { id, title, url }

    const date = /(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2})/.exec(part)
    if (date) {
      const publishedAt = shanghaiSeconds(date[1])
      if (publishedAt !== undefined) entry.publishedAt = publishedAt
    }

    for (const match of part.matchAll(/<a[^>]*class="aw-user-name"[^>]*>([\s\S]*?)<\/a>/g)) {
      const name = strip(match[1])
      if (name) {
        entry.author = name
        break
      }
    }

    entries.push(entry)
  }

  return entries
}

export async function fetch(ctx) {
  const id = String(ctx.params.id || '').trim()

  if (!id) {
    throw new Error('请填写话题 id，例如 可转债')
  }

  const url = `${ROOT}/topic/${encodeURIComponent(id)}`
  const response = await ctx.fetch(url, { headers: { accept: 'text/html' } })

  if (!response.ok) {
    throw new Error(`集思录返回 ${response.status} ${response.statusText}`)
  }

  const entries = parseListing(await response.text())

  if (entries.length === 0) {
    throw new Error('集思录话题页面结构已变化，未找到讨论')
  }

  return { entries }
}

export async function preview(ctx) {
  const url = ctx.item?.url
  if (!url) return null
  const content = await ctx.article(url)
  return content === null ? null : { content }
}
