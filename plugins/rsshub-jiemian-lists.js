// Ported from RSSHub lib/routes/jiemian/lists.ts (AGPL-3.0).
// 界面新闻 栏目 — RSSHub 的 /jiemian/lists/:id 路由。
//
// 栏目页本身只有第一屏，后面的列表由一个 JSONP 接口给。页面上
// <div class="channel-load-more"> 带着接口要的 tid 和 list_type，接口返回的
// JSON 里又是一段 HTML 字符串（li.card-list 卡片），所以解析分两步：
// 先 JSON.parse，再在 html 字段里按卡片切。
//
// 快讯类栏目（id 以 kb 结尾）没有这个 div，走的是另一套接口，这里也一并处理。
// 列表只有标题、链接和封面，正文留给 preview。

export const meta = {
  id: 'rome.rsshub-jiemian-lists',
  name: '界面新闻 · 栏目',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: '界面新闻各栏目的文章列表',
  icon: 'https://www.jiemian.com/favicon.ico',
  params: {
    fields: [
      {
        key: 'id',
        type: 'text',
        label: '分类 id',
        help: '可在分类页网址 https://www.jiemian.com/lists/<分类 id>.html 中找到，例如 65（科技）、800（财经）、4（快报）',
        default: '',
        required: true,
      },
    ],
  },
}

const BASE = 'https://www.jiemian.com'
const AJAX = 'https://a.jiemian.com/index.php'
const FLASH = 'https://papi.jiemian.com/page/api/kuaixun/getlistmore'

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

function text(html) {
  return decode(String(html ?? '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim()
}

function attribute(tag, name) {
  const match = new RegExp(`\\b${name}="([^"]*)"`).exec(tag)
  return match ? decode(match[1]) : null
}

/// 这个接口把 JSON 包在 `jsonpReturn(...)` 里，不是标准 JSONP 回调，
/// 所以剥掉外层括号直接 parse。
function unwrap(body) {
  const start = body.indexOf('(')
  const end = body.lastIndexOf(')')

  if (start < 0 || end <= start) {
    throw new Error('界面新闻接口没有返回预期的 JSONP 包装，接口可能已经变了')
  }

  return JSON.parse(body.slice(start + 1, end))
}

/// 卡片上的时间写作「今天 08:15」「昨天 12:00」或「10/16 18:06」，都在 +08:00。
function seconds(input) {
  const value = String(input ?? '').trim()
  const time = /(\d{1,2}):(\d{2})/.exec(value)

  if (!time) return undefined

  const hour = time[1].padStart(2, '0')
  const minute = time[2]
  const now = new Date(Date.now() + 8 * 3600 * 1000)

  if (value.includes('今天') || value.includes('昨天')) {
    const offset = value.includes('昨天') ? -1 : 0
    const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + offset))
    const at = Date.parse(`${day.toISOString().slice(0, 10)}T${hour}:${minute}:00+08:00`)

    return Number.isFinite(at) ? Math.floor(at / 1000) : undefined
  }

  const date = /(\d{1,2})[/-](\d{1,2})/.exec(value)

  if (!date) return undefined

  const month = date[1].padStart(2, '0')
  const day = date[2].padStart(2, '0')
  let year = now.getUTCFullYear()
  let at = Date.parse(`${year}-${month}-${day}T${hour}:${minute}:00+08:00`)

  // 没有年份的日期落在未来，说明是去年的。
  if (at - Date.now() > 86400 * 1000) {
    year -= 1
    at = Date.parse(`${year}-${month}-${day}T${hour}:${minute}:00+08:00`)
  }

  return Number.isFinite(at) ? Math.floor(at / 1000) : undefined
}

function parseCards(html) {
  const entries = []

  for (const chunk of html.split('<li class="card-list"').slice(1)) {
    const title = /class="card-list__title">([\s\S]*?)<\/h3>/.exec(chunk)

    if (!title) continue

    const heading = text(title[1])
    const link = /<a\b[^>]*\bhref="([^"]+)"/.exec(chunk)

    if (!heading || !link) continue

    const url = new URL(decode(link[1]), BASE).href
    const image = /class="card-list__img[\s\S]*?<img[^>]*\bsrc="([^"]+)"/.exec(chunk)

    const entry = {
      id: `jiemian:${new URL(url).pathname}`,
      title: heading,
      url,
    }

    if (image) entry.image = decode(image[1])

    const summary = text(/class="card-list__summary">[\s\S]*?<p>([\s\S]*?)<\/p>/.exec(chunk)?.[1])

    if (summary) entry.summary = summary

    const author = text(/class="news-footer__author">([\s\S]*?)<\/span>/.exec(chunk)?.[1])

    if (author) entry.author = author

    const publishedAt = seconds(text(/class="news-footer__date">([\s\S]*?)<\/span>/.exec(chunk)?.[1]))

    if (publishedAt !== undefined) entry.publishedAt = publishedAt

    entries.push(entry)
  }

  return entries
}

