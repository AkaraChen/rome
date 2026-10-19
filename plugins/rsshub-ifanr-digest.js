// Ported from RSSHub lib/routes/ifanr/digest.ts (AGPL-3.0).
// 爱范儿快讯 — a short-form JSON feed.
//
// The buzz endpoint is the digest stream. Its objects already carry the whole
// post in `post_content`, so this fetches the listing and nothing else. The
// canonical link is built from the post id, exactly as the upstream route
// does; the object's own fields do not include a per-buzz URL.
//
// The API redirects from `/buzz` to `/buzz/`; ctx.fetch follows it.

export const meta = {
  id: 'rome.rsshub-ifanr-digest',
  name: '爱范儿 · 快讯',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: '爱范儿快讯频道的短讯更新',
  icon: 'https://www.ifanr.com/favicon.ico',
}

const API = 'https://sso.ifanr.com/api/v5/wp/buzz?limit=20&offset=0'

function decode(text) {
  return String(text).replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (match, entity) => {
    if (entity[0] === '#') {
      const code = entity[1] === 'x' || entity[1] === 'X'
        ? Number.parseInt(entity.slice(2), 16)
        : Number.parseInt(entity.slice(1), 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : match
    }
    return match
  })
}

function plain(html, limit) {
  const text = decode(String(html ?? '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim()
  if (!limit || text.length <= limit) return text
  return `${text.slice(0, limit).replace(/\s+$/, '')}…`
}

function seconds(value) {
  const number = Number(value)
  if (!Number.isFinite(number) || number <= 0) return undefined
  return Math.floor(number > 1e12 ? number / 1000 : number)
}

export async function fetch(ctx) {
  ctx.log.debug(`ifanr-digest: GET ${API}`)

  const response = await ctx.fetch(API, { headers: { accept: 'application/json' } })

  if (!response.ok) {
    throw new Error(`爱范儿快讯返回 ${response.status} ${response.statusText}`)
  }

  const body = await response.json()

  if (!Array.isArray(body?.objects)) {
    throw new Error('爱范儿快讯没有返回 objects 数组，接口可能已经变了')
  }

  const entries = body.objects
    .filter((item) => item?.post_id && item.post_title)
    .map((item) => {
      const entry = {
        id: `ifanr:digest:${item.post_id}`,
        title: plain(item.post_title),
        url: `https://www.ifanr.com/digest/${item.post_id}`,
        content: item.post_content,
        summary: plain(item.post_content, 120),
      }

      const publishedAt = seconds(item.created_at)
      if (publishedAt !== undefined) entry.publishedAt = publishedAt

      return entry
    })

  if (entries.length === 0) {
    throw new Error('爱范儿快讯返回了 0 条可解析的内容，接口可能已经变了')
  }

  ctx.log.info(`ifanr-digest: ${entries.length} 条`)

  return { entries }
}
