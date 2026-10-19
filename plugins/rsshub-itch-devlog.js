// Ported from RSSHub lib/routes/itch/devlog.ts (AGPL-3.0).
// itch.io 开发者日志 — the devlog page lists every post with its date, author and
// summary already rendered, so one request is enough. RSSHub additionally opens
// each post for its images and body; preview covers that here.

export const meta = {
  id: 'rome.rsshub-itch-devlog',
  name: 'itch.io · Developer Logs',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: 'itch.io 游戏的开发者日志',
  icon: 'https://itch.io/favicon.ico',
  params: {
    fields: [
      {
        key: 'user',
        type: 'text',
        label: '用户名',
        help: '地址中 itch.io 前面的名字，例如 teamterrible',
        required: true,
        default: ''
      },
      {
        key: 'id',
        type: 'text',
        label: '游戏 id',
        help: '地址中 itch.io 与 /devlog 之间的部分，例如 the-baby-in-yellow',
        required: true,
        default: ''
      }
    ]
  }
}

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

// The visible text is localised ("November 21, 2022"); the abbr title attribute
// carries the machine-readable "2022-11-21 19:13:39".
function dateSeconds(text) {
  const match = /(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(String(text))
  if (!match) return undefined
  const milliseconds = Date.parse(`${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6] || '00'}Z`)
  return Number.isFinite(milliseconds) ? Math.floor(milliseconds / 1000) : undefined
}

export async function fetch(ctx) {
  const user = String(ctx.params.user || '').trim()
  const id = String(ctx.params.id || '').trim()

  if (!user || !id) {
    throw new Error('itch.io 用户名与游戏 id 不能为空，请在开发者日志地址中查找')
  }

  if (!/^[a-zA-Z0-9_-]+$/.test(user)) {
    throw new Error('itch.io 用户名只能包含字母、数字、下划线和连字符')
  }

  const url = `https://${user}.itch.io/${encodeURIComponent(id)}/devlog`
  const response = await ctx.fetch(url, { headers: { accept: 'text/html' } })

  if (!response.ok) {
    throw new Error(`itch.io 返回 ${response.status} ${response.statusText}`)
  }

  const html = await response.text()
  const list = /<ul id="blog_post_list[^>]*>([\s\S]*?)<\/ul>/.exec(html)

  if (!list) {
    throw new Error(`itch.io 游戏 ${user}/${id} 没有开发者日志，或页面结构已变化`)
  }

  const entries = []

  for (const block of list[1].split('<li>').slice(1)) {
    const title = /<a href="([^"]+)" class="title">([\s\S]*?)<\/a>/.exec(block)
    if (!title) continue

    let link
    try {
      link = new URL(decode(title[1]), `https://${user}.itch.io`)
    } catch {
      continue
    }

    const entry = {
      id: `itch:devlog:${link.pathname.replace(/\/+$/, '').split('/').pop()}`,
      title: strip(title[2]) || link.href,
      url: link.href
    }

    const date = /<abbr title="([^"]+)"/.exec(block)
    if (date) {
      const publishedAt = dateSeconds(date[1])
      if (publishedAt !== undefined) {
        entry.publishedAt = publishedAt
      }
    }

    const author = / by <a[^>]*>([\s\S]*?)<\/a>/.exec(block)
    if (author) {
      const name = strip(author[1])
      if (name) {
        entry.author = name
      }
    }

    const summary = /class="summary_text">([\s\S]*?)<\/span>/.exec(block)
    if (summary) {
      const text = strip(summary[1])
      if (text) {
        entry.summary = text
      }
    }

    const image = /class="post_image"[^>]*src="([^"]+)"/.exec(block)
    if (image) {
      entry.image = decode(image[1])
    }

    entries.push(entry)
  }

  if (entries.length === 0) {
    throw new Error(`itch.io 游戏 ${user}/${id} 的开发者日志列表为空，或页面结构已变化`)
  }

  return { entries }
}

export async function preview(ctx) {
  const url = ctx.item?.url
  if (!url) return null
  const content = await ctx.article(url)
  return content === null ? null : { content }
}
