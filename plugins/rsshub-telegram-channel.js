// Ported from RSSHub lib/routes/telegram/channel.ts (AGPL-3.0).
// Telegram Channel — the public web preview at t.me/s/<name>, which needs no
// API key and no session. RSSHub can also read channels over MTProto when a
// session is configured; that path is not ported, so channels Telegram hides
// from the web preview cannot be subscribed.
//
// Every message is one `tgme_widget_message_wrap` block carrying a data-post
// id, the message HTML and a <time datetime>. Those three are the entry.

export const meta = {
  id: 'rome.rsshub-telegram-channel',
  name: 'Telegram · Channel',
  version: '1.0.0',
  apiVersion: '1',
  view: 'socialMedia',
  description: '通过 t.me 公开预览读取 Telegram 频道的消息',
  icon: 'https://telegram.org/favicon.ico',
  params: {
    fields: [
      {
        key: 'username',
        type: 'text',
        label: '频道用户名',
        help: '频道地址中 t.me 后面的名字，例如 telegram',
        required: true,
        default: ''
      },
      {
        key: 'routeParams',
        type: 'text',
        label: '附加参数',
        help: '支持 searchQuery 关键字搜索（井号写成 %23）；其余展示开关只影响原 RSSHub 的排版，这里会忽略',
        default: ''
      }
    ]
  }
}

const BASE = 'https://t.me'

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

function plain(html, limit) {
  const text = decode(String(html).replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, ' ')).replace(/[ \t]+/g, ' ').trim()
  const value = text.replace(/\s*\n\s*/g, ' ').trim()
  if (!limit || value.length <= limit) return value
  return `${value.slice(0, limit).replace(/\s+$/, '')}…`
}

function seconds(value) {
  const milliseconds = Date.parse(String(value))
  return Number.isFinite(milliseconds) ? Math.floor(milliseconds / 1000) : undefined
}

// RSSHub accepts either a keyword or a query string; only searchQuery survives
// in a feed that renders the messages as they are.
function searchQuery(raw) {
  if (!raw) return ''
  const match = /(?:^|&)searchQuery=([^&]*)/.exec(raw)
  if (match) return decodeURIComponent(match[1].replace(/\+/g, ' '))
  if (!raw.includes('=')) return raw
  return ''
}

export async function fetch(ctx) {
  const username = String(ctx.params.username || '').trim().replace(/^@/, '')

  if (!username) {
    throw new Error('Telegram 频道用户名不能为空，请在频道地址中查找')
  }

  const search = searchQuery(String(ctx.params.routeParams || '').trim())
  const url = search ? `${BASE}/s/${username}?q=${encodeURIComponent(search)}` : `${BASE}/s/${username}`
  const response = await ctx.fetch(url, { headers: { accept: 'text/html' } })

  if (!response.ok) {
    throw new Error(`Telegram 返回 ${response.status} ${response.statusText}`)
  }

  const html = await response.text()
  const entries = []

  for (const block of html.split('tgme_widget_message_wrap').slice(1)) {
    const post = /data-post="([^"]+)"/.exec(block)
    if (!post) continue

    const postId = post[1]
    const text = /<div class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<div class="tgme_widget_message_footer/.exec(block)
    const time = /<time datetime="([^"]+)"/.exec(block)

    const heading = text ? plain(text[1], 120) : ''
    const entry = {
      id: `telegram:${postId}`,
      title: heading || '（媒体消息）',
      url: `${BASE}/${postId}`
    }

    const author = postId.split('/')[0]
    if (author) {
      entry.author = author
    }

    if (text) {
      entry.content = text[1].trim()
      const summary = plain(text[1], 200)
      if (summary) {
        entry.summary = summary
      }
    }

    const photo = /background-image:url\('([^']+)'\)/.exec(block)
    if (photo) {
      entry.image = photo[1]
    }

    const publishedAt = time ? seconds(time[1]) : undefined
    if (publishedAt !== undefined) {
      entry.publishedAt = publishedAt
    }

    entries.push(entry)
  }

  if (entries.length === 0) {
    throw new Error(`Telegram 频道 ${username} 没有公开预览，或页面结构已变化`)
  }

  return { entries }
}
