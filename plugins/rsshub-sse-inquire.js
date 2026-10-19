// Ported from RSSHub lib/routes/sse/inquire.tsx (AGPL-3.0).
// 上海证券交易所 · 监管问询 — ported from RSSHub's /sse/inquire.
//
// The query service returns the inquiry letters as JSON, but only when the
// request carries the supervision page as its referer. `docURL` arrives without
// a scheme (`www.sse.com.cn/...`), so the entry link adds one.
//
// The route has no parameters: the channel list is what the exchange's own
// inquiries page asks for.

export const meta = {
  id: 'rome.rsshub-sse-inquire',
  name: '上海证券交易所 · 监管问询',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: '上交所科创板监管问询函，含公司、代码与问询函文件',
  icon: 'https://www.sse.com.cn/favicon.ico',
}

const API = 'https://query.sse.com.cn/commonSoaQuery.do'
const PAGE = 'https://www.sse.com.cn/disclosure/credibility/supervision/inquiries/'

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

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

export async function fetch(ctx) {
  const query = new URLSearchParams({
    isPagination: 'true',
    'pageHelp.pageSize': '25',
    'pageHelp.pageNo': '1',
    'pageHelp.beginPage': '1',
    'pageHelp.cacheSize': '1',
    'pageHelp.endPage': '1',
    sqlId: 'BS_KCB_GGLL',
    siteId: '28',
    channelId: '10743,10744,10012',
    type: '',
    stockcode: '',
    extWTFL: '',
    order: 'createTime|desc,stockcode|asc',
    _: String(Date.now()),
  })

  const response = await ctx.fetch(`${API}?${query}`, {
    headers: { accept: 'application/json', referer: PAGE },
  })

  if (!response.ok) {
    throw new Error(`上海证券交易所返回 ${response.status} ${response.statusText}`)
  }

  const body = await response.json()
  const items = body && body.result

  if (!Array.isArray(items)) {
    throw new Error('上海证券交易所没有返回问询列表，接口可能已经变了')
  }

  const entries = []

  for (const item of items) {
    if (!item || !item.docTitle || !item.docURL) continue

    const url = item.docURL.startsWith('http') ? item.docURL : `https://${item.docURL}`
    const company = item.extGSJC || item.extNAME || ''

    const entry = {
      id: `sse:inquire:${item.docURL}`,
      title: item.docTitle,
      url,
      summary: [company, item.stockcode, item.extWTFL].filter(Boolean).join(' · ') || undefined,
      content: [
        company ? `<p>公司：${escapeHtml(company)}（${escapeHtml(item.stockcode ?? '')}）</p>` : null,
        item.extWTFL ? `<p>类型：${escapeHtml(item.extWTFL)}</p>` : null,
        `<p><a href="${escapeHtml(url)}">下载问询文件</a></p>`,
      ].filter(Boolean).join(''),
    }

    if (company) entry.author = company

    const publishedAt = unixFromShanghai(item.createTime)
    if (publishedAt !== undefined) entry.publishedAt = publishedAt

    entries.push(entry)
  }

  if (entries.length === 0) {
    throw new Error('上海证券交易所问询列表为空，接口可能已经变了')
  }

  ctx.log.info(`sse-inquire: ${entries.length} 条`)

  return { entries, icon: 'https://www.sse.com.cn/favicon.ico' }
}