async function fetchCards(ctx, id) {
  const page = await ctx.fetch(`${BASE}/lists/${encodeURIComponent(id)}.html`, { headers: { accept: 'text/html' } })

  if (!page.ok) {
    throw new Error(`界面新闻返回 ${page.status} ${page.statusText}`)
  }

  const html = await page.text()
  const more = /<div class="channel-load-more"[^>]*>/.exec(html)

  if (more) {
    const tid = attribute(more[0], 'data-tid')
    const listType = attribute(more[0], 'data-list_type') ?? ''

    if (!tid) {
      throw new Error('界面新闻栏目的加载更多区块里没有 tid，页面结构可能已经变了')
    }

    const query = new URLSearchParams({
      m: 'newLists',
      a: 'loadMore',
      tid,
      page: '1',
      // 固定模板，接口才会返回卡片列表而不是整页
      tpl: 'sub-card',
      cid: id,
      repeat: '',
      list_type: listType,
    })

    ctx.log.debug(`jiemian: GET ${AJAX}?${query}`)

    const response = await ctx.fetch(`${AJAX}?${query}`, {
      headers: { accept: 'application/json', referer: `${BASE}/lists/${id}.html` },
    })

    if (!response.ok) {
      throw new Error(`界面新闻列表接口返回 ${response.status} ${response.statusText}`)
    }

    const body = unwrap(await response.text())

    if (typeof body.html !== 'string') {
      throw new Error('界面新闻列表接口没有返回 html 字段，接口可能已经变了')
    }

    return parseCards(body.html)
  }

  // 快讯类栏目：页面上标出真正的 kb id，列表来自快讯接口。
  const kbId = id.endsWith('kb') ? id : /lists\/(\d+kb)\.html/.exec(/<a class="active"[^>]*data-url="([^"]*)"/.exec(html)?.[1] ?? '')?.[1]

  if (!kbId) {
    throw new Error(`界面新闻栏目「${id}」既没有加载更多区块也没有快讯 id，页面结构可能已经变了`)
  }

  const query = new URLSearchParams({
    cid: kbId,
    start_time: String(Math.floor(Date.now() / 1000)),
    page: '1',
    tagid: kbId.replace('kb', ''),
  })

  ctx.log.debug(`jiemian: GET ${FLASH}?${query}`)

  const response = await ctx.fetch(`${FLASH}?${query}`, { headers: { accept: 'application/json' } })

  if (!response.ok) {
    throw new Error(`界面新闻快讯接口返回 ${response.status} ${response.statusText}`)
  }

  const list = (await response.json()).result?.list

  if (!Array.isArray(list)) {
    throw new Error('界面新闻快讯接口没有返回 result.list 数组，接口可能已经变了')
  }

  return list
    .filter((flash) => flash.id && flash.title)
    .map((flash) => {
      const entry = {
        id: `jiemian:${flash.id}`,
        title: flash.title,
        url: `${BASE}/article/${flash.id}.html`,
      }

      if (flash.summary) entry.summary = flash.summary

      return entry
    })
}

export async function fetch(ctx) {
  const id = String(ctx.params.id ?? '').trim()

  if (!id) {
    throw new Error('请填写分类 id，例如 65（科技）或 4（快报）')
  }

  const entries = await fetchCards(ctx, id)

  if (entries.length === 0) {
    throw new Error(`界面新闻栏目「${id}」里没有读到任何条目，页面结构可能已经变了`)
  }

  ctx.log.info(`jiemian: 栏目 ${id} ${entries.length} 条`)

  return { entries }
}

export async function preview(ctx) {
  const url = ctx.item?.url

  if (!url) return null

  const content = await ctx.article(url)

  return content === null ? null : { content }
}
