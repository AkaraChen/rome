// Ported from RSSHub lib/routes/nowcoder/interview.ts (AGPL-3.0).
// Nowcoder — interview reports for one job.
//
// A public JSON API answering a POST. Each record carries the post under one of
// two keys depending on how it was written — `momentData` for a feed post and
// `contentData` for a longer article — so both are read.

export const meta = {
  id: 'rome.rsshub-nowcoder-interview',
  name: '牛客网 · 面试经验',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: '牛客网指定岗位的面试经验',
  icon: 'https://www.nowcoder.com/favicon.ico',
  params: {
    fields: [
      {
        key: 'jobId',
        type: 'text',
        label: '岗位 id',
        help: '可在官网岗位列表中找到，例如 11200 表示后端开发',
        default: '',
      },
    ],
  },
}

const API = 'https://gw-c.nowcoder.com/api/sparta/job-experience/experience/job/list'

function escape(text) {
  const entities = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }
  return String(text).replace(/[&<>"]/g, (character) => entities[character])
}

function paragraph(text) {
  return `<p>${escape(text).replace(/\n/g, '<br>')}</p>`
}

export async function fetch(ctx) {
  const jobId = String(ctx.params.jobId || '').trim()

  if (!jobId) {
    throw new Error('请填写岗位 id，例如 11200 表示后端开发')
  }

  const response = await ctx.fetch(`${API}?_=${Date.now()}`, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ jobId, level: 3, order: 3, page: 1 }),
  })

  if (!response.ok) {
    throw new Error(`牛客网返回 ${response.status} ${response.statusText}`)
  }

  const payload = await response.json()

  if (payload?.code !== 0) {
    throw new Error(`牛客网接口错误：${payload?.code} ${payload?.msg || ''}`)
  }

  const records = payload?.data?.records
  if (!Array.isArray(records)) {
    throw new Error('牛客网面试经验接口结构已变化')
  }

  const entries = []

  for (const record of records) {
    const post = record?.momentData || record?.contentData
    if (!post?.uuid) continue

    const body = String(post.content || '')
    const entry = {
      id: `nowcoder:experience:${post.uuid}`,
      title: String(post.title || '').trim() || body.replace(/\s+/g, ' ').trim().slice(0, 60) || '面经',
      url: `https://www.nowcoder.com/feed/main/detail/${post.uuid}`,
      content: paragraph(body),
    }

    const createdAt = Number(post.createdAt || post.createTime)
    if (Number.isFinite(createdAt) && createdAt > 0) {
      entry.publishedAt = Math.floor(createdAt / 1000)
    }

    entries.push(entry)
  }

  if (entries.length === 0) {
    throw new Error('牛客网面试经验没有返回条目')
  }

  return { entries }
}
