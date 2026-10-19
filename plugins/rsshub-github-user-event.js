// Ported from RSSHub lib/routes/github/user-event.ts (AGPL-3.0).
// GitHub 用户动态 — /github/user_event/:username/:types
//
// The public events endpoint, unauthenticated: it returns the account's last
// 90 days of public activity, 100 events at a time. `types` filters on the
// event's `type` field, which is the API's own vocabulary rather than the
// plugin's — the option values are kept as RSSHub spells them.

export const meta = {
  id: 'rome.rsshub-github-user-event',
  name: 'GitHub · 用户动态',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: 'GitHub 用户的公开动态事件',
  icon: 'https://github.com/favicon.ico',
  params: {
    fields: [
      {
        key: 'username',
        type: 'text',
        label: '用户名',
        help: 'GitHub 用户名',
        placeholder: 'mslxl',
        default: '',
      },
      {
        key: 'types',
        type: 'select',
        label: '事件类型',
        help: '按事件类型过滤，默认为全部',
        default: 'all',
        options: [
          { value: 'all', label: '全部事件' },
          { value: 'create', label: '创建分支或标签' },
          { value: 'delete', label: '删除分支或标签' },
          { value: 'fork', label: 'Fork' },
          { value: 'issue', label: '新建 Issue' },
          { value: 'issuecomm', label: 'Issue 评论' },
          { value: 'member', label: '成员变更' },
          { value: 'pr', label: 'Pull Request' },
          { value: 'prcomm', label: 'Pull Request 评审评论' },
          { value: 'prrev', label: 'Pull Request 评审' },
          { value: 'public', label: '仓库转为公开' },
          { value: 'push', label: '推送' },
          { value: 'release', label: '发布 Release' },
          { value: 'star', label: 'Star' },
          { value: 'wiki', label: 'Wiki 编辑' },
          { value: 'cmcomm', label: '提交评论' },
          { value: 'discussion', label: 'Discussion' },
        ],
      },
    ],
  },
}

const API = 'https://api.github.com'

// The route's names for the API's event types.
const EVENT_TYPES = {
  create: 'CreateEvent',
  delete: 'DeleteEvent',
  issuecomm: 'IssueCommentEvent',
  fork: 'ForkEvent',
  member: 'MemberEvent',
  public: 'PublicEvent',
  push: 'PushEvent',
  pr: 'PullRequestEvent',
  prcomm: 'PullRequestReviewCommentEvent',
  release: 'ReleaseEvent',
  star: 'WatchEvent',
  issue: 'IssuesEvent',
  prrev: 'PullRequestReviewEvent',
  discussion: 'DiscussionEvent',
  wiki: 'GollumEvent',
  cmcomm: 'CommitCommentEvent',
}

function firstLine(text, limit) {
  const line = String(text ?? '').replace(/\s+/g, ' ').trim()
  if (!line) return undefined
  return line.length > limit ? `${line.slice(0, limit - 1)}…` : line
}

