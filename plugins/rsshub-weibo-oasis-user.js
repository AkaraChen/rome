// Ported from RSSHub lib/routes/weibo/oasis/user.ts (AGPL-3.0).
// Weibo — a 绿洲 (Oasis) user's posts.
//
// Oasis is Weibo's picture feed, and its share pages are server-rendered HTML
// with no login, unlike the main site.
//
// Each card carries its id on the wrapper, its picture in `status-img` and its
// caption as the text of `status-item-title` — the caption must be cut before
// the nested `status-item-bottom` block, which holds the author and the likes.

export const meta = {
  id: 'rome.rsshub-weibo-oasis-user',
  name: '微博 · 绿洲用户',
  version: '1.0.0',
  apiVersion: '1',
  view: 'pictures',
  description: '微博绿洲用户的图片动态',
  icon: 'https://weibo.com/favicon.ico',
  params: {
    fields: [
      {
        key: 'userid',
        type: 'text',
        label: '用户 id',
        help: '可在绿洲用户主页网址中找到，例如 1990895721',
        default: '',
      },
    ],
  },
}

const ROOT = 'https://oasis.weibo.cn'

function decode(text) {
  const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }
  return String(text).replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity) => {
    if (entity[0] === '#') {
      const code = entity[1] === 'x' || entity[1] === 'X'
        ? Number.parseInt(entity.slice(2), 16)
        : Number.parseInt(entity.slice(1), 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : match
    }
    return Object.prototype.hasOwnProperty.call(entities, entity) ? entities[entity] : match
  })
}

function strip(html) {
  return decode(String(html).replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim()
}

export async function fetch(ctx) {
  const userid = String(ctx.params.userid || '').trim()

  if (!userid) {
    throw new Error('请填写绿洲用户 id，例如 1990895721')
  }

  const response = await ctx.fetch(`${ROOT}/v1/h5/share?uid=${encodeURIComponent(userid)}`, {
    headers: { accept: 'text/html' },
  })

  if (!response.ok) {
    throw new Error(`绿洲返回 ${response.status} ${response.statusText}`)
  }

  const html = await response.text()
  const entries = []
  const seen = new Set()

  for (const part of html.split('<div data-id="').slice(1)) {
    const head = /^(\d+)"\s+class="status-item"/.exec(part)
    if (!head) continue

    const dataId = head[1]
    if (seen.has(dataId)) continue
    seen.add(dataId)

    const caption = /<div class="status-item-title">([\s\S]*?)<div class="status-item-bottom">/.exec(part)
    const title = caption ? strip(caption[1]) : ''

    const entry = {
      id: `weibo:oasis:${dataId}`,
      title: title || `绿洲动态 ${dataId}`,
      url: `${ROOT}/v1/h5/share?sid=${dataId}`,
    }

    const image = /<div class="status-img"><img[^>]*src="([^"]+)"/.exec(part)
    if (image) entry.image = decode(image[1])

    const author = /<div class="item-bottom-name">([\s\S]*?)<\/div>/.exec(part)
    if (author) entry.author = strip(author[1])

    const likes = /<div class="item-bottom-like">([\s\S]*?)<\/div>/.exec(part)
    if (likes) {
      const count = strip(likes[1])
      if (count) entry.summary = `${count} 次点赞`
    }

    entries.push(entry)
  }

  if (entries.length === 0) {
    throw new Error('绿洲页面结构已变化，未找到动态')
  }

  return { entries }
}
