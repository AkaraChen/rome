// Ported from RSSHub lib/routes/nowcoder/schedule.ts (AGPL-3.0).
// Nowcoder — the campus recruitment calendar.
//
// A public JSON API. Each company carries a list of schedule rows, which are
// rendered as a small table; the content is plain text from the site, so it is
// escaped before it becomes markup.

export const meta = {
  id: 'rome.rsshub-nowcoder-schedule',
  name: '牛客网 · 校招日程',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: '牛客网名企校招日程',
  icon: 'https://www.nowcoder.com/favicon.ico',
  params: {
    fields: [
      {
        key: 'propertyId',
        type: 'number',
        label: '行业 id',
        help: '可在官网控制台抓取接口获得，默认 0 表示全部',
        default: 0,
      },
      {
        key: 'typeId',
        type: 'number',
        label: '类别 id',
        help: '可在官网控制台抓取接口获得，默认 0 表示全部',
        default: 0,
      },
    ],
  },
}

const API = 'https://www.nowcoder.com/school/schedule/data'

function escape(text) {
  const entities = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }
  return String(text).replace(/[&<>"]/g, (character) => entities[character])
}

export async function fetch(ctx) {
  const propertyId = String(ctx.params.propertyId ?? '0').trim() || '0'
  const typeId = String(ctx.params.typeId ?? '0').trim() || '0'

  const query = new URLSearchParams({
    token: '',
    query: '',
    typeId,
    propertyId,
    onlyFollow: 'false',
    _: String(Date.now()),
  })

  const response = await ctx.fetch(`${API}?${query}`, { headers: { accept: 'application/json' } })

  if (!response.ok) {
    throw new Error(`牛客网返回 ${response.status} ${response.statusText}`)
  }

  const payload = await response.json()

  if (payload?.code !== 0) {
    throw new Error(`牛客网接口错误：${payload?.code} ${payload?.msg || ''}`)
  }

  const list = payload?.data?.companyList
  if (!Array.isArray(list)) {
    throw new Error('牛客网校招日程接口结构已变化')
  }

  const entries = []

  for (const item of list) {
    if (!item?.id) continue

    const rows = Array.isArray(item.schedules)
      ? item.schedules
        .map((each) => `<tr><td>${escape(each.content || '')}</td><td>${escape(each.time || '')}</td></tr>`)
        .join('')
      : ''

    const entry = {
      id: `nowcoder:schedule:${item.id}`,
      title: String(item.name || '').trim(),
      url: `https://www.nowcoder.com/school/schedule/${item.id}`,
      content: `<table>${rows}</table>`,
    }

    const logo = item.logo || item.logoRadius
    if (logo) entry.image = logo

    const createdAt = Number(item.createTime)
    if (Number.isFinite(createdAt) && createdAt > 0) {
      entry.publishedAt = Math.floor(createdAt / 1000)
    }

    entries.push(entry)
  }

  if (entries.length === 0) {
    throw new Error('牛客网校招日程没有返回条目')
  }

  return { entries }
}
