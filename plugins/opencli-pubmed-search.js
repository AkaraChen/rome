// Ported from OpenCLI clis/pubmed/search.js (Apache-2.0).
// PubMed 文献检索 — OpenCLI's `pubmed search` command.
//
// Two E-utilities calls, exactly as the adapter does it: ESearch resolves the
// query to PMIDs, ESummary turns those ids into metadata. The detail view uses
// EFetch, which is the adapter's own article endpoint, so opening an entry can
// show the real abstract rather than a landing page.
//
// Ported from clis/pubmed/search.js, article.js and utils.js.

export const meta = {
  id: 'rome.opencli-pubmed-search',
  name: 'PubMed · 文献检索',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: '按关键词和筛选条件检索 PubMed 文献',
  icon: 'https://pubmed.ncbi.nlm.nih.gov/favicon.ico',
  params: {
    fields: [
      {
        key: 'query',
        type: 'text',
        label: '关键词',
        help: '检索式，例如 machine learning cancer',
        default: '',
      },
      {
        key: 'limit',
        type: 'number',
        label: '条数',
        help: '最多返回多少条（1-100）',
        default: 20,
      },
      {
        key: 'author',
        type: 'text',
        label: '作者',
        help: '按作者姓名筛选',
        default: '',
      },
      {
        key: 'journal',
        type: 'text',
        label: '期刊',
        help: '按期刊名称筛选',
        default: '',
      },
      {
        key: 'year-from',
        type: 'number',
        label: '起始年份',
        help: '只保留该年及以后发表的文献',
      },
      {
        key: 'year-to',
        type: 'number',
        label: '结束年份',
        help: '只保留该年及以前发表的文献',
      },
      {
        key: 'article-type',
        type: 'text',
        label: '文献类型',
        help: '例如 Review、Clinical Trial',
        default: '',
      },
      {
        key: 'has-abstract',
        type: 'checkbox',
        label: '仅含有摘要的文献',
        default: false,
      },
      {
        key: 'free-full-text',
        type: 'checkbox',
        label: '仅免费全文',
        default: false,
      },
      {
        key: 'humans-only',
        type: 'checkbox',
        label: '仅人类研究',
        default: false,
      },
      {
        key: 'english-only',
        type: 'checkbox',
        label: '仅英文文献',
        default: false,
      },
      {
        key: 'sort',
        type: 'select',
        label: '排序',
        help: '按相关性、日期、作者或期刊排序',
        default: 'relevance',
        options: [
          { value: 'relevance', label: '相关性' },
          { value: 'date', label: '日期' },
          { value: 'author', label: '作者' },
          { value: 'journal', label: '期刊' },
        ],
      },
    ],
  },
}

const EUTILS = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils'

// ESearch's sort keys, which are not the same words as the UI labels.
const SORTS = {
  relevance: '',
  date: 'pub_date',
  author: 'Author',
  journal: 'JournalName',
}

const ARTICLE_TYPE_PRIORITY = [
  'Systematic Review',
  'Meta-Analysis',
  'Review',
  'Randomized Controlled Trial',
  'Clinical Trial',
  'Case Reports',
  'Journal Article',
]

const MONTHS = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11,
}

// NCBI asks anonymous clients to stay at or below three requests a second.
// This module outlives one fetch, so the timestamp has to be module-level.
let lastRequestAt = 0

async function throttle() {
  const wait = Math.max(0, lastRequestAt + 360 - Date.now())

  if (wait > 0) {
    await new Promise((resolve) => setTimeout(resolve, wait))
  }

  lastRequestAt = Date.now()
}

function integer(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10)

  if (!Number.isFinite(parsed)) {
    return fallback
  }

  return Math.min(Math.max(parsed, min), max)
}

function year(value, label) {
  if (value === undefined || value === null || value === '') return undefined

  const parsed = Number.parseInt(value, 10)

  if (!Number.isFinite(parsed) || parsed < 1800 || parsed > 3000) {
    throw new Error(`${label}必须是 1800 到 3000 之间的年份`)
  }

  return parsed
}

function flag(value) {
  return value === true || value === 'true'
}

function eutilsUrl(tool, params, retmode) {
  const search = new URLSearchParams()
  search.set('db', 'pubmed')
  search.set('retmode', retmode)

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      search.set(key, String(value))
    }
  }

  return `${EUTILS}/${tool}.fcgi?${search.toString()}`
}

