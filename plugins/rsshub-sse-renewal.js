// Ported from RSSHub lib/routes/sse/renewal.tsx (AGPL-3.0).
// 上海证券交易所 · 科创板项目动态 — ported from RSSHub's /sse/renewal.
//
// The status endpoint returns one row per STAR-market listing application, with
// the issuer, its province and industry, every intermediary, and two dates in
// `YYYYMMDDHHmmss` form. The exchange's own page names the status by index, so
// the same status list is kept here.
//
// `stockIssuer` and `intermediary` are not shaped consistently: the live rows
// give an object and an array of names, while older payloads nested arrays of
// objects. Both are read.

export const meta = {
  id: 'rome.rsshub-sse-renewal',
  name: '上海证券交易所 · 科创板项目动态',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: '上交所科创板发行上市审核项目动态，含状态、发行人、中介机构与日期',
  icon: 'https://www.sse.com.cn/favicon.ico',
}

const API = 'https://query.sse.com.cn/statusAction.do'
const PAGE = 'https://kcb.sse.com.cn/renewal/'
const HOST = 'https://kcb.sse.com.cn'

const STATUS_NAMES = ['全部', '已受理', '已询问', '通过', '未通过', '提交注册', '补充审核', '注册结果', '中止', '终止']

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

/// `YYYYMMDDHHmmss` to the same shape the site shows.
function displayDate(value) {
  const text = String(value ?? '').trim()
  if (!/^\d{14}$/.test(text)) return text
  return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)} ${text.slice(8, 10)}:${text.slice(10, 12)}`
}

function first(value) {
  return Array.isArray(value) ? value[0] : value
}

function intermediaryName(value) {
  if (typeof value === 'string') return value
  return value && typeof value === 'object' ? value.i_intermediaryName : undefined
}

export async function fetch(ctx) {
  const query = new URLSearchParams({
    isPagination: 'true',
    sqlId: 'SH_XM_LB',
    'pageHelp.pageSize': '20',
    offerType: '',
    commitiResult: '',
    registeResult: '',
    province: '',
    csrcCode: '',
    currStatus: '',
    order: 'updateDate|desc,stockAuditNum|desc',
    keyword: '',
    auditApplyDateBegin: '',
    auditApplyDateEnd: '',
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
    throw new Error('上海证券交易所没有返回项目列表，接口可能已经变了')
  }

  const entries = []

  for (const item of items) {
    if (!item || !item.stockAuditName || !item.stockAuditNum) continue

    const status = STATUS_NAMES[item.currStatus] || '未知状态'
    const issuer = first(item.stockIssuer) || {}
    const intermediaries = Array.isArray(item.intermediary) ? item.intermediary.map(intermediaryName).filter(Boolean) : []
    const url = `${HOST}/renewal/xmxq/index.shtml?auditId=${item.stockAuditNum}`

    const rows = [
      ['发行人全称', item.stockAuditName],
      ['审核状态', status],
      ['注册地', issuer.s_province],
      ['证监会行业', issuer.s_csrcCodeDesc],
      ['保荐机构', intermediaries[0]],
      ['会计师事务所', intermediaries[1]],
      ['律师事务所', intermediaries[2]],
      ['评估机构', intermediaries[3]],
      ['更新日期', displayDate(item.updateDate)],
      ['受理日期', displayDate(item.auditApplyDate)],
    ].filter(([, value]) => value)

    const entry = {
      id: `sse:renewal:${item.stockAuditNum}`,
      title: `【${status}】${item.stockAuditName}`,
      url,
      summary: [status, issuer.s_province, intermediaries[0]].filter(Boolean).join(' · ') || undefined,
      content: [
        ...rows.map(([label, value]) => `<p>${escapeHtml(label)}：${escapeHtml(value)}</p>`),
        `<p><a href="${escapeHtml(url)}">查看详情</a></p>`,
      ].join(''),
    }

    if (item.stockAuditName) entry.author = item.stockAuditName

    const publishedAt = unixFromShanghai(item.updateDate)
    if (publishedAt !== undefined) entry.publishedAt = publishedAt

    entries.push(entry)
  }

  if (entries.length === 0) {
    throw new Error('上海证券交易所项目列表为空，接口可能已经变了')
  }

  ctx.log.info(`sse-renewal: ${entries.length} 条`)

  return { entries, icon: 'https://www.sse.com.cn/favicon.ico' }
}
