// Ported from RSSHub lib/routes/163/exclusive.ts (AGPL-3.0).
// 网易独家 — the columns are served by one JSONP endpoint on 3g.163.com. The
// column id is fixed per column, so the route's slug becomes a select. The
// article body is left to preview.

export const meta = {
  id: 'rome.rsshub-163-exclusive',
  name: '网易公开课 · 栏目',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: '网易独家的轻松一刻、槽值、人间等栏目',
  icon: 'https://www.163.com/favicon.ico',
  params: {
    fields: [
      {
        key: 'id',
        type: 'select',
        label: '栏目',
        help: '选择要订阅的网易独家栏目。',
        default: '',
        options: [
          { value: '', label: '首页' },
          { value: 'qsyk', label: '轻松一刻' },
          { value: 'cz', label: '槽值' },
          { value: 'rj', label: '人间' },
          { value: 'dgxm', label: '大国小民' },
          { value: 'ssyg', label: '三三有梗' },
          { value: 'sd', label: '数读' },
          { value: 'kk', label: '看客' },
          { value: 'xhx', label: '下划线' },
          { value: 'txs', label: '谈心社' },
          { value: 'dd', label: '哒哒' },
          { value: 'pbgl', label: '胖编怪聊' },
          { value: 'qyd', label: '曲一刀' },
          { value: 'jrzs', label: '今日之声' },
          { value: 'lc', label: '浪潮' },
          { value: 'fd', label: '沸点' }
        ]
      }
    ]
  }
}

const BASE = 'https://3g.163.com'

const COLUMNS = {
  '': 'BAI5E21O',
  qsyk: 'BD21K0DL',
  cz: 'CICMICLU',
  rj: 'CICMOMBL',
  dgxm: 'CICMPVC5',
  ssyg: 'CICMLCOU',
  sd: 'D551V75C',
  kk: 'D55253RH',
  xhx: 'D553A53L',
  txs: 'D553PGHQ',
  dd: 'CICMS5BI',
  pbgl: 'CQ9UDVKO',
  qyd: 'CQ9UJIJN',
  jrzs: 'BD284UM8',
  lc: 'CICMMGBH',
  fd: 'D5543R68'
}

function chinaSeconds(text) {
  const match = /(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(String(text))
  if (!match) return undefined
  const milliseconds = Date.parse(`${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6] || '00'}+08:00`)
  return Number.isFinite(milliseconds) ? Math.floor(milliseconds / 1000) : undefined
}

export async function fetch(ctx) {
  const id = String(ctx.params.id || '').trim()

  if (!Object.prototype.hasOwnProperty.call(COLUMNS, id)) {
    throw new Error('网易独家栏目无效，请使用首页、轻松一刻、槽值、人间等预设栏目')
  }

  const column = COLUMNS[id]
  const url = `${BASE}/touch/reconstruct/article/list/${column}wangning/0-20.html`
  const response = await ctx.fetch(url, { headers: { accept: 'application/javascript, text/plain' } })

  if (!response.ok) {
    throw new Error(`网易独家返回 ${response.status} ${response.statusText}`)
  }

  const body = await response.text()
  const match = /^artiList\(([\s\S]*)\)\s*$/.exec(body.trim())

  if (!match) {
    throw new Error('网易独家接口返回的不是 artiList 数据')
  }

  let list

  try {
    list = JSON.parse(match[1])[`${column}wangning`]
  } catch (error) {
    throw new Error(`网易独家数据不是合法 JSON：${error.message}`)
  }

  if (!Array.isArray(list)) {
    throw new Error(`网易独家栏目 ${id} 没有返回条目`)
  }

  const entries = list.map((item) => {
    const entry = {
      id: `163:exclusive:${item.docid}`,
      title: item.title || '（无标题）',
      url: item.skipURL || item.url || `${BASE}/dy/article/${item.docid}.html`
    }

    if (item.source) {
      entry.author = item.source
    }

    if (item.digest) {
      entry.summary = item.digest
    }

    if (item.imgsrc) {
      entry.image = item.imgsrc
    }

    const publishedAt = chinaSeconds(item.ptime)
    if (publishedAt !== undefined) {
      entry.publishedAt = publishedAt
    }

    return entry
  })

  return { entries }
}

export async function preview(ctx) {
  const url = ctx.item?.url
  if (!url) return null
  const content = await ctx.article(url)
  return content === null ? null : { content }
}
