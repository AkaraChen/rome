// Ported from RSSHub lib/routes/steam/news.ts (AGPL-3.0).
// Steam 游戏新闻 — store.steampowered.com 的公告接口。
//
// 公告正文是 BBCode 而不是 HTML，运行时又没有 DOM，所以这里做一次最小的
// BBCode 到 HTML 的转换。正文本来就在列表响应里，不需要再逐条请求。

export const meta = {
  id: 'rome.rsshub-steam-news',
  name: 'Steam · 游戏新闻',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: 'Steam 游戏的公告与更新新闻',
  icon: 'https://store.steampowered.com/favicon.ico',
  params: {
    fields: [
      {
        key: 'appid',
        type: 'text',
        label: '游戏 App ID',
        help: 'Steam 商店 URL 中的数字，例如 730',
        default: '',
        required: true,
      },
      {
        key: 'language',
        type: 'select',
        label: '语言',
        help: '公告的语言代码',
        default: 'english',
        required: false,
        options: [
          { value: 'english', label: 'English' },
          { value: 'schinese', label: '简体中文' },
          { value: 'tchinese', label: '繁體中文' },
          { value: 'japanese', label: '日本語' },
          { value: 'koreana', label: '한국어' },
          { value: 'russian', label: 'Русский' },
          { value: 'spanish', label: 'Español' },
          { value: 'latam', label: 'Español - Latinoamérica' },
          { value: 'french', label: 'Français' },
          { value: 'german', label: 'Deutsch' },
          { value: 'italian', label: 'Italiano' },
          { value: 'portuguese', label: 'Português' },
          { value: 'brazilian', label: 'Português - Brasil' },
          { value: 'polish', label: 'Polski' },
          { value: 'turkish', label: 'Türkçe' },
          { value: 'thai', label: 'ไทย' },
          { value: 'vietnamese', label: 'Tiếng Việt' },
          { value: 'ukrainian', label: 'Українська' },
          { value: 'czech', label: 'Čeština' },
          { value: 'dutch', label: 'Nederlands' },
          { value: 'danish', label: 'Dansk' },
          { value: 'finnish', label: 'Suomi' },
          { value: 'norwegian', label: 'Norsk' },
          { value: 'swedish', label: 'Svenska' },
          { value: 'hungarian', label: 'Magyar' },
          { value: 'romanian', label: 'Română' },
          { value: 'bulgarian', label: 'Български' },
          { value: 'greek', label: 'Ελληνικά' },
        ],
      },
    ],
  },
}

const API = 'https://store.steampowered.com/events/ajaxgetpartnereventspageable/'
const COMMUNITY = 'https://steamcommunity.com'
const CLAN = 'https://clan.fastly.steamstatic.com/images'

const LANGUAGES = new Set([
  'english', 'schinese', 'tchinese', 'japanese', 'koreana', 'russian', 'spanish', 'latam',
  'french', 'german', 'italian', 'portuguese', 'brazilian', 'polish', 'turkish', 'thai',
  'vietnamese', 'ukrainian', 'czech', 'dutch', 'danish', 'finnish', 'norwegian', 'swedish',
  'hungarian', 'romanian', 'bulgarian', 'greek',
])

function escape(text) {
  return String(text ?? '').replace(/[&<>"]/g, (ch) => {
    if (ch === '&') return '&amp;'
    if (ch === '<') return '&lt;'
    if (ch === '>') return '&gt;'
    return '&quot;'
  })
}