/// Each event type carries its own payload shape, and only a few of them are
/// worth spelling out; the rest get a readable generic line rather than a
/// wrong one. `link` is the most specific page the payload names.
function describe(event) {
  const { type, actor, repo, payload = {} } = event
  const who = actor?.login || '某人'
  const where = repo?.name || '未知仓库'

  switch (type) {
    case 'PushEvent': {
      const branch = String(payload.ref || '').replace('refs/heads/', '') || '未知分支'
      const commits = payload.commits || []
      const latest = commits[commits.length - 1]
      return {
        title: `${who} 推送了 ${where} 的 ${branch}`,
        link: `https://github.com/${where}/compare/${payload.before}..${payload.head}`,
        summary: firstLine(latest?.message, 140) || `推送 ${payload.size ?? commits.length ?? 0} 个提交`,
      }
    }
    case 'PullRequestEvent':
      return {
        title: `${who} 在 ${where} ${payload.action || '更新'}了 Pull Request`,
        link: payload.pull_request?.html_url || `https://github.com/${where}`,
        summary: firstLine(payload.pull_request?.title, 140) || 'Pull Request',
      }
    case 'IssuesEvent':
      return {
        title: `${who} 在 ${where} ${payload.action || '更新'}了 Issue`,
        link: payload.issue?.html_url || `https://github.com/${where}`,
        summary: firstLine(payload.issue?.title, 140) || 'Issue',
      }
    case 'IssueCommentEvent':
      return {
        title: `${who} 评论了 ${where} 的 Issue`,
        link: payload.comment?.html_url || `https://github.com/${where}`,
        summary: firstLine(payload.comment?.body, 140) || 'Issue 评论',
      }
    case 'WatchEvent':
      return {
        title: `${who} Star 了 ${where}`,
        link: `https://github.com/${where}`,
        summary: `Star 了 ${where}`,
      }
    case 'ForkEvent':
      return {
        title: `${who} Fork 了 ${where}`,
        link: payload.forkee?.html_url || `https://github.com/${where}`,
        summary: `Fork 到 ${payload.forkee?.full_name || where}`,
      }
    case 'ReleaseEvent':
      return {
        title: `${who} 发布了 ${where} 的 ${payload.release?.name || payload.release?.tag_name || '新版本'}`,
        link: payload.release?.html_url || `https://github.com/${where}`,
        summary: firstLine(payload.release?.body, 140) || 'Release',
      }
    case 'CreateEvent':
      return {
        title: `${who} 在 ${where} 创建了 ${payload.ref_type || '内容'}`,
        link: `https://github.com/${where}`,
        summary: [payload.ref_type, payload.ref].filter(Boolean).join(' '),
      }
    case 'DeleteEvent':
      return {
        title: `${who} 在 ${where} 删除了 ${payload.ref_type || '内容'}`,
        link: `https://github.com/${where}`,
        summary: [payload.ref_type, payload.ref].filter(Boolean).join(' '),
      }
    case 'PublicEvent':
      return {
        title: `${who} 将 ${where} 转为公开`,
        link: `https://github.com/${where}`,
        summary: `${where} 转为公开仓库`,
      }
    case 'MemberEvent':
      return {
        title: `${who} 在 ${where} ${payload.action || '变更'}了成员`,
        link: `https://github.com/${where}`,
        summary: firstLine(payload.member?.login, 140) || '成员变更',
      }
    case 'PullRequestReviewEvent':
      return {
        title: `${who} 评审了 ${where} 的 Pull Request`,
        link: payload.review?.html_url || `https://github.com/${where}`,
        summary: firstLine(payload.review?.body, 140) || '评审',
      }
    case 'PullRequestReviewCommentEvent':
      return {
        title: `${who} 评论了 ${where} 的 Pull Request 评审`,
        link: payload.comment?.html_url || `https://github.com/${where}`,
        summary: firstLine(payload.comment?.body, 140) || '评审评论',
      }
    case 'CommitCommentEvent':
      return {
        title: `${who} 评论了 ${where} 的提交`,
        link: payload.comment?.html_url || `https://github.com/${where}`,
        summary: firstLine(payload.comment?.body, 140) || '提交评论',
      }
    case 'GollumEvent': {
      const page = payload.pages?.[0]
      return {
        title: `${who} 编辑了 ${where} 的 Wiki`,
        link: page?.html_url || `https://github.com/${where}/wiki`,
        summary: firstLine(page?.title, 140) || 'Wiki 编辑',
      }
    }
    case 'DiscussionEvent':
      return {
        title: `${who} 在 ${where} ${payload.action || '更新'}了 Discussion`,
        link: payload.discussion?.html_url || `https://github.com/${where}/discussions`,
        summary: firstLine(payload.discussion?.title, 140) || 'Discussion',
      }
    default:
      return {
        title: `${who} 在 ${where} 触发了 ${type || '未知事件'}`,
        link: `https://github.com/${where}`,
        summary: type || undefined,
      }
  }
}

export async function fetch(ctx) {
  const username = String(ctx.params.username || '').trim()

  if (!username) {
    throw new Error('请填写 GitHub 用户名')
  }

  const types = EVENT_TYPES[ctx.params.types] ? ctx.params.types : 'all'

  const url = new URL(`${API}/users/${encodeURIComponent(username)}/events/public`)
  url.searchParams.set('per_page', '100')

  const response = await ctx.fetch(url, {
    headers: {
      accept: 'application/vnd.github+json',
      'user-agent': 'rome',
    },
  })

  if (response.status === 404) {
    throw new Error('GitHub 上找不到这个用户')
  }

  if (response.status === 403 || response.status === 429) {
    throw new Error('GitHub 接口限流了（未登录每小时 60 次），稍后再试')
  }

  if (!response.ok) {
    throw new Error(`GitHub 返回 ${response.status}（${username} 的动态）`)
  }

  const events = await response.json()

  if (!Array.isArray(events)) {
    throw new Error('GitHub 没有返回事件数组，接口可能已经变了')
  }

  const wanted = types === 'all' ? null : EVENT_TYPES[types]

  const entries = events
    .filter((event) => !wanted || event.type === wanted)
    .map((event) => {
      const described = describe(event)

      const entry = {
        id: `github-event:${event.id}`,
        title: described.title,
        url: described.link,
        author: event.actor?.login,
      }

      if (described.summary) entry.summary = described.summary

      const publishedAt = Date.parse(event.created_at || '')
      if (Number.isFinite(publishedAt)) entry.publishedAt = Math.floor(publishedAt / 1000)

      return entry
    })

  ctx.log.info(`github-event: ${entries.length} 条（${username}，${types}）`)

  return { entries }
}