async function eutilsFetch(ctx, tool, params, label, retmode = 'json') {
  await throttle()

  const url = eutilsUrl(tool, params, retmode)
  ctx.log.debug(`opencli-pubmed-search: GET ${url}`)

  const response = await ctx.fetch(url, {
    headers: { accept: retmode === 'xml' ? 'application/xml' : 'application/json' },
  })

  if (!response.ok) {
    throw new Error(`${label}返回 ${response.status} ${response.statusText}`)
  }

  if (retmode === 'xml') {
    return response.text()
  }

  const body = await response.json()
  const error = body?.error
    || body?.esearchresult?.errorlist?.phrasesnotfound?.join(', ')
    || body?.esearchresult?.errorlist?.fieldsnotfound?.join(', ')

  if (error) {
    throw new Error(`${label}返回错误：${error}`)
  }

  return body
}

/// The adapter's query grammar. Each filter is an NCBI field tag joined with
/// AND, so an empty filter simply contributes nothing.
function buildQuery(query, filters) {
  const terms = [query]

  if (filters.author) terms.push(`${filters.author}[Author]`)
  if (filters.journal) terms.push(`${filters.journal}[Journal]`)

  if (filters.yearFrom || filters.yearTo) {
    const from = filters.yearFrom || 1800
    const to = filters.yearTo || new Date().getFullYear()

    if (from > to) {
      throw new Error('起始年份不能晚于结束年份')
    }

    terms.push(`${from}:${to}[PDAT]`)
  }

  if (filters.articleType) terms.push(`${filters.articleType}[PT]`)
  if (filters.hasAbstract) terms.push('hasabstract[text]')
  if (filters.hasFullText) terms.push('free full text[sb]')
  if (filters.humanOnly) terms.push('humans[mesh]')
  if (filters.englishOnly) terms.push('english[lang]')

  return terms.join(' AND ')
}

function authorsOf(list, max) {
  if (!Array.isArray(list)) return ''

  const names = list
    .map((author) => author?.name
      || author?.collectivename
      || [author?.lastname, author?.initials].filter(Boolean).join(' '))
    .filter(Boolean)

  const shown = names.slice(0, max)
  if (names.length > max) shown.push('et al.')

  return shown.join(', ')
}

function doiOf(ids) {
  if (!Array.isArray(ids)) return ''

  const doi = ids.find((id) => String(id?.idtype ?? '').toLowerCase() === 'doi')
  return String(doi?.value ?? '').trim()
}

function articleTypeOf(types) {
  const values = Array.isArray(types)
    ? types.map((type) => (typeof type === 'string' ? type : type?.value)).filter(Boolean)
    : []

  for (const wanted of ARTICLE_TYPE_PRIORITY) {
    const found = values.find((type) => type.toLowerCase() === wanted.toLowerCase())
    if (found) return found
  }

  return values[0] || 'Journal Article'
}

/// PubMed's `pubdate` is `YYYY Mon DD`, `YYYY Mon`, or sometimes a range
/// such as `YYYY Nov-Dec`. Parse what is there and fall back to day 1.
function secondsOf(pubdate) {
  const parts = String(pubdate ?? '').trim().split(/\s+/)
  const yearValue = Number.parseInt(parts[0], 10)

  if (!Number.isFinite(yearValue)) return undefined

  const key = String(parts[1] ?? '').slice(0, 3).toLowerCase()
  const month = Object.prototype.hasOwnProperty.call(MONTHS, key) ? MONTHS[key] : 0
  const dayValue = Number.parseInt(parts[2], 10)
  const day = Number.isFinite(dayValue) ? dayValue : 1

  return Math.floor(Date.UTC(yearValue, month, day) / 1000)
}

function toEntry(article, pmid) {
  const title = String(article?.title ?? '').replace(/\.\s*$/, '').trim()
  const yearValue = String(article?.pubdate ?? '').split(' ')[0] || ''
  const journal = String(article?.fulljournalname || article?.source || '').trim()
  const authors = authorsOf(article?.authors, 3)
  const type = articleTypeOf(article?.pubtype)
  const doi = doiOf(article?.articleids)

  const parts = []
  if (journal) parts.push(journal)
  if (yearValue) parts.push(yearValue)
  if (type) parts.push(type)
  if (doi) parts.push(`DOI ${doi}`)

  const entry = {
    // The PMID is PubMed's permanent identifier and the address of its page.
    id: `pubmed:${pmid}`,
    title: title || '（无标题）',
    url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
    // The detail hook asks EFetch by PMID; the host hands this back untouched.
    params: { pmid },
  }

  if (authors) entry.author = authors
  if (parts.length > 0) entry.summary = parts.join(' · ')

  const publishedAt = secondsOf(article?.pubdate)
  if (publishedAt !== undefined) entry.publishedAt = publishedAt

  return entry
}

