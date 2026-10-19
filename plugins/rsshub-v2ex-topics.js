// Ported from RSSHub lib/routes/v2ex/topics.ts (AGPL-3.0).
// V2EX 最热 / 最新主题 — www.v2ex.com/api/topics/。
//
// 公开 JSON 接口，正文的渲染版就在列表里（content_rendered），不用再打开
// 每个帖子。接口认 user-agent，所以显式带一个。

export const meta = {
  id: 'rome.rsshub-v2ex-topics',
  name: 'V2EX · 最热 / 最新主题',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: 'V2EX 的最热或最新主题',
  icon: 'https://www.v2ex.com/favicon.ico',
  params: {
    fields: [
      {
        key: 'type',
        type: 'select',
        label: '类型',
        help: '要读最热还是最新',
        default: 'hot',
        required: false,
        options: [
          { value: 'hot', label: '最热主题' },
          { value: 'latest', label: '最新主题' },
        ],
      },
    ],
  },
}

const API = 'https://www.v2ex.com/api/topics'
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

const TYPES = { hot: '最热主题', latest: '最新主题' }

function seconds(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : undefined
}

export async function fetch(ctx) {
  const type = String(ctx.params.type ?? 'hot').trim() || 'hot'

  if (!Object.prototype.hasOwnProperty.call(TYPES, type)) {
    throw new Error(`类型 ${type} 无效，可选 hot 或 latest`)
  }

  const url = `${API}/${type}.json`

  ctx.log.debug(`v2ex: GET ${url}`)

  const response = await ctx.fetch(url, {
    headers: { accept: 'application/json', 'user-agent': UA },
  })

  if (!response.ok) {
    throw new Error(`V2EX ${TYPES[type]}返回 ${response.status} ${response.statusText}`)
  }

  const list = await response.json()

  if (!Array.isArray(list)) {
    throw new Error('V2EX 主题接口没有返回数组，接口可能已经变了')
  }

  const entries = list.map((item) => {
    const entry = {
      // 主题编号在站内唯一。
      id: `v2ex:topic:${item.id}`,
      title: item.title,
      url: item.url,
      content: item.content_rendered,
    }

    if (item.member?.username) entry.author = item.member.username

    const publishedAt = seconds(item.created)
    if (publishedAt !== undefined) entry.publishedAt = publishedAt

    const parts = [item.node?.title, `${item.replies} 回复`].filter(Boolean)
    if (parts.length > 0) entry.summary = parts.join(' · ')

    return entry
  })

  if (entries.length === 0) {
    throw new Error(`V2EX ${TYPES[type]}没有返回任何主题`)
  }

  return { entries, icon: 'https://www.v2ex.com/favicon.ico' }
}
