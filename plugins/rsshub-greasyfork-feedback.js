// Ported from RSSHub lib/routes/greasyfork/feedback.ts (AGPL-3.0).
// Greasy Fork — one script's feedback threads.
//
// The discussion list is one div per thread, but the item contains nested divs,
// so the page is split on the item marker rather than matched with a div regex.
// The thread id in `/discussions/<id>` is stable across edits and replies.

export const meta = {
  id: 'rome.rsshub-greasyfork-feedback',
  name: 'Greasy Fork · 脚本反馈',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: '列出某个 Greasy Fork 脚本的反馈与讨论',
  icon: 'https://greasyfork.org/favicon.ico',
  params: {
    fields: [
      {
        key: 'script',
        type: 'text',
        label: '脚本 id',
        help: '脚本 URL 中的数字 id，例如 431691-bypass-all-shortlinks 里的 431691',
        default: '',
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

function seconds(value) {
  const milliseconds = Date.parse(value)
  return Number.isFinite(milliseconds) ? Math.floor(milliseconds / 1000) : undefined
}

export async function fetch(ctx) {
  const script = String(ctx.params.script || '').trim()

  if (!script) {
    throw new Error('请填写脚本 id，它是脚本 URL 里的数字部分')
  }

  const url = `https://greasyfork.org/scripts/${encodeURIComponent(script)}/feedback`

  ctx.log.debug(`greasyfork: GET ${url}`)

  const response = await ctx.fetch(url, { headers: { accept: 'text/html' } })

  if (!response.ok) {
    throw new Error(`Greasy Fork 返回 ${response.status} ${response.statusText}`)
  }

  const html = await response.text()
  const parts = html.split('<div class="discussion-list-item">').slice(1)
  const entries = []

  for (const part of parts) {
    const link = /<a class="discussion-title" href="([^"]+)"/.exec(part)
    if (!link) continue

    const href = link[1]
    const idMatch = /\/discussions\/(\d+)/.exec(href)
    const snippet = /<span class="discussion-snippet">([\s\S]*?)<\/span>/.exec(part)
    const title = snippet ? strip(snippet[1]) : ''

    if (!title) continue

    const entry = {
      id: `greasyfork-feedback:${idMatch ? idMatch[1] : href}`,
      title,
      url: new URL(decode(href), 'https://greasyfork.org/').href,
    }

    const author = /<a class="user-link"[^>]*>([\s\S]*?)<\/a>/.exec(part)
    if (author) {
      entry.author = strip(author[1])
    }

    const date = /<relative-time[^>]*datetime="([^"]+)"/.exec(part)
    if (date) {
      const publishedAt = seconds(date[1])
      if (publishedAt !== undefined) entry.publishedAt = publishedAt
    }

    entries.push(entry)
  }

  if (entries.length === 0) {
    throw new Error('Greasy Fork 页面没有讨论列表，页面结构可能已经变了')
  }

  ctx.log.info(`greasyfork: ${entries.length} 条反馈`)

  return { entries }
}

export async function preview(ctx) {
  const url = ctx.item?.url
  if (!url) return null

  const content = await ctx.article(url)
  return content === null ? null : { content }
}
