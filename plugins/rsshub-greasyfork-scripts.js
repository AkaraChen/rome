// Ported from RSSHub lib/routes/greasyfork/scripts.ts (AGPL-3.0).
// Greasy Fork — the script listing.
//
// The listing is server-rendered, so one request is enough. Each row is an
// `<li data-script-id>` whose own id is permanent; the visible title can change
// on every update, which is why the entry id comes from the li and not the h2.

export const meta = {
  id: 'rome.rsshub-greasyfork-scripts',
  name: 'Greasy Fork · 脚本更新',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: '抓取 Greasy Fork 的脚本列表，可按语言、目标站点和排序方式筛选',
  icon: 'https://greasyfork.org/favicon.ico',
  params: {
    fields: [
      {
        key: 'language',
        type: 'text',
        label: '语言',
        help: 'Greasy Fork 搜索页右上角的语言代码，all 表示全部语言',
        default: 'zh-CN',
      },
      {
        key: 'domain',
        type: 'text',
        label: '目标站点',
        help: '只显示适用于该域名的脚本，留空表示不限',
        default: '',
      },
      {
        key: 'sort',
        type: 'select',
        label: '排序方式',
        help: '脚本列表的排序依据',
        default: 'updated',
        options: [
          { value: 'today', label: '日安装量' },
          { value: 'total_installs', label: '总安装量' },
          { value: 'ratings', label: '评分' },
          { value: 'created', label: '创建时间' },
          { value: 'updated', label: '更新时间' },
          { value: 'name', label: '名称' },
        ],
      },
    ],
  },
}

const SORTS = new Set(['today', 'total_installs', 'ratings', 'created', 'updated', 'name'])

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

function absolute(href) {
  try {
    return new URL(decode(href), 'https://greasyfork.org/').href
  } catch {
    return null
  }
}

export async function fetch(ctx) {
  const language = String(ctx.params.language || 'zh-CN').trim() || 'zh-CN'
  const domain = String(ctx.params.domain || '').trim()
  const requested = String(ctx.params.sort || 'updated').trim()
  const sort = SORTS.has(requested) ? requested : 'updated'
  const locale = language === 'all' ? 'zh-CN' : language

  const query = new URLSearchParams({
    filter_locale: language === 'all' ? '0' : '1',
    sort,
  })

  const url = `https://greasyfork.org/${encodeURIComponent(locale)}/scripts${domain ? `/by-site/${encodeURIComponent(domain)}` : ''}?${query}`

  ctx.log.debug(`greasyfork: GET ${url}`)

  const response = await ctx.fetch(url, { headers: { accept: 'text/html' } })

  if (!response.ok) {
    throw new Error(`Greasy Fork 返回 ${response.status} ${response.statusText}`)
  }

  const html = await response.text()
  const entries = []

  for (const match of html.matchAll(/<li data-script-id="(\d+)"[^>]*>([\s\S]*?)<\/li>/g)) {
    const scriptId = match[1]
    const block = match[2]
    const title = /<a[^>]*class="script-link"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(block)
      || /<a[^>]*href="([^"]+)"[^>]*class="script-link"[^>]*>([\s\S]*?)<\/a>/.exec(block)

    if (!title) continue

    const heading = strip(title[2])
    const href = absolute(title[1])

    if (!heading || !href) continue

    const entry = {
      // The script id is the number in `/scripts/<id>-<slug>` and never changes.
      id: `greasyfork:${scriptId}`,
      title: heading,
      url: href,
    }

    const description = /<span class="script-description description">([\s\S]*?)<\/span>/.exec(block)
    if (description) {
      entry.summary = strip(description[1])
    }

    const author = /<dd class="script-list-author">[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/.exec(block)
    if (author) {
      entry.author = strip(author[1])
    }

    const created = /<dd class="script-list-created-date">[\s\S]*?<relative-time[^>]*datetime="([^"]+)"/.exec(block)
    const updated = /<dd class="script-list-updated-date">[\s\S]*?<relative-time[^>]*datetime="([^"]+)"/.exec(block)

    if (created) {
      const publishedAt = seconds(created[1])
      if (publishedAt !== undefined) entry.publishedAt = publishedAt
    }

    if (updated) {
      entry.params = { updatedAt: updated[1] }
    }

    entries.push(entry)
  }

  // An empty list means the selectors stopped matching, not that the site has
  // no scripts. Throw so the reader sees a broken source instead of a blank one.
  if (entries.length === 0) {
    throw new Error('Greasy Fork 页面没有脚本列表，页面结构可能已经变了')
  }

  ctx.log.info(`greasyfork: ${entries.length} 个脚本`)

  return { entries }
}

export async function preview(ctx) {
  const url = ctx.item?.url
  if (!url) return null

  const content = await ctx.article(url)
  return content === null ? null : { content }
}
