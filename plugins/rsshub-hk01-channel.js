// Ported from RSSHub lib/routes/hk01/channel.ts (AGPL-3.0).
/**
 * 香港01 -- 子欄目.
 *
 * Each sub-column has its own public feed; the payload also carries the column
 * name, which is used as the source icon's title in the reader.
 */

export const meta = {
  id: 'rome.rsshub-hk01-channel',
  name: '香港01 · 子欄目',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: '读取香港01指定子栏目的文章',
  icon: 'https://www.hk01.com/favicon.ico',
  params: {
    fields: [
      {
        key: 'id',
        type: 'text',
        label: '子栏目 id',
        help: '可在栏目页 URL 中找到，例如 391 是數碼生活',
        default: '1'
      }
    ]
  }
};

const ROOT = 'https://www.hk01.com'
const API = 'https://web-data.api.hk01.com'
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36'

function escapeHtml(text) {
  return String(text == null ? '' : text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

function escapeAttr(text) {
  return escapeHtml(text).replaceAll('"', '&quot;')
}

function toEntry(item) {
  const data = item?.data

  if (!data || !data.articleId || item.type === 2) {
    return null
  }

  const entry = {
    id: `hk01:${data.articleId}`,
    title: data.title || `香港01 ${data.articleId}`,
    url: `${ROOT}/sns/article/${data.articleId}`,
    params: { articleId: data.articleId }
  }

  const authors = (data.authors || []).map((author) => author.publishName).filter(Boolean)

  if (authors.length > 0) {
    entry.author = authors.join(', ')
  }

  if (data.description) {
    entry.summary = data.description
  }

  if (data.mainImage?.cdnUrl) {
    entry.image = data.mainImage.cdnUrl
  }

  const timestamp = Number(data.publishTime)

  if (Number.isFinite(timestamp) && timestamp > 0) {
    entry.publishedAt = timestamp
  }

  return entry
}

function renderTokens(tokens) {
  return (tokens || []).map((token) => {
    if (token.type === 'link' || token.type === 'boldLink') {
      const inner = token.type === 'boldLink' ? `<b>${escapeHtml(token.content)}</b>` : escapeHtml(token.content)
      return `<a href="${escapeAttr(token.link)}">${inner}</a>`
    }

    if (token.type === 'boldText') {
      return `<b>${escapeHtml(token.content)}</b>`
    }

    return escapeHtml(token.content)
  }).join('')
}

function renderText(lines) {
  return (lines || []).map((tokens) => {
    if (tokens.length === 1 && (tokens[0].type === 'h2' || tokens[0].type === 'h3')) {
      const tag = tokens[0].type
      return `<${tag}>${escapeHtml(tokens[0].content)}</${tag}>`
    }

    return `<p>${renderTokens(tokens)}</p>`
  }).join('')
}

function renderImage(image) {
  if (!image?.cdnUrl) {
    return ''
  }

  const caption = image.caption ? `<figcaption>${escapeHtml(image.caption)}</figcaption>` : ''
  return `<figure><img src="${escapeAttr(image.cdnUrl)}" alt="${escapeAttr(image.caption || '')}">${caption}</figure>`
}

function renderBlocks(blocks) {
  return (blocks || []).map((block) => {
    switch (block.blockType) {
      case 'summary':
        return `<blockquote>${(block.summary || []).map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join('')}</blockquote>`
      case 'text':
        return renderText(block.htmlTokens)
      case 'image':
        return renderImage(block.image)
      case 'gallery':
        return (block.images || []).map(renderImage).join('')
      case 'table':
      case 'code':
        return block.htmlString || ''
      case 'quote':
        return `<blockquote><p>${escapeHtml(block.message || '')}${block.author ? ` —— ${escapeHtml(block.author)}` : ''}</p></blockquote>`
      case 'faq':
        return (block.questionsAndAnswers || []).map((pair) => `<section>${renderText(pair.question?.htmlTokens)}${renderText(pair.answer?.htmlTokens)}</section>`).join('')
      default:
        return ''
    }
  }).join('')
}

export async function fetch(ctx) {
  const id = String(ctx.params.id || '1').trim() || '1'
  const response = await ctx.fetch(`${API}/v2/feed/category/${encodeURIComponent(id)}`, { headers: { accept: 'application/json', 'user-agent': USER_AGENT } })

  if (!response.ok) {
    throw new Error(`hk01: channel ${id} returned ${response.status} ${response.statusText}`)
  }

  let data

  try {
    data = await response.json()
  } catch (error) {
    throw new Error(`hk01: channel ${id} did not return JSON: ${error.message}`)
  }

  if (!Array.isArray(data?.items)) {
    throw new Error(`hk01: channel ${id} did not return an items array; the response shape changed`)
  }

  const entries = data.items.map(toEntry).filter(Boolean)

  if (entries.length === 0) {
    throw new Error(`hk01: channel ${id} returned no entries`)
  }

  return { entries, icon: data.category?.icon || 'https://www.hk01.com/favicon.ico' }
}

export async function preview(ctx) {
  if (!ctx.item.params?.articleId) {
    return null
  }

  const response = await ctx.fetch(ctx.item.url, { headers: { 'user-agent': USER_AGENT } })

  if (!response.ok) {
    throw new Error(`hk01: article ${ctx.item.params.articleId} returned ${response.status} ${response.statusText}`)
  }

  const html = await response.text()
  const match = /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/.exec(html)

  if (!match) {
    throw new Error(`hk01: article ${ctx.item.params.articleId} has no source data; the page shape changed`)
  }

  let article

  try {
    article = JSON.parse(match[1])?.props?.initialProps?.pageProps?.article
  } catch (error) {
    throw new Error(`hk01: article ${ctx.item.params.articleId} source data is not JSON: ${error.message}`)
  }

  if (!article) {
    throw new Error(`hk01: article ${ctx.item.params.articleId} source data has no article`)
  }

  const teasers = (article.teaser || []).map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join('')

  return {
    content: `${renderImage(article.originalImage)}${teasers ? `<blockquote>${teasers}</blockquote>` : ''}${renderBlocks(article.blocks)}`
  }
}
