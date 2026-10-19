// Ported from RSSHub lib/routes/v2ex/post.ts (AGPL-3.0).
// V2EX 帖子 — www.v2ex.com/t/<postid>。
//
// 两个公开 JSON 接口：一个取主题本身，一个取全部回复。回复就是条目的
// 主体；原帖作为第一条一起给出，免得新帖还没有回复时列表是空的。

export const meta = {
  id: 'rome.rsshub-v2ex-post',
  name: 'V2EX · 帖子',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: 'V2EX 帖子的原帖与回复',
  icon: 'https://www.v2ex.com/favicon.ico',
  params: {
    fields: [
      {
        key: 'postid',
        type: 'text',
        label: '帖子 ID',
        help: '帖子 URL 中的数字，例如 v2ex.com/t/584403 就填 584403',
        default: '',
        required: true,
      },
    ],
  },
}

const BASE = 'https://www.v2ex.com'
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

// 回复内容直接当标题，长回复会把列表撑开，所以截断到一行左右。
const TITLE_LIMIT = 100

function seconds(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : undefined
}

function truncate(text) {
  const flat = String(text ?? '').replace(/\s+/g, ' ').trim()
  return flat.length > TITLE_LIMIT ? `${flat.slice(0, TITLE_LIMIT)}…` : flat
}

export async function fetch(ctx) {
  const postid = String(ctx.params.postid ?? '').trim()

  if (!postid) {
    throw new Error('请填写帖子 ID（数字）')
  }
  if (!/^\d+$/.test(postid)) {
    throw new Error(`帖子 ID ${postid} 无效，应为数字`)
  }

  const topicUrl = `${BASE}/api/topics/show.json?id=${postid}`
  const replyUrl = `${BASE}/api/replies/show.json?topic_id=${postid}`

  ctx.log.debug(`v2ex: GET ${topicUrl}`)

  const [topicResponse, replyResponse] = await Promise.all([
    ctx.fetch(topicUrl, { headers: { accept: 'application/json', 'user-agent': UA } }),
    ctx.fetch(replyUrl, { headers: { accept: 'application/json', 'user-agent': UA } }),
  ])

  if (!topicResponse.ok) {
    throw new Error(`V2EX 主题接口返回 ${topicResponse.status} ${topicResponse.statusText}`)
  }
  if (!replyResponse.ok) {
    throw new Error(`V2EX 回复接口返回 ${replyResponse.status} ${replyResponse.statusText}`)
  }

  const topics = await topicResponse.json()
  const replies = await replyResponse.json()

  if (!Array.isArray(topics) || topics.length === 0) {
    throw new Error(`V2EX 帖子 ${postid} 不存在，或者主题接口的返回结构已经变了`)
  }
  if (!Array.isArray(replies)) {
    throw new Error('V2EX 回复接口没有返回数组，接口可能已经变了')
  }

  const topic = topics[0]
  const page = `${BASE}/t/${postid}`

  const entries = [
    {
      // 和「最热 / 最新主题」共用主题编号。
      id: `v2ex:topic:${topic.id}`,
      title: topic.title,
      url: topic.url ?? page,
      content: topic.content_rendered,
      summary: '原帖',
    },
  ]

  if (topic.member?.username) entries[0].author = topic.member.username

  const publishedAt = seconds(topic.created)
  if (publishedAt !== undefined) entries[0].publishedAt = publishedAt

  replies.forEach((reply, index) => {
    const entry = {
      id: `v2ex:reply:${reply.id}`,
      title: `#${index + 1} ${truncate(reply.content)}`,
      url: `${page}#r_${reply.id}`,
      content: reply.content_rendered,
    }

    if (reply.member?.username) entry.author = reply.member.username

    const repliedAt = seconds(reply.created)
    if (repliedAt !== undefined) entry.publishedAt = repliedAt

    entries.push(entry)
  })

  return { entries, icon: `${BASE}/favicon.ico` }
}
