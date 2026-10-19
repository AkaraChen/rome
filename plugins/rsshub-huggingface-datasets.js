// Ported from RSSHub lib/routes/huggingface/datasets.ts (AGPL-3.0).
// Hugging Face 数据集 — /huggingface/datasets/:author
//
// The Hub's dataset API, filtered by author and sorted by creation date. The
// `full` flag is what adds `cardData`, which is where the task categories and
// the human-readable name live — without it the response is a list of ids.

export const meta = {
  id: 'rome.rsshub-huggingface-datasets',
  name: 'Hugging Face · 数据集',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: 'Hugging Face 用户或组织最新创建的数据集',
  icon: 'https://huggingface.co/favicon.ico',
  params: {
    fields: [
      {
        key: 'author',
        type: 'text',
        label: '作者',
        help: 'Hugging Face 用户名或组织名，例如 HuggingFaceFW',
        placeholder: 'HuggingFaceFW',
        default: '',
      },
    ],
  },
}

const API = 'https://huggingface.co/api/datasets'

function firstLine(text, limit) {
  const line = String(text ?? '').replace(/\s+/g, ' ').trim()
  if (!line) return undefined
  return line.length > limit ? `${line.slice(0, limit - 1)}…` : line
}

export async function fetch(ctx) {
  const author = String(ctx.params.author || '').trim()

  if (!author) {
    throw new Error('请填写 Hugging Face 用户名或组织名')
  }

  const url = new URL(API)
  url.searchParams.set('author', author)
  url.searchParams.set('sort', 'createdAt')
  url.searchParams.set('direction', '-1')
  url.searchParams.set('limit', '20')
  url.searchParams.set('full', 'true')

  const response = await ctx.fetch(url, { headers: { accept: 'application/json' } })

  if (!response.ok) {
    throw new Error(`Hugging Face 返回 ${response.status}（${author}）`)
  }

  const datasets = await response.json()

  if (!Array.isArray(datasets)) {
    throw new Error('Hugging Face 没有返回数据集数组，接口可能已经变了')
  }

  const entries = datasets.map((dataset) => {
    const tasks = dataset.cardData?.task_categories || []
    const pretty = dataset.cardData?.pretty_name

    const entry = {
      id: `huggingface-dataset:${dataset.id}`,
      title: pretty || dataset.id,
      url: `https://huggingface.co/datasets/${dataset.id}`,
      author: dataset.author || author,
      summary: firstLine(dataset.description, 140) || (tasks.length > 0 ? tasks.join(' · ') : undefined),
    }

    const publishedAt = Date.parse(dataset.createdAt || '')
    if (Number.isFinite(publishedAt)) entry.publishedAt = Math.floor(publishedAt / 1000)

    return entry
  })

  ctx.log.info(`huggingface-datasets: ${entries.length} 条（${author}）`)

  return { entries }
}

export async function preview(ctx) {
  const content = await ctx.article(ctx.item.url)
  return content ? { content } : null
}
