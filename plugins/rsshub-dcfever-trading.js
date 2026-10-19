// Ported from RSSHub lib/routes/dcfever/trading.ts (AGPL-3.0).
// DCFever 二手市集 — RSSHub 的 /dcfever/trading/:id 路由。
//
// 列表是服務端渲染的方格：每格一個 <a href="view.php?id=…">，裡面有標題、
// 封面、價格、賣家和發佈時間，一個請求就能湊齊條目。
//
// 時間是「30 分鐘前」這種相對寫法，按抓取時刻往回推。

export const meta = {
  id: 'rome.rsshub-dcfever-trading',
  name: 'DCFever · 二手市集',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: 'DCFever 二手市集各分類的最新出售物品',
  icon: 'https://www.dcfever.com/favicon.ico',
  params: {
    fields: [
      {
        key: 'id',
        type: 'select',
        label: '分類',
        help: '要看的物品分類，見 https://www.dcfever.com/trading/index.php#all_cats',
        default: '',
        required: true,
        options: [
          { value: '1', label: '攝影產品' },
          { value: '2', label: '電腦' },
          { value: '3', label: '手機通訊' },
          { value: '44', label: '影音產品' },
          { value: '43', label: '遊戲機、模型' },
          { value: '104', label: '電器傢俱' },
          { value: '45', label: '潮流服飾' },
          { value: '99', label: '手錶' },
          { value: '109', label: '單車及運動' },
          { value: '4', label: '其它' },
        ],
      },
    ],
  },
}

const BASE = 'https://www.dcfever.com'

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

const RELATIVE = /(\d+)\s*(分鐘|小時|天|日|星期|週|個月)\s*前/

const UNITS = {
  分鐘: 60,
  小時: 3600,
  天: 86400,
  日: 86400,
  星期: 604800,
  週: 604800,
  個月: 2592000,
}

function seconds(input) {
  const match = RELATIVE.exec(String(input ?? '').trim())

  if (!match) return undefined

  return Math.floor(Date.now() / 1000) - Number(match[1]) * UNITS[match[2]]
}

export async function fetch(ctx) {
  const id = String(ctx.params.id ?? '').trim()

  if (!id) {
    throw new Error('請填寫分類 id，例如 1（攝影產品）、3（手機通訊）或 4（其它）')
  }

  const query = new URLSearchParams({ id, order: 'new', type: 'all' })
  const url = `${BASE}/trading/listing.php?${query}`

  ctx.log.debug(`dcfever: GET ${url}`)

  const response = await ctx.fetch(url, { headers: { accept: 'text/html' } })

  if (!response.ok) {
    throw new Error(`DCFever 返回 ${response.status} ${response.statusText}`)
  }

  const html = await response.text()
  const entries = []

  for (const block of html.split(/<div class="col-xs-6 col-md-3">/).slice(1)) {
    const anchor = /<a\b[^>]*\bhref="([^"]+)"/.exec(block)

    if (!anchor) continue

    const heading = /<div class="trade_title">([\s\S]*?)<\/div>/.exec(block)
    const title = text(heading?.[1])

    if (!title) continue

    const link = new URL(decode(anchor[1]), url).href
    const item = new URL(link).searchParams.get('id')

    if (!item) continue

    const entry = {
      id: `dcfever:trading:${item}`,
      title,
      url: link,
    }

    const image = /<img\b[^>]*\blazyloadx\b[^>]*>/.exec(block)
    const src = image ? /\bsrc="([^"]+)"/.exec(image[0]) : null

    if (src) entry.image = decode(src[1])

    // 價格、賣家、時間都寫在同一格裡，湊成一句摘要。
    const price = text(/<span class="price">([\s\S]*?)<\/span>/.exec(block)?.[1])
    const meta = /<span style="color: #999;">([\s\S]*?)<\/span>\s*<br>([\s\S]*?)<\/div>/.exec(block)
    const facts = [price, text(meta?.[1]), text(meta?.[2])].filter(Boolean)

    if (facts.length) entry.summary = facts.join(' · ')

    const publishedAt = seconds(text(meta?.[2]))

    if (publishedAt !== undefined) entry.publishedAt = publishedAt

    entries.push(entry)
  }

  if (entries.length === 0) {
    throw new Error(`DCFever 二手市集分類「${id}」裡沒有讀到任何物品，頁面結構可能已經變了`)
  }

  ctx.log.info(`dcfever: 二手市集 ${id} ${entries.length} 條`)

  return { entries }
}
