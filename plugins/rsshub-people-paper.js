// Ported from RSSHub lib/routes/people/paper.ts (AGPL-3.0).
// 人民日报电子版 — paper.people.com.cn/rmrb/pc/。
//
// 三个层次：版面索引（layout/index.html）列出当天的 node_XX.html，每个版面
// 页的 ul.news-list 列出该版文章。文章正文只在打开时才取，走 preview。
//
// 日期取版面 URL 里的 /202610/19/，按 UTC 零点算：它代表报纸的出版日，
// 不是某个具体时刻。

export const meta = {
  id: 'rome.rsshub-people-paper',
  name: '人民网 · 人民日报电子版',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: '当日人民日报电子版的文章',
  icon: 'https://paper.people.com.cn/favicon.ico',
  params: {
    fields: [
      {
        key: 'page',
        type: 'text',
        label: '版面编号',
        help: '例如 01；填 all 或留空则读当天全部版面',
        default: 'all',
        required: false,
      },
    ],
  },
}

const ROOT = 'https://paper.people.com.cn/rmrb/pc/'
const INDEX = `${ROOT}layout/index.html`
const LIMIT = 30

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

function stripTags(html) {
  return decode(String(html).replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim()
}

// 取出某个 <div> 的内层 HTML：从它的开始标签起数 div 的开合，
// 数回零就是它的结束标签。没有 DOM，只能这样配平。
function divInner(html, open) {
  if (open < 0) return null

  const close = html.indexOf('>', open)
  if (close < 0) return null

  const tag = /<(\/?)div\b[^>]*>/gi
  tag.lastIndex = close + 1

  let depth = 1
  let match

  while ((match = tag.exec(html))) {
    depth += match[1] ? -1 : 1
    if (depth === 0) return html.slice(close + 1, match.index).trim()
  }

  return null
}

// 版面之间没有依赖，但也不能一次发二十个请求，所以自己排一个小队列。
async function pool(items, limit, worker) {
  const results = new Array(items.length)
  let next = 0

  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++
      results[index] = await worker(items[index], index)
    }
  })

  await Promise.all(runners)
  return results
}

export async function fetch(ctx) {
  const requested = String(ctx.params.page ?? 'all').trim() || 'all'

  ctx.log.debug(`people: GET ${INDEX}`)

  const indexResponse = await ctx.fetch(INDEX, { headers: { accept: 'text/html' } })

  if (!indexResponse.ok) {
    throw new Error(`人民日报版面索引返回 ${indexResponse.status} ${indexResponse.statusText}`)
  }

  const indexHtml = await indexResponse.text()

  // 版面列表在 <ul id="list"> 里，取到它的结束标签为止。
  const listStart = indexHtml.indexOf('id="list"')
  const listEnd = listStart < 0 ? -1 : indexHtml.indexOf('</ul>', listStart)

  if (listStart < 0 || listEnd < 0) {
    throw new Error('人民日报版面索引里没有 #list，页面结构可能已经改变')
  }

  const listHtml = indexHtml.slice(listStart, listEnd)
  const anchor = /<a href="([^"]*node_(\d+)\.html)"[^>]*>([\s\S]*?)<\/a>/g

  const pages = []
  let match

  while ((match = anchor.exec(listHtml))) {
    const title = stripTags(match[3])
    if (!title) continue
    pages.push({ id: match[2], title, url: new URL(match[1], INDEX).href })
  }

  if (pages.length === 0) {
    throw new Error('人民日报版面索引没有列出任何版面，页面结构可能已经改变')
  }

  // 填 1 和填 01 是同一个版面。
  const normalized = /^\d{1,2}$/.test(requested) ? requested.padStart(2, '0') : requested
  const selected = normalized === 'all' ? undefined : pages.find((page) => page.id === normalized)

  if (normalized !== 'all' && !selected) {
    throw new Error(`版面 ${requested} 不在今天的报纸里`)
  }

  const edition = /\/(\d{4})(\d{2})\/(\d{2})\//.exec(pages[0].url)

  if (!edition) {
    throw new Error('无法从版面地址判断报纸日期，页面结构可能已经改变')
  }

  const publishedAt = Math.floor(Date.UTC(Number(edition[1]), Number(edition[2]) - 1, Number(edition[3])) / 1000)
  const targets = selected ? [selected] : pages

  const lists = await pool(targets, 4, async (page) => {
    // 二十个版面里有一个抽风，不该让整份报纸落空，所以单版面失败只记一条
    // 警告；全部版面都取不到时，下面的总数检查会报错。
    try {
      const response = await ctx.fetch(page.url, { headers: { accept: 'text/html' } })

      if (!response.ok) {
        throw new Error(`版面 ${page.id} 返回 ${response.status} ${response.statusText}`)
      }

      const html = await response.text()
      const start = html.indexOf('class="news-list"')
      const end = start < 0 ? -1 : html.indexOf('</ul>', start)

      if (start < 0 || end < 0) {
        throw new Error(`版面 ${page.id} 里没有 ul.news-list，页面结构可能已经改变`)
      }

      const article = /<a href="([^"]*content_(\d+)\.html)"[^>]*>([\s\S]*?)<\/a>/g
      const found = []
      let hit

      while ((hit = article.exec(html.slice(start, end)))) {
        const title = stripTags(hit[3])
        if (!title) continue
        found.push({ contentId: hit[2], title, page: page.title, url: new URL(hit[1], page.url).href })
      }

      return found
    } catch (error) {
      ctx.log.warn(`people: ${error.message}`)
      return []
    }
  })

  const articles = lists.flat().slice(0, LIMIT)

  if (articles.length === 0) {
    throw new Error('人民日报电子版没有解析到任何文章，页面结构可能已经改变')
  }

  const entries = articles.map((article) => ({
    // content_30186354 里的编号是文章在站内的编号。
    id: `people:paper:${article.contentId}`,
    title: article.title,
    url: article.url,
    summary: article.page,
    publishedAt,
  }))

  return { entries, icon: 'https://paper.people.com.cn/favicon.ico' }
}

export async function preview(ctx) {
  const url = ctx.item?.url
  if (!url) return null

  const response = await ctx.fetch(url, { headers: { accept: 'text/html' } })

  if (!response.ok) {
    throw new Error(`人民日报文章页返回 ${response.status} ${response.statusText}`)
  }

  const html = await response.text()

  // 正文在 <div id="ozoom"> 里，夹在 <!--enpcontent--> 与 <!--/enpcontent-->
  // 之间。页面里还有一份放在 display:none 的 #articleContent 里的整页副本，
  // 也带着同样的注释，所以必须先定位到 ozoom，再在它里面找注释。
  const open = html.indexOf('<div id="ozoom"')

  if (open < 0) {
    throw new Error('人民日报文章页里没有 #ozoom，页面结构可能已经改变')
  }

  let content = divInner(html, open)

  if (!content) {
    throw new Error('人民日报文章页的 #ozoom 没有闭合标签，页面结构可能已经改变')
  }

  const start = content.indexOf('<!--enpcontent-->')
  const end = content.indexOf('<!--/enpcontent-->', start + 1)

  if (start >= 0 && end > start) {
    content = content.slice(start + '<!--enpcontent-->'.length, end).trim()
  }

  if (!content) return null
  return { content }
}
