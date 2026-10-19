// Ported from RSSHub lib/routes/discourse/official.ts (AGPL-3.0).
// Discourse 官方 RSS — <实例>/<path>.rss。
//
// RSSHub 的这条路由靠服务端环境变量把 configId 映射成实例地址，插件没有
// 那层配置，所以实例地址直接作为参数。可选的 User-Api-Key 用来读需要登录
// 的版块。没有 XML 解析器，按 <item> 切块、按标签取值。

export const meta = {
  id: 'rome.rsshub-discourse-official',
  name: 'Discourse · 官方 RSS',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: '任意 Discourse 实例提供的官方 RSS 源',
  icon: 'https://www.discourse.org/favicon.ico',
  params: {
    fields: [
      {
        key: 'baseUrl',
        type: 'text',
        label: '实例地址',
        help: 'Discourse 站点根地址，例如 https://meta.discourse.org',
        default: '',
        required: true,
      },
      {
        key: 'path',
        type: 'text',
        label: 'RSS 路径',
        help: '域名与 .rss 之间的部分，例如 latest、top/all、c/developers/6',
        default: '',
        required: true,
      },
      {
        key: 'key',
        type: 'password',
        label: 'User API Key',
        help: '访问需要登录的版块时填写，留空表示匿名',
        default: '',
        required: false,
      },
    ],
  },
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

function decode(text) {
  return String(text).replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity) => {
    if (entity[0] === '#') {
      const code = entity[1] === 'x' || entity[1] === 'X'
        ? Number.parseInt(entity.slice(2), 16)
        : Number.parseInt(entity.slice(1), 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : match
    }
    return Object.prototype.hasOwnProperty.call(ENTITIES, entity) ? ENTITIES[entity] : match
  })
}

function escape(text) {
  return String(text ?? '').replace(/[&<>"]/g, (ch) => {
    if (ch === '&') return '&amp;'
    if (ch === '<') return '&lt;'
    if (ch === '>') return '&gt;'
    return '&quot;'
  })
}

// 取 <name>…</name> 之间的内容，允许标签带属性。
function tag(block, name) {
  const match = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`).exec(block)
  return match ? match[1] : undefined
}

// 正文通常包在 CDATA 里；万一站点直接给了转义过的 HTML，就解一次实体。
function body(block) {
  const raw = tag(block, 'description')
  if (raw === undefined) return undefined

  const cdata = /^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/.exec(raw)

  if (cdata) {
    const html = cdata[1].trim()
    if (!html) return undefined
    return /<[a-z][^>]*>/i.test(html) ? html : `<p>${escape(html)}</p>`
  }

  const text = decode(raw).trim()
  return text ? `<p>${escape(text)}</p>` : undefined
}

export async function fetch(ctx) {
  const rawBase = String(ctx.params.baseUrl ?? '').trim()
  const path = String(ctx.params.path ?? '').trim().replace(/^\/+/, '').replace(/\/+$/, '').replace(/\.rss$/i, '')
  const key = String(ctx.params.key ?? '').trim()

  if (!rawBase) {
    throw new Error('请填写 Discourse 实例地址，例如 https://meta.discourse.org')
  }
  if (!path) {
    throw new Error('请填写 RSS 路径，例如 latest')
  }

  const base = new URL(/^https?:\/\//i.test(rawBase) ? rawBase : `https://${rawBase}`)
  const url = `${base.origin}${base.pathname.replace(/\/+$/, '')}/${path}.rss`

  const headers = { accept: 'application/rss+xml, application/xml' }
  if (key) headers['user-api-key'] = key

  ctx.log.debug(`discourse: GET ${url}`)

  const response = await ctx.fetch(url, { headers })

  if (!response.ok) {
    throw new Error(`Discourse RSS 返回 ${response.status} ${response.statusText}`)
  }

  const xml = await response.text()
  const blocks = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((match) => match[1])

  if (blocks.length === 0) {
    throw new Error(`${url} 没有 <item>，路径或实例地址可能不对`)
  }

  const entries = []

  for (const block of blocks) {
    const title = tag(block, 'title')
    const link = tag(block, 'link')

    if (title === undefined || link === undefined) continue

    const guid = tag(block, 'guid')
    const creator = tag(block, 'dc:creator')
    const published = tag(block, 'pubDate')

    const entry = {
      // Discourse 的 guid 自带实例域名，跨源也不会撞车。
      id: `discourse:${guid ? decode(guid).trim() : link.trim()}`,
      title: decode(title).trim(),
      url: link.trim(),
    }

    if (creator) {
      const author = decode(creator.replace(/<!\[CDATA\[|\]\]>/g, '')).trim()
      if (author) entry.author = author
    }

    const content = body(block)
    if (content) entry.content = content

    if (published) {
      const milliseconds = Date.parse(published.trim())
      if (Number.isFinite(milliseconds)) entry.publishedAt = Math.floor(milliseconds / 1000)
    }

    entries.push(entry)
  }

  if (entries.length === 0) {
    throw new Error(`${url} 的 <item> 里没有标题和链接，RSS 结构可能已经变了`)
  }

  return { entries, icon: `${base.origin}/favicon.ico` }
}
