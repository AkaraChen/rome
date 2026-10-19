// Ported from RSSHub lib/routes/huggingface/daily-papers.ts (AGPL-3.0).
// Hugging Face Daily Papers — /huggingface/daily-papers
//
// The papers page is a Svelte app and the data is not in a JSON endpoint: it
// is in a `data-props` attribute on the hydrating div, HTML-escaped and then
// JSON. Decoding the entities and parsing it is the whole job.
//
// `voteFliter` is spelled that way in RSSHub's route, so it is spelled that
// way here — a renamed parameter would silently ignore a value the user set.

export const meta = {
  id: 'rome.rsshub-huggingface-daily-papers',
  name: 'Hugging Face · Daily Papers',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: 'Hugging Face 每日论文榜单',
  icon: 'https://huggingface.co/favicon.ico',
  params: {
    fields: [
      {
        key: 'cycle',
        type: 'select',
        label: '周期',
        default: 'date',
        options: [
          { value: 'date', label: '当日' },
          { value: 'week', label: '本周' },
          { value: 'month', label: '本月' },
        ],
      },
      {
        key: 'voteFliter',
        type: 'number',
        label: '最低赞数',
        help: '只保留赞数不低于该值的论文，默认为 0',
        default: 0,
      },
    ],
  },
}

const HOST = 'https://huggingface.co'

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

function decode(value) {
  return String(value ?? '').replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity) => {
    if (entity[0] === '#') {
      const code = entity[1] === 'x' || entity[1] === 'X'
        ? Number.parseInt(entity.slice(2), 16)
        : Number.parseInt(entity.slice(1), 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : match
    }

    return Object.prototype.hasOwnProperty.call(ENTITIES, entity) ? ENTITIES[entity] : match
  })
}

function firstLine(text, limit) {
  const line = String(text ?? '').replace(/\s+/g, ' ').trim()
  if (!line) return undefined
  return line.length > limit ? `${line.slice(0, limit - 1)}…` : line
}

/// The week page is always the year's 52nd week in RSSHub, which is what the
/// site itself links to; the month page is the current month.
function pageUrl(cycle) {
  if (cycle === 'week') return `${HOST}/papers/week/${new Date().getFullYear()}-W52`
  if (cycle === 'month') return `${HOST}/papers/month/${new Date().toISOString().slice(0, 7)}`
  return `${HOST}/papers`
}

export async function fetch(ctx) {
  const cycle = ['date', 'week', 'month'].includes(ctx.params.cycle) ? ctx.params.cycle : 'date'
  const minimum = Math.max(Number(ctx.params.voteFliter) || 0, 0)

  const response = await ctx.fetch(pageUrl(cycle), { headers: { accept: 'text/html' } })

  if (!response.ok) {
    throw new Error(`Hugging Face 返回 ${response.status}（Daily Papers）`)
  }

  const html = await response.text()
  const props = html.match(/data-target="DailyPapers"[^>]*data-props="([^"]*)"/)

  if (!props) {
    throw new Error('Hugging Face 页面里找不到论文数据，页面结构可能已经变了')
  }

  const data = JSON.parse(decode(props[1]))
  const papers = data.dailyPapers

  if (!Array.isArray(papers)) {
    throw new Error('Hugging Face 没有返回论文数组，页面结构可能已经变了')
  }

  const entries = papers
    .filter((item) => (item.paper?.upvotes ?? 0) >= minimum)
    .map((item) => {
      const paper = item.paper || {}
      const authors = (paper.authors || []).map((author) => author.name).filter(Boolean)

      const entry = {
        id: `huggingface-paper:${paper.id}`,
        title: paper.title,
        url: `https://arxiv.org/abs/${paper.id}`,
        author: authors.length > 3 ? `${authors.slice(0, 3).join(', ')} 等` : authors.join(', ') || undefined,
        summary: firstLine(paper.summary, 140) || `${paper.upvotes ?? 0} 赞`,
      }

      if (paper.thumbnail) entry.image = paper.thumbnail

      const publishedAt = Date.parse(paper.publishedAt || item.publishedAt || '')
      if (Number.isFinite(publishedAt)) entry.publishedAt = Math.floor(publishedAt / 1000)

      return entry
    })

  ctx.log.info(`huggingface-daily-papers: ${entries.length} 条（${cycle}）`)

  return { entries }
}

export async function preview(ctx) {
  const content = await ctx.article(ctx.item.url)
  return content ? { content } : null
}
