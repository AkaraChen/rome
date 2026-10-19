// Ported from RSSHub lib/routes/tradingview/pine.ts (AGPL-3.0).
// TradingView — Pine Script 发布说明。
//
// 文档页里每个版本是 `<h2>` 或 `<h3>`，id 形如 `october-2024`，正文跟着
// 直到下一个 h2/h3。id 里带年月，所以发布时间可以直接推出来，条目 id 也用
// 版本号加锚点，永远稳定。

export const meta = {
  id: 'rome.rsshub-tradingview-pine',
  name: 'TradingView · Pine Script 发布说明',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: '列出 TradingView Pine Script 的版本发布说明',
  icon: 'https://www.tradingview.com/favicon.ico',
  params: {
    fields: [
      {
        key: 'version',
        type: 'select',
        label: '版本',
        help: 'Pine Script 的文档版本，默认为 v5',
        default: 'v5',
        options: [
          { value: 'v5', label: 'v5' },
          { value: 'v4', label: 'v4' },
        ],
      },
    ],
  },
}

const MONTHS = {
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
  july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
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

export async function fetch(ctx) {
  const version = String(ctx.params.version || 'v5').trim() || 'v5'
  const url = `https://www.tradingview.com/pine-script-docs/${encodeURIComponent(version)}/release-notes/`

  ctx.log.debug(`tradingview: GET ${url}`)

  const response = await ctx.fetch(url, { headers: { accept: 'text/html' } })

  if (!response.ok) {
    throw new Error(`TradingView 返回 ${response.status} ${response.statusText}`)
  }

  const html = await response.text()
  const headings = []

  for (const match of html.matchAll(/<h([23])\b([^>]*)>([\s\S]*?)<\/h\1>/g)) {
    const id = /\bid="([^"]+)"/.exec(match[2])?.[1]
    if (id && /^[a-z]+-\d{4}$/.test(id)) {
      headings.push({ id, title: strip(match[3]), start: match.index, end: match.index + match[0].length })
    }
  }

  const entries = []

  for (const [index, heading] of headings.entries()) {
    if (!heading.title) continue

    const content = html.slice(heading.end, headings[index + 1]?.start ?? html.length)
    const entry = {
      id: `tradingview-pine:${version}:${heading.id}`,
      title: heading.title,
      url: `${url}#${heading.id}`,
      content: content.trim(),
    }

    // id 里的月份是发布月份，取该月 1 号作为时间。
    const parts = /^([a-z]+)-(\d{4})$/.exec(heading.id)
    const month = parts ? MONTHS[parts[1]] : undefined
    if (month !== undefined) {
      entry.publishedAt = Math.floor(Date.UTC(Number(parts[2]), month, 1) / 1000)
    }

    entries.push(entry)
  }

  if (entries.length === 0) {
    throw new Error('TradingView Pine 文档没有版本标题，页面结构可能已经变了')
  }

  ctx.log.info(`tradingview: ${entries.length} 个版本`)

  return { entries }
}
