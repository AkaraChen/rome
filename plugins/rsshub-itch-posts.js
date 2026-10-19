// Ported from RSSHub lib/routes/itch/posts.ts (AGPL-3.0).
// itch.io 论坛帖子 — one page, one `post_grid` block per post. Each block
// already carries the author, the body and the absolute timestamp, so a refresh
// is a single request.

export const meta = {
  id: 'rome.rsshub-itch-posts',
  name: 'itch.io · Posts',
  version: '1.0.0',
  apiVersion: '1',
  view: 'socialMedia',
  description: 'itch.io 论坛话题下的帖子',
  icon: 'https://itch.io/favicon.ico',
  params: {
    fields: [
      {
        key: 'topic',
        type: 'text',
        label: '话题 id',
        help: '话题地址中 t 后面的数字，可在 URL 中找到',
        required: true,
        default: ''
      },
      {
        key: 'id',
        type: 'text',
        label: '话题名称',
        help: '话题地址中话题 id 后面的名字，可在 URL 中找到',
        required: true,
        default: ''
      }
    ]
  }
}

const BASE = 'https://itch.io'

function decode(text) {
  const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" }
  return String(text).replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+|#39);/g, (match, entity) => {
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

function plain(html, limit) {
  const value = strip(html)
  if (!limit || value.length <= limit) return value
  return `${value.slice(0, limit).replace(/\s+$/, '')}…`
}

// itch prints "2026-10-07 19:56:38" in the post_date title attribute.
function dateSeconds(text) {
  const match = /(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(String(text))
  if (!match) return undefined
  const milliseconds = Date.parse(`${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6] || '00'}Z`)
  return Number.isFinite(milliseconds) ? Math.floor(milliseconds / 1000) : undefined
}

export async function fetch(ctx) {
  const topic = String(ctx.params.topic || '').trim()
  const id = String(ctx.params.id || '').trim()

  if (!topic || !id) {
    throw new Error('itch.io 话题 id 与话题名称不能为空，请在话题页 URL 中查找')
  }

  const url = `${BASE}/t/${encodeURIComponent(topic)}/${encodeURIComponent(id)}?before=999999999`
  const response = await ctx.fetch(url, { headers: { accept: 'text/html' } })

  if (!response.ok) {
    throw new Error(`itch.io 返回 ${response.status} ${response.statusText}`)
  }

  const html = await response.text()
  const entries = []

  for (const block of html.split('<div class="post_grid">').slice(1)) {
    const post = /<span title="([^"]+)" class="post_date"><a href="(\/post\/(\d+))"/.exec(block)
    if (!post) continue

    const author = /<span class="post_author"><a[^>]*>([\s\S]*?)<\/a>/.exec(block)
    const body = /<div[^>]*class="post_body[^"]*"[^>]*>([\s\S]*?)<\/div><div class="post_footer/.exec(block)

    const entry = {
      id: `itch:post:${post[3]}`,
      title: author ? `${strip(author[1])}: ${plain(body ? body[1] : '', 100)}` : plain(body ? body[1] : '', 100),
      url: new URL(post[2], BASE).href
    }

    if (author) {
      entry.author = strip(author[1])
    }

    if (body) {
      entry.content = body[1].trim()
      const summary = plain(body[1], 200)
      if (summary) {
        entry.summary = summary
      }
    }

    const publishedAt = dateSeconds(post[1])
    if (publishedAt !== undefined) {
      entry.publishedAt = publishedAt
    }

    entries.push(entry)
  }

  if (entries.length === 0) {
    throw new Error('itch.io 话题页面结构已变化，未找到帖子')
  }

  return { entries }
}
