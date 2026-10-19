// Ported from RSSHub lib/routes/people/liuyan.ts (AGPL-3.0).
// 人民网领导留言板 — liuyan.people.com.cn。
//
// 列表是一个 POST 接口，要带上留言板列表页作 referer。留言正文和官方回复
// 都在这一份响应里，不用再打开每条留言的页面。

export const meta = {
  id: 'rome.rsshub-people-liuyan',
  name: '人民网 · 领导留言板',
  version: '1.0.0',
  apiVersion: '1',
  view: 'socialMedia',
  description: '人民网领导留言板指定留言板的网友留言与官方回复',
  icon: 'https://liuyan.people.com.cn/favicon.ico',
  params: {
    fields: [
      {
        key: 'id',
        type: 'text',
        label: '留言板编号',
        help: '留言板页面 URL 中的编号，例如 539',
        default: '',
        required: true,
      },
      {
        key: 'state',
        type: 'select',
        label: '状态',
        help: '只看某个办理状态的留言',
        default: '1',
        required: false,
        options: [
          { value: '1', label: '全部' },
          { value: '2', label: '待回复' },
          { value: '3', label: '办理中' },
          { value: '4', label: '已办理' },
        ],
      },
    ],
  },
}

const ROOT = 'https://liuyan.people.com.cn'
const API = `${ROOT}/threads/queryThreadsList`
const STATES = new Set(['1', '2', '3', '4'])

function escape(text) {
  return String(text ?? '').replace(/[&<>"]/g, (ch) => {
    if (ch === '&') return '&amp;'
    if (ch === '<') return '&lt;'
    if (ch === '>') return '&gt;'
    return '&quot;'
  })
}

// 接口返回的是纯文本，换行要自己变成 <br>。
function paragraph(text) {
  return escape(text).replace(/\r?\n/g, '<br>')
}

function seconds(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : undefined
}

export async function fetch(ctx) {
  const id = String(ctx.params.id ?? '').trim()

  if (!id) {
    throw new Error('请填写留言板编号（数字）')
  }
  if (!/^\d+$/.test(id)) {
    throw new Error(`留言板编号 ${id} 无效，应为数字`)
  }

  const state = String(ctx.params.state ?? '1').trim() || '1'
  if (!STATES.has(state)) {
    throw new Error(`状态 ${state} 无效，只能是 1、2、3、4`)
  }

  // referer 必须是留言板列表页，接口会校验。
  const referer = `${ROOT}/threads/list?fid=${id}`

  ctx.log.debug(`people: POST ${API}`)

  const response = await ctx.fetch(API, {
    method: 'POST',
    headers: {
      referer,
      accept: 'application/json',
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ fid: id, state, lastItem: '0' }),
  })

  if (!response.ok) {
    throw new Error(`领导留言板返回 ${response.status} ${response.statusText}`)
  }

  const body = await response.json()

  if (body.result !== 'success' || !body.success || !Array.isArray(body.responseData)) {
    throw new Error(`领导留言板接口返回异常（result=${body.result}），接口可能已经改变`)
  }

  const entries = body.responseData.map((message) => {
    let content = `<p>${paragraph(message.content)}</p>`

    if (message.answerContent) {
      const organization = message.answerOrganization || '官方回复'
      content += `<hr><p><strong>${escape(organization)}</strong></p><p>${paragraph(message.answerContent)}</p>`
    }

    const entry = {
      // tid 是留言在站内的编号。
      id: `people:liuyan:${message.tid}`,
      title: message.subject,
      url: `${ROOT}/threads/content?tid=${message.tid}`,
      content,
    }

    if (message.nickName) entry.author = message.nickName

    const publishedAt = seconds(message.dateline)
    if (publishedAt !== undefined) entry.publishedAt = publishedAt

    const parts = [message.forumName, message.typeName, message.domainName, message.stateInfo].filter(Boolean)
    if (parts.length > 0) entry.summary = parts.join(' · ')

    return entry
  })

  if (entries.length === 0) {
    throw new Error(`留言板 ${id} 没有返回任何留言，编号可能不存在`)
  }

  return { entries, icon: `${ROOT}/favicon.ico` }
}
