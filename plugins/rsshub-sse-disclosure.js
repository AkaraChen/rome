// Ported from RSSHub lib/routes/sse/disclosure.ts (AGPL-3.0).
// 上海证券交易所 · 上市公司信息最新公告披露 — ported from RSSHub's
// /sse/disclosure/:query.
//
// Same JSON query service as the bond route, with the stock announcement
// referer. The announcements themselves are PDFs on the static host, so the
// entries link straight at the file and the body is the link plus the issuer.
//
// The filters are user-supplied `key=value` pairs; `productId` is the stock
// code the exchange's own page puts in its URL.

export const meta = {
  id: 'rome.rsshub-sse-disclosure',
  name: '上海证券交易所 · 上市公司公告',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: '上交所上市公司最新公告，可按日期与证券代码筛选',
  icon: 'https://www.sse.com.cn/favicon.ico',
  params: {
    fields: [
      {
        key: 'query',
        type: 'text',
        label: '筛选条件',
        help: '形如 beginDate=2018-08-18&endDate=2020-08-25&productId=600696，可只用其中几项',
        default: '',
      },
    ],
  },
}

const API = 'https://query.sse.com.cn/security/stock/queryCompanyBulletin.do'
const PDF_HOST = 'https://static.sse.com.cn'
const PAGE = 'https://www.sse.com.cn/assortment/stock/list/info/announcement/index.shtml'

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
  return path.startsWith('http') ? path : `${PDF_HOST}${path}`
}

export async function fetch(ctx) {
  const filters = parseQuery(ctx.params.query)
  const query = new URLSearchParams({
    securityType: '0101,120100,020100,020200,120200',
    reportType: 'ALL',
    ...filters,
    isPagination: 'true',
    'pageHelp.pageSize': '25',
    'pageHelp.pageCount': '50',
    'pageHelp.pageNo': '1',
    'pageHelp.beginPage': '1',
    'pageHelp.cacheSize': '1',
    'pageHelp.endPage': '5',
    _: String(Date.now()),
  })

  const response = await ctx.fetch(`${API}?${query}`, {
    headers: { accept: 'application/json', referer: filters.productId ? `${PAGE}?productId=${filters.productId}` : PAGE },
  })

  if (!response.ok) {
    throw new Error(`上海证券交易所返回 ${response.status} ${response.statusText}`)
  }

  const body = await response.json()
  const items = body && body.result

  if (!Array.isArray(items)) {
    throw new Error('上海证券交易所没有返回公告列表，接口可能已经变了')
  }

  const entries = []

  for (const item of items) {
    const url = absolute(item && item.URL)
    if (!item || !item.TITLE || !url) continue

    const entry = {
      id: `sse:disclosure:${item.URL}`,
      title: item.TITLE,
      url,
      summary: item.SECURITY_NAME || undefined,
      content: [
        item.SECURITY_NAME ? `<p>${escapeHtml(item.SECURITY_NAME)}（${escapeHtml(item.SECURITY_CODE ?? '')}）</p>` : null,
        `<p><a href="${escapeHtml(url)}">下载公告</a></p>`,
      ].filter(Boolean).join(''),
    }

    if (item.SECURITY_NAME) entry.author = item.SECURITY_NAME

    const publishedAt = unixFromShanghai(item.ADDDATE)
    if (publishedAt !== undefined) entry.publishedAt = publishedAt

    entries.push(entry)
  }

  if (entries.length === 0) {
    throw new Error('上海证券交易所公告列表为空，接口可能已经变了')
  }

  ctx.log.info(`sse-disclosure: ${entries.length} 条`)

  return { entries, icon: 'https://www.sse.com.cn/favicon.ico' }
}