export async function fetch(ctx) {
  const query = String(ctx.params?.query ?? '').trim()

  if (!query) {
    throw new Error('请填写检索关键词')
  }

  const limit = integer(ctx.params?.limit, 20, 1, 100)
  const yearFrom = year(ctx.params?.['year-from'], '起始年份')
  const yearTo = year(ctx.params?.['year-to'], '结束年份')
  const sort = Object.prototype.hasOwnProperty.call(SORTS, ctx.params?.sort) ? ctx.params.sort : 'relevance'

  const searchQuery = buildQuery(query, {
    author: String(ctx.params?.author ?? '').trim(),
    journal: String(ctx.params?.journal ?? '').trim(),
    yearFrom,
    yearTo,
    articleType: String(ctx.params?.['article-type'] ?? '').trim(),
    hasAbstract: flag(ctx.params?.['has-abstract']),
    hasFullText: flag(ctx.params?.['free-full-text']),
    humanOnly: flag(ctx.params?.['humans-only']),
    englishOnly: flag(ctx.params?.['english-only']),
  })

  const search = await eutilsFetch(ctx, 'esearch', {
    term: searchQuery,
    retmax: limit,
    usehistory: 'y',
    sort: SORTS[sort],
  }, 'PubMed 检索')

  const pmids = search?.esearchresult?.idlist

  if (!Array.isArray(pmids)) {
    throw new Error('PubMed 检索没有返回 id 列表，接口可能已经变了')
  }

  if (pmids.length === 0) {
    throw new Error(`PubMed 没有找到与 "${query}" 匹配的文献`)
  }

  const summary = await eutilsFetch(ctx, 'esummary', {
    id: pmids.join(','),
  }, 'PubMed 摘要')

  if (!summary?.result || typeof summary.result !== 'object') {
    throw new Error('PubMed 摘要没有返回可读的结果对象，接口可能已经变了')
  }

  const entries = pmids.map((pmid) => {
    const article = summary.result[pmid]

    // Returning a partial list here would silently hide an upstream change,
    // so the adapter refuses the whole result instead.
    if (!article) {
      throw new Error(`PubMed 摘要缺少 PMID ${pmid} 的条目`)
    }

    return toEntry(article, pmid)
  })

  ctx.log.info(`opencli-pubmed-search: ${entries.length} 条（${query}）`)

  return { entries }
}

function decodeXml(value) {
  return String(value ?? '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number.parseInt(dec, 10)))
}

/// EFetch's XML can carry inline markup (`<i>`, `<sup>`) inside a title or an
/// abstract. Drop the tags first, then decode, so a literal `&lt;i&gt;` is
/// still text rather than markup.
function clean(value) {
  return decodeXml(String(value ?? '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim()
}

function first(xml, tag) {
  const match = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'i').exec(xml)
  return match ? match[1] : ''
}

function escape(text) {
  return String(text ?? '').replace(/[&<>"]/g, (ch) => {
    if (ch === '&') return '&amp;'
    if (ch === '<') return '&lt;'
    if (ch === '>') return '&gt;'
    return '&quot;'
  })
}

/// The item's page: the abstract, read straight from PubMed's EFetch endpoint.
/// An article with no abstract returns null, which is an answer rather than a
/// failure and is not retried.
export async function preview(ctx) {
  const pmid = String(ctx.item?.params?.pmid
    ?? String(ctx.item?.id ?? '').replace(/^pubmed:/, '')).trim()

  if (!/^\d+$/.test(pmid)) {
    return null
  }

  const xml = await eutilsFetch(ctx, 'efetch', {
    id: pmid,
    rettype: 'abstract',
  }, 'PubMed 详情', 'xml')

  if (!/<PubmedArticle\b/i.test(xml)) {
    return null
  }

  const articleBlock = /<Article\b[^>]*>([\s\S]*?)<\/Article>/i.exec(xml)?.[1] ?? xml
  const journalBlock = /<Journal\b[^>]*>([\s\S]*?)<\/Journal>/i.exec(articleBlock)?.[1] ?? ''
  const journal = clean(first(journalBlock, 'Title'))
  const doi = clean(/<ArticleId\b[^>]*IdType="doi"[^>]*>([\s\S]*?)<\/ArticleId>/i.exec(xml)?.[1] ?? '')

  // Structured abstracts repeat their section label on each paragraph; keep
  // the label with its paragraph so the text still makes sense.
  const abstract = []

  for (const match of articleBlock.matchAll(/<AbstractText\b([^>]*)>([\s\S]*?)<\/AbstractText>/gi)) {
    const label = clean(/\bLabel="([^"]*)"/i.exec(match[1])?.[1] ?? '')
    const text = clean(match[2])

    if (text) {
      abstract.push(label ? `${label}：${text}` : text)
    }
  }

  if (abstract.length === 0) {
    return null
  }

  const facts = [journal, doi ? `DOI ${doi}` : ''].filter(Boolean).join(' · ')
  const body = abstract.map((paragraph) => `<p>${escape(paragraph)}</p>`).join('')

  return {
    content: `${facts ? `<p>${escape(facts)}</p>` : ''}<h2>摘要</h2>${body}`,
  }
}
