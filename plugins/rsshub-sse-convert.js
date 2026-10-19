// Ported from RSSHub lib/routes/sse/convert.ts (AGPL-3.0).
// 上海证券交易所 · 可转换公司债券公告 — ported from RSSHub's /sse/convert/:query.
//
// The exchange's query service answers JSON but only to a request that carries
// the bond site as its referer; without it the same URL returns an error page.
// The filters are user-supplied `key=value` pairs appended to the fixed query.
//
// The endpoint returns 100 rows regardless of `pageHelp.pageSize`, so the list
// is used as it arrives rather than paginated across several requests.

export const meta = {
  id: 'rome.rsshub-sse-convert',
  name: '上海证券交易所 · 可转换公司债券公告',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: '上交所可转债公告，可按日期、公司代码与标题筛选',
  icon: 'https://www.sse.com.cn/favicon.ico',
  params: {
    fields: [
      {
        key: 'query',
        type: 'text',
        label: '筛选条件',
        help: '形如 beginDate=2018-08-18&endDate=2019-08-18&companyCode=603283&title=股份，可只用其中几项',
        default: '',
      },
    ],
  },
}

const API = 'https://query.sse.com.cn/infodisplay/queryBulletinKzzTipsNew.do'
const PAGE = 'https://bond.sse.com.cn/disclosure/announ/convertible/'
const HOST = 'https://www.sse.com.cn'

function unixFromShanghai(value) {
  const text = String(value ?? '').trim()
  if (text === '') return undefined

  let iso
  if (/^\d{14}$/.test(text)) {
    iso = `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}T${text.slice(8, 10)}:${text.slice(10, 12)}:${text.slice(12, 14)}+08:00`
  } else {
    iso = text.replace(' ', 'T')
    if (!/[zZ]$|[+-]\d{2}:?\d{2}$/.test(iso)) iso += '+08:00'
  }

  const milliseconds = Date.parse(iso)
  return Number.isFinite(milliseconds) ? Math.floor(milliseconds / 1000) : undefined
}

function parseQuery(text) {
  const filters = {}
  const value = String(text ?? '').trim()
  if (value === '') return filters

  for (const pair of value.split('&')) {
    const index = pair.indexOf('=')
    const key = index === -1 ? pair : pair.slice(0, index)
    const raw = index === -1 ? '' : pair.slice(index + 1)
    if (!key) continue
    try {
      filters[key] = decodeURIComponent(raw)
    } catch {
      filters[key] = raw
    }
  }

  return filters
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function absolute(path) {
  if (typeof path !== 'string' || path === '') return undefined
  return path.startsWith('http') ? path : `${HOST}${path}`
}

export async function fetch(ctx) {
  const filters = parseQuery(ctx.params.query)
  const query = new URLSearchParams({
    isPagination: 'true',
    'pageHelp.pageSize': '20',
    flag: '0',
    _: String(Date.now()),
    ...filters,
  })

  const response = await ctx.fetch(`${API}?${query}`, {
    headers: { accept: 'application/json', referer: PAGE },
  })

  if (!response.ok) {
    throw new Error(`上证债券信息网返回 ${response.status} ${response.statusText}`)
  }

  const body = await response.json()
  const items = body && body.result

  if (!Array.isArray(items)) {
    throw new Error('上证债券信息网没有返回公告列表，接口可能已经变了')
  }

  const entries = []

  for (const item of items) {
    const url = absolute(item && item.URL)
    if (!item || !item.title || !url) continue

    const entry = {
      id: `sse:convert:${item.ORG_BULLETIN_ID || item.URL}`,
      title: item.title,
      url,
      summary: item.BULLETIN_TYPE_DESC || undefined,
      content: [
        item.SECURITY_NAME ? `<p>${escapeHtml(item.SECURITY_NAME)}（${escapeHtml(item.security_Code ?? '')}）</p>` : null,
        `<p><a href="${escapeHtml(url)}">下载公告</a></p>`,
      ].filter(Boolean).join(''),
    }

    if (item.security_Code) entry.author = item.security_Code

    const publishedAt = unixFromShanghai(item.ADDDATE)
    if (publishedAt !== undefined) entry.publishedAt = publishedAt

    entries.push(entry)
  }

  if (entries.length === 0) {
    throw new Error('上证债券信息网公告列表为空，接口可能已经变了')
  }

  ctx.log.info(`sse-convert: ${entries.length} 条`)

  return { entries, icon: 'https://www.sse.com.cn/favicon.ico' }
}
