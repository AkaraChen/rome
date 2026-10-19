// Ported from OpenCLI clis/wikidata/search.js (Apache-2.0).
// 维基数据搜索 — OpenCLI 的 `wikidata search`.
//
// wbsearchentities 返回 Q-ID，可直接用于维基数据的实体页。
// 移植自 clis/wikidata/search.js 与 clis/wikidata/utils.js。

export const meta = {
  id: 'rome.opencli-wikidata-search',
  name: '维基数据 · 搜索',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: '按关键词搜索维基数据实体并返回 Q-ID。',
  icon: 'https://www.wikidata.org/favicon.ico',
  params: {
    fields: [
      {
        key: 'query',
        type: 'text',
        label: '关键词',
        help: '实体名称或别名，例如 berlin',
        default: '',
      },
      {
        key: 'language',
        type: 'text',
        label: '语言',
        help: 'ISO 639 语言代码，例如 en、fr、zh',
        default: 'en',
      },
      {
        key: 'limit',
        type: 'number',
        label: '条数',
        help: '最多 50 条',
        default: 20,
        min: 1,
        max: 50,
      },
    ],
  },
}

const BASE = 'https://www.wikidata.org'
const UA = 'opencli-wikidata-adapter/1.0 (+https://github.com/jackwener/opencli)'

function integer(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(Math.max(parsed, min), max)
}

function language(value) {
  const code = String(value ?? 'en').trim().toLowerCase() || 'en'

  if (!/^[a-z]{2,3}(-[a-z]{2,8})?$/.test(code)) {
    throw new Error(`维基数据语言代码不合法：${code}`)
  }

  return code
}

export async function fetch(ctx) {
  const query = String(ctx.params?.query ?? '').trim()

  if (!query) {
    throw new Error('请填写搜索关键词')
  }

  const lang = language(ctx.params?.language)
  const limit = integer(ctx.params?.limit, 20, 1, 50)

  const url = `${BASE}/w/api.php?action=wbsearchentities`
    + `&search=${encodeURIComponent(query)}`
    + `&language=${encodeURIComponent(lang)}&uselang=${encodeURIComponent(lang)}`
    + `&type=item&format=json&limit=${limit}&origin=*`

  ctx.log.debug(`opencli-wikidata-search: GET ${url}`)

  const response = await ctx.fetch(url, {
    headers: { 'user-agent': UA, accept: 'application/json' },
  })

  if (response.status === 429) {
    throw new Error('维基数据触发了限流（HTTP 429），请稍后重试')
  }

  if (!response.ok) {
    throw new Error(`维基数据返回 HTTP ${response.status}`)
  }

  const body = await response.json()
  const list = Array.isArray(body?.search) ? body.search : []

  if (list.length === 0) {
    throw new Error(`维基数据没有找到与 "${query}" 匹配的实体（${lang}）`)
  }

  const entries = []

  for (const [index, item] of list.slice(0, limit).entries()) {
    const qid = String(item?.id ?? '').trim()

    // 没有 Q-ID 的行无法稳定去重，也无法打开实体页。
    if (!qid) continue

    const parts = [`#${index + 1}`]
    if (item.description) parts.push(String(item.description))

    const matchType = item?.match?.type
    const matchText = item?.match?.text
    if (matchType && matchText) parts.push(`匹配 ${matchType}：${matchText}`)

    const entry = {
      id: `wd:${qid}`,
      title: typeof item.label === 'string' && item.label.trim() ? item.label : qid,
      url: `${BASE}/wiki/${qid}`,
    }

    if (parts.length > 0) entry.summary = parts.join(' · ')

    entries.push(entry)
  }

  if (entries.length === 0) {
    throw new Error('维基数据返回的实体都缺少 Q-ID')
  }

  ctx.log.info(`opencli-wikidata-search: ${entries.length} 条（${query}）`)

  return { entries }
}