// 先转义再替换，标签是我们自己拼出来的；剩下的未知标签直接丢掉，
// 免得 BBCode 原样显示在正文里。
function bbcode(text) {
  let html = escape(text)
  html = html.replace(/\{STEAM_CLAN_IMAGE\}/g, CLAN)
  html = html.replace(/\[url=([^\]]+)\]([\s\S]*?)\[\/url\]/gi, '<a href="$1">$2</a>')
  html = html.replace(/\[url\]([\s\S]*?)\[\/url\]/gi, '<a href="$1">$1</a>')
  html = html.replace(/\[img\]([\s\S]*?)\[\/img\]/gi, '<img src="$1">')
  html = html.replace(/\[h[1-6]\]/gi, '<h3>').replace(/\[\/h[1-6]\]/gi, '</h3>')
  html = html.replace(/\[olist\]/gi, '<ol>').replace(/\[\/olist\]/gi, '</ol>')
  html = html.replace(/\[list=1\]/gi, '<ol>').replace(/\[list\]/gi, '<ul>').replace(/\[\/list\]/gi, '</ul>')
  html = html.replace(/\[\*\]/g, '<li>').replace(/\[\/\*\]/g, '</li>')
  html = html.replace(/\[p\]/gi, '<p>').replace(/\[\/p\]/gi, '</p>')
  html = html.replace(/\[b\]/gi, '<b>').replace(/\[\/b\]/gi, '</b>')
  html = html.replace(/\[i\]/gi, '<i>').replace(/\[\/i\]/gi, '</i>')
  html = html.replace(/\[u\]/gi, '<u>').replace(/\[\/u\]/gi, '</u>')
  html = html.replace(/\[s\]/gi, '<s>').replace(/\[\/s\]/gi, '</s>')
  html = html.replace(/\[quote\]/gi, '<blockquote>').replace(/\[\/quote\]/gi, '</blockquote>')
  html = html.replace(/\[code\]/gi, '<pre>').replace(/\[\/code\]/gi, '</pre>')
  html = html.replace(/\[\/?[a-z*][^\]]*\]/gi, '')
  // Steam 用 \[ 和 \] 表示字面量方括号。
  html = html.replace(/\\([[\]])/g, '$1')
  return html
}

function firstUrl(list) {
  if (!Array.isArray(list)) return undefined
  return list.find((value) => typeof value === 'string' && value)
}

function seconds(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : undefined
}

export async function fetch(ctx) {
  const appid = String(ctx.params.appid ?? '').trim()

  if (!appid) {
    throw new Error('请填写游戏 App ID（数字）')
  }
  if (!/^\d+$/.test(appid)) {
    throw new Error(`App ID ${appid} 无效，应为数字`)
  }

  const language = String(ctx.params.language ?? 'english').trim() || 'english'
  if (!LANGUAGES.has(language)) {
    throw new Error(`不支持的语言代码 ${language}`)
  }

  const url = new URL(API)
  url.searchParams.set('clan_accountid', '0')
  url.searchParams.set('appid', appid)
  url.searchParams.set('offset', '0')
  url.searchParams.set('count', '50')
  url.searchParams.set('l', language)

  ctx.log.debug(`steam: GET ${url.href}`)

  const response = await ctx.fetch(url.href, { headers: { accept: 'application/json' } })

  if (!response.ok) {
    throw new Error(`Steam 新闻返回 ${response.status} ${response.statusText}`)
  }

  const body = await response.json()

  if (!Array.isArray(body.events)) {
    throw new Error('Steam 新闻接口没有返回 events 数组，接口可能已经变了')
  }

  const entries = []

  for (const event of body.events) {
    const announcement = event.announcement_body
    if (!announcement || !announcement.gid) continue

    let json = {}
    try {
      json = JSON.parse(event.jsondata ?? '{}')
    } catch {
      json = {}
    }

    const capsule = firstUrl(json.localized_capsule_image)
    const entry = {
      // 公告的 gid 是永久标识。
      id: `steam:news:${announcement.gid}`,
      title: event.event_name || announcement.headline || `公告 ${announcement.gid}`,
      url: `${COMMUNITY}/games/${appid}/announcements/detail/${announcement.gid}`,
      content: `<div>${bbcode(announcement.body)}</div>`,
    }

    if (capsule) entry.image = `${CLAN}/${announcement.clanid}/${capsule}`

    const publishedAt = seconds(announcement.posttime)
    if (publishedAt !== undefined) entry.publishedAt = publishedAt

    if (Array.isArray(announcement.tags) && announcement.tags.length > 0) {
      entry.summary = announcement.tags.join(' · ')
    }

    entries.push(entry)
    if (entries.length >= 50) break
  }

  if (entries.length === 0) {
    throw new Error(`Steam 游戏 ${appid} 没有返回任何公告`)
  }

  return {
    entries,
    icon: 'https://store.steampowered.com/favicon.ico',
  }
}
