// Ported from RSSHub lib/routes/guancha/member.ts (AGPL-3.0).
// 观学院 — one JSON endpoint behind member.guancha.cn lists four columns:
// 精选、观书堂、在线课、观学院. No login and no config.

export const meta = {
  id: 'rome.rsshub-guancha-member',
  name: '观察者网 · 观学院',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: '观察者网观学院的精选、观书堂、在线课与观学院栏目',
  icon: 'https://www.guancha.cn/favicon.ico',
  params: {
    fields: [
      {
        key: 'category',
        type: 'select',
        label: '分类',
        help: '选择要订阅的观学院栏目。',
        default: 'recommend',
        options: [
          { value: 'recommend', label: '精选' },
          { value: 'books', label: '观书堂' },
          { value: 'courses', label: '在线课' },
          { value: 'huodongs', label: '观学院' }
        ]
      }
    ]
  }
}

const ROOT = 'https://member.guancha.cn'
const API = `${ROOT}/zaixianke/home`

// 观学院的时间戳都是北京时间，即 UTC+8。
function chinaSeconds(text) {
  const match = /(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(String(text))
  if (!match) return undefined
  const milliseconds = Date.parse(`${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6] || '00'}+08:00`)
  return Number.isFinite(milliseconds) ? Math.floor(milliseconds / 1000) : undefined
}

function image(url) {
  return url ? `<img src="${String(url).replaceAll('"', '')}">` : ''
}

function toBooks(item) {
  return {
    id: `guancha:member:book:${item.id}`,
    title: item.title || '（无标题）',
    url: `${ROOT}/guanshutang/summary.html?id=${item.id}&page=0`,
    summary: `[${item.audio_time || ''}] ${item.desc_short || ''}`.trim(),
    content: image(item.cover),
    image: item.cover || undefined
  }
}

function toCourse(item) {
  const lessons = Array.isArray(item.items) ? item.items : []
  const times = lessons.map((lesson) => chinaSeconds(lesson.publish_time)).filter((value) => value !== undefined)

  const entry = {
    id: `guancha:member:course:${item.id}`,
    title: item.name || '（无标题）',
    url: `${ROOT}/zaixianke/summary.html?id=${item.id}`,
    summary: item.desc_short || '',
    content: image(item.cover) + lessons
      .map((lesson) => `<a href="${ROOT}/zaixianke/content.html?id=${lesson.id}">${lesson.title || ''}</a>`)
      .join('<br>'),
    image: item.cover || undefined
  }

  if (item.author_name) {
    entry.author = item.author_name
  }

  if (times.length > 0) {
    entry.publishedAt = Math.max(...times)
  }

  return entry
}

function toMedia(category, item) {
  const entry = {
    id: `guancha:member:${category}:${item.id}`,
    title: item.title || '（无标题）',
    url: item.jump_url || `${ROOT}/index.html`,
    summary: item.summary || item.post_summary || '',
    image: item.big_pic || item.h_pic || undefined
  }

  if (item.author_name) {
    entry.author = item.author_name
  }

  const publishedAt = chinaSeconds(item.created_at)
  if (publishedAt !== undefined) {
    entry.publishedAt = publishedAt
  }

  return entry
}

export async function fetch(ctx) {
  const category = String(ctx.params.category || '').trim() || 'recommend'

  if (!['recommend', 'books', 'courses', 'huodongs'].includes(category)) {
    throw new Error('观学院分类无效，请使用 recommend、books、courses 或 huodongs')
  }

  const response = await ctx.fetch(API, { headers: { accept: 'application/json' } })

  if (!response.ok) {
    throw new Error(`观学院返回 ${response.status} ${response.statusText}`)
  }

  const payload = await response.json()
  const data = payload?.data
  const list = data?.[category]

  if (!Array.isArray(list)) {
    throw new Error(`观学院接口没有返回 ${category} 列表`)
  }

  let entries

  if (category === 'books') {
    entries = list.map(toBooks)
  } else if (category === 'courses') {
    entries = list.map(toCourse)
  } else {
    entries = list.map((item) => toMedia(category, item))
  }

  return { entries }
}
