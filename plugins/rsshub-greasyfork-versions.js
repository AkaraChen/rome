// Ported from RSSHub lib/routes/greasyfork/versions.ts (AGPL-3.0).
// Greasy Fork — one script's version history.
//
// The versions live in a single `<ul class="history_versions">`; each `<li>`
// carries the version number link and a changelog. The version row id is the
// number in `?version=<id>`, which is stable for the life of that release.

export const meta = {
  id: 'rome.rsshub-greasyfork-versions',
  name: 'Greasy Fork · 版本历史',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: '列出某个 Greasy Fork 脚本的全部历史版本和更新说明',
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

  const url = `https://greasyfork.org/scripts/${encodeURIComponent(script)}/versions`

  ctx.log.debug(`greasyfork: GET ${url}`)

  const response = await ctx.fetch(url, { headers: { accept: 'text/html' } })

  if (!response.ok) {
    throw new Error(`Greasy Fork 返回 ${response.status} ${response.statusText}`)
  }

  const html = await response.text()
  const start = html.indexOf('<ul class="history_versions">')

  if (start === -1) {
    throw new Error('Greasy Fork 页面没有版本列表，页面结构可能已经变了')
  }

  const end = html.indexOf('</ul>', start)
  const section = html.slice(start, end === -1 ? html.length : end)
  const entries = []

  for (const match of section.matchAll(/<li>([\s\S]*?)<\/li>/g)) {
    const block = match[1]
    const version = /<span class="version-number">\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(block)

    if (!version) continue

    const name = strip(version[2])
    const href = version[1]
    const idMatch = /[?&]version=(\d+)/.exec(href)

    if (!name) continue

    const entry = {
      id: `greasyfork-version:${idMatch ? idMatch[1] : `${script}-${name}`}`,
      title: name,
      url: new URL(decode(href), 'https://greasyfork.org/').href,
    }

    const date = /<relative-time[^>]*datetime="([^"]+)"/.exec(block)
    if (date) {
      const publishedAt = seconds(date[1])
      if (publishedAt !== undefined) entry.publishedAt = publishedAt
    }

    const changelog = /<span class="version-changelog">([\s\S]*?)<\/span>/.exec(block)
    if (changelog) {
      const summary = strip(changelog[1])
      if (summary) entry.summary = summary
    }

    entries.push(entry)
  }

  if (entries.length === 0) {
    throw new Error('Greasy Fork 没有返回任何版本，脚本 id 可能不对')
  }

  ctx.log.info(`greasyfork: ${entries.length} 个版本`)

  return { entries }
}

export async function preview(ctx) {
  const url = ctx.item?.url
  if (!url) return null

  const content = await ctx.article(url)
  return content === null ? null : { content }
}
