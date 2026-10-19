// Ported from RSSHub lib/routes/dgtle/feed.ts (AGPL-3.0).
// 数字尾巴热门动态 — /dgtle/feed
//
// The community feed: short posts, most of them a caption and a picture. The
// payload calls a post's text `content` and gives it no title at all, so the
// caption becomes the title after its markdown is flattened to plain text.
//
// RSSHub then fetches each post page for a fuller body. This plugin does not —
// the feed payload already carries the pictures and the caption, and the entry
// opens the post itself.

export const meta = {
  id: 'rome.rsshub-dgtle-feed',
  name: '数字尾巴 · 热门动态',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: '数字尾巴社区的热门动态',
  icon: 'https://www.dgtle.com/favicon.ico',
}

const API = 'https://www.dgtle.com/feed/getHotDynamic'
const HOST = 'https://www.dgtle.com'

/// The caption is markdown, and the feed wants one line of plain text: images
/// and links are dropped, the link's own text kept, the emphasis markers
/// removed.
function plain(markdown, limit) {
  const text = String(markdown ?? '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#*_>`~]/g, '')
    .replace(/\s+/g, ' ')
    .trim()

  if (!text) return undefined
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text
}

export async function fetch(ctx) {
  const url = new URL(API)
  url.searchParams.set('last_id', '0')

  const response = await ctx.fetch(url, { headers: { accept: 'application/json' } })

  if (!response.ok) {
    throw new Error(`数字尾巴返回 ${response.status}`)
  }

  const list = (await response.json()).data?.dataList

  if (!Array.isArray(list)) {
    throw new Error('数字尾巴没有返回动态列表，接口可能已经变了')
  }

  const entries = list.map((item) => {
    const text = plain(item.content, 80)

    const entry = {
      id: `dgtle:${item.id}`,
      title: text || '数字尾巴动态',
      url: item.url ? `${HOST}${item.url}` : HOST,
      author: item.user_name || undefined,
    }

    const image = item.imgs_url?.[0] || item.cover || undefined
    if (image) entry.image = image

    const publishedAt = Number(item.created_at)
    if (Number.isFinite(publishedAt)) entry.publishedAt = Math.floor(publishedAt)

    return entry
  })

  ctx.log.info(`dgtle-feed: ${entries.length} 条`)

  return { entries }
}
