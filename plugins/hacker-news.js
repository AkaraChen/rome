// Hacker News — a fetcher plugin.
//
// The simplest useful shape: ask a site for data, turn it into entries, return
// them. There is no incremental fetch here, so `fetch` returns the whole window
// every time and Rome works out what is new by comparing ids.
//
// This one uses Hacker News's JSON API rather than scraping the page, which is
// worth noting as a general point: the plugin runtime has `fetch` but no DOM
// and no HTML parser. Scraping a page means bundling a parser (or writing
// regexes) into the plugin file before shipping it.
//
// It also shows the other half of the contract: a listing knows a title and an
// address, and `preview` is where the plugin opens the story — the item's own
// text, or the article it links to, read through the host's extractor. The host
// reads nothing on its own; every request here is this file's.

export const meta = {
  id: 'rome.hacker-news',
  name: 'Hacker News',
  version: '1.1.0',
  apiVersion: '1',
  view: 'articles',
  description: 'Hacker News 首页故事',
}

// Rendered by Rome as this plugin's settings page. The plugin never draws this
// UI — it declares the fields and Rome decides what they look like.
export const settings = {
  fields: [
    { key: 'limit', type: 'number', label: '每次抓取条数', default: 30, min: 1, max: 100 },
    { key: 'minScore', type: 'number', label: '最低分数', default: 0, min: 0 },
  ],
}

const API = 'https://hacker-news.firebaseio.com/v0'

function integer(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(Math.max(parsed, min), max)
}

export async function fetch(ctx) {
  // Clamped, not just defaulted: every id below becomes its own request, so a
  // limit typed into the settings page is a request count.
  const limit = integer(ctx.settings.limit, 30, 1, 100)
  const minScore = integer(ctx.settings.minScore, 0, 0, Number.MAX_SAFE_INTEGER)

  const top = await ctx.fetch(`${API}/topstories.json`)

  if (!top.ok) {
    throw new Error(`Hacker News 返回 ${top.status} ${top.statusText}`)
  }

  const ids = (await top.json()).slice(0, limit)
  ctx.log.debug(`hacker-news: ${ids.length} 个 id，逐个取回`)

  // `ctx.fetch` goes through the host, so these are real parallel requests
  // rather than a queue.
  const stories = await Promise.all(
    ids.map(async (id) => {
      const response = await ctx.fetch(`${API}/item/${id}.json`)
      return response.json()
    }),
  )

  const entries = stories
    .filter((story) => story && !story.deleted && !story.dead)
    .filter((story) => (story.score ?? 0) >= minScore)
    .map((story) => ({
      // `hn:<item id>` is the site's own identifier, and it never changes, so
      // the id is stable across runs. Rome deduplicates on it; a value that
      // moved between runs would re-insert the whole list every refresh.
      id: `hn:${story.id}`,
      title: story.title,
      url: story.url ?? `https://news.ycombinator.com/item?id=${story.id}`,
      author: story.by,
      publishedAt: story.time,
      summary: `${story.score ?? 0} 分 · ${story.descendants ?? 0} 条评论`,
    }))

  ctx.log.info(`hacker-news: ${entries.length} 条`)

  return { entries }
}

/// The story's own page: the text for an Ask/Show HN post, and the article it
/// links to otherwise.
///
/// `ctx.article` is `ctx.fetch` with the reader's extractor on the end of it —
/// the host fetches the address under this plugin's id and hands back the story
/// with the page's furniture removed. What the plugin decides is which address,
/// and whether there is one worth reading at all.
export async function preview(ctx) {
  const id = String(ctx.item?.id ?? '').replace(/^hn:/, '')

  if (!id) return null

  const response = await ctx.fetch(`${API}/item/${id}.json`)

  if (response.ok) {
    const story = await response.json()

    // Ask HN and Show HN are written on the site itself; the item text is the
    // story, and there is no second page to open.
    if (story?.text) return { content: story.text }
  }

  const url = ctx.item?.url

  // A discussion link has no article behind it. Saying so is an answer; the
  // host keeps whatever the listing already had.
  if (!url || url.startsWith('https://news.ycombinator.com/')) return null

  const content = await ctx.article(url)

  return content === null ? null : { content }
}
