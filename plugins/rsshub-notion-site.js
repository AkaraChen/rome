// Ported from RSSHub lib/routes/notion/site.tsx (AGPL-3.0).
// Notion 公开站点 — the public page API, no token.
//
// A `*.notion.site` site exposes two JSON endpoints: one resolves the domain
// to a pageId and spaceId, and the other returns blocks by pointer. The block
// payload is sometimes split across fanout requests, so each of those is
// resolved and merged before the page list is read.
//
// The route lists the direct child pages and leaves their bodies to preview,
// which asks for that page's content blocks and renders the text-bearing ones.
// Private pages and database collections are not part of the public API.

export const meta = {
  id: 'rome.rsshub-notion-site',
  name: 'Notion · 公开站点',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: 'Notion 公开站点的子页面列表，无需令牌',
  icon: 'https://www.notion.com/favicon.ico',
  params: {
    fields: [
      {
        key: 'domain',
        type: 'text',
        label: '站点子域名',
        help: '例如 notion.site 的地址是 notion.notion.site，就填 notion',
        default: '',
      },
    ],
  },
}

function blockValue(record) {
  if (!record || typeof record !== 'object') return null
  if (record.value && typeof record.value === 'object') {
    // Some responses nest the block one more level: { value: { value: block } }.
    return record.value.value && typeof record.value.value === 'object'
      ? record.value.value
      : record.value
  }
  return record
}

function unwrapBlocks(recordMap) {
  const blocks = {}
  const table = recordMap?.block

  if (!table || typeof table !== 'object') return blocks

  for (const [id, record] of Object.entries(table)) {
    const block = blockValue(record)
    if (block && block.type) blocks[id] = block
  }

  return blocks
}

function blockTitle(block) {
  const title = block?.properties?.title
  if (!Array.isArray(title)) return ''

  return title
    .map((part) => (Array.isArray(part) ? String(part[0] ?? '') : String(part ?? '')))
    .join('')
    .trim()
}

async function post(ctx, url, body, extraHeaders) {
  ctx.log.debug(`notion-site: POST ${url}`)

  const response = await ctx.fetch(url, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      ...(extraHeaders ?? {}),
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    throw new Error(`Notion 接口 ${url} 返回 ${response.status} ${response.statusText}`)
  }

  return response.json()
}

/// Merge the inline recordMap with every fanout the server asks for. The
/// fanout carries its own cell header, which has to be forwarded verbatim.
async function resolveBlocks(ctx, base, payload) {
  let blocks = unwrapBlocks(payload?.recordMap)

  for (const fanout of payload?.fanoutData ?? []) {
    const data = await post(ctx, `${base}/api/v3/syncRecordValuesSpaceFanout`, fanout.request, fanout.headers)
    blocks = { ...blocks, ...unwrapBlocks(data?.recordMap) }
  }

  return blocks
}

async function fetchBlocks(ctx, base, ids, spaceId) {
  const payload = await post(ctx, `${base}/api/v3/syncRecordValuesSpaceInitial`, {
    requests: ids.map((id) => ({
      pointer: { table: 'block', id, spaceId },
      version: -1,
    })),
    spacePointer: { table: 'space', id: spaceId },
  })

  return resolveBlocks(ctx, base, payload)
}

function escape(text) {
  return String(text ?? '').replace(/[&<>"]/g, (ch) => {
    if (ch === '&') return '&amp;'
    if (ch === '<') return '&lt;'
    if (ch === '>') return '&gt;'
    return '&quot;'
  })
}

/// Notion stores a timestamp in seconds, but some fields have arrived in
/// milliseconds; normalise both.
function seconds(value) {
  const number = Number(value)
  if (!Number.isFinite(number) || number <= 0) return undefined
  return Math.floor(number > 1e12 ? number / 1000 : number)
}

function renderBlock(block) {
  const text = blockTitle(block)
  if (!text) return ''

  switch (block.type) {
    case 'header':
      return `<h2>${escape(text)}</h2>`
    case 'sub_header':
      return `<h3>${escape(text)}</h3>`
    case 'sub_sub_header':
      return `<h4>${escape(text)}</h4>`
    case 'code':
      return `<pre>${escape(text)}</pre>`
    case 'quote':
      return `<blockquote>${escape(text)}</blockquote>`
    case 'text':
    case 'bulleted_list':
    case 'numbered_list':
    case 'callout':
    case 'to_do':
      return `<p>${escape(text)}</p>`
    default:
      return ''
  }
}

export async function fetch(ctx) {
  const domain = String(ctx.params.domain ?? '').trim()

  if (!domain) {
    throw new Error('缺少站点子域名：例如 notion.notion.site 就填 notion')
  }

  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(domain)) {
    throw new Error('站点子域名只能包含小写字母、数字和连字符')
  }

  const base = `https://${domain}.notion.site`

  const publicPage = await post(ctx, `${base}/api/v3/getPublicPageDataForDomain`, {
    type: 'block-space',
    name: 'page',
    slug: '',
    spaceDomain: domain,
    requestedOnPublicDomain: true,
  })

  if (publicPage.requireLogin || !publicPage.pageId || !publicPage.publicAccessRole) {
    throw new Error('这个 Notion 页面不是公开可读的，请先发布页面和子页面')
  }

  const spaceId = publicPage.spaceId
  const rootBlocks = await fetchBlocks(ctx, base, [publicPage.pageId], spaceId)
  const root = rootBlocks[publicPage.pageId]

  if (!root || !Array.isArray(root.content)) {
    throw new Error('Notion 没有返回公开页面的内容，站点结构可能已经变了')
  }

  const children = await fetchBlocks(ctx, base, root.content, spaceId)
  const pages = root.content
    .map((id) => children[id])
    .filter((block) => block && block.type === 'page')

  const entries = pages.map((page) => {
    const entry = {
      id: `notion:${domain}:${page.id}`,
      title: blockTitle(page) || '未命名页面',
      url: `${base}/${page.format?.slug || page.id.replace(/-/g, '')}`,
      // What preview needs to fetch this page's blocks rather than the list's.
      params: { domain, id: page.id, spaceId },
    }

    const publishedAt = seconds(page.created_time)
    if (publishedAt !== undefined) entry.publishedAt = publishedAt

    return entry
  })

  ctx.log.info(`notion-site: ${domain} ${entries.length} 个子页面`)

  return { entries }
}

export async function preview(ctx) {
  const { domain, id, spaceId } = ctx.item?.params ?? {}

  if (!domain || !id || !spaceId) return null

  const base = `https://${domain}.notion.site`
  const pageBlocks = await fetchBlocks(ctx, base, [id], spaceId)
  const page = pageBlocks[id]

  if (!page || !Array.isArray(page.content) || page.content.length === 0) return null

  // A page can be long; the first hundred blocks is more than a reader needs
  // for a preview and keeps the response bounded.
  const ids = page.content.slice(0, 100)
  const blocks = await fetchBlocks(ctx, base, ids, spaceId)
  const content = ids.map((blockId) => renderBlock(blocks[blockId])).filter(Boolean).join('')

  return content ? { content } : null
}
