// Ported from RSSHub lib/routes/jisilu/category.ts (AGPL-3.0).
// Jisilu — one discussion category.
//
// The listing is server-rendered HTML. Every card is a `div.aw-item` inside the
// question list; the sidebar holds cards that use the same class, so parsing
// starts at the list container and stops at the pagination block.
//
// The listing's content class is misspelled `aw-questoin-content` on the site,
// and that misspelling is the marker used here.

export const meta = {
  id: 'rome.rsshub-jisilu-category',
  name: '集思录 · 分类',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: '集思录指定分类的讨论',
  icon: 'https://www.jisilu.cn/favicon.ico',
  params: {
    fields: [
      {
        key: 'id',
        type: 'text',
        label: '分类 id',
        help: '新股 3、债券/可转债 4、套利 5、其他 6、基金 7、股票 8',
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

// `2026-10-19 14:36` is Asia/Shanghai wall-clock time.
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

    // The first aw-user-name anchor in a card is the avatar and carries no text.
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
    throw new Error('请填写分类 id，例如 4 表示债券/可转债')
  }

  const url = `${ROOT}/category/${encodeURIComponent(id)}`
  const response = await ctx.fetch(url, { headers: { accept: 'text/html' } })

  if (!response.ok) {
    throw new Error(`集思录返回 ${response.status} ${response.statusText}`)
  }

  const entries = parseListing(await response.text())

  if (entries.length === 0) {
    throw new Error('集思录分类页面结构已变化，未找到讨论')
  }

  return { entries }
}

export async function preview(ctx) {
  const url = ctx.item?.url
  if (!url) return null
  const content = await ctx.article(url)
  return content === null ? null : { content }
}
