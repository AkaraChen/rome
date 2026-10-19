// Ported from RSSHub lib/routes/mastodon/timeline-remote.ts (AGPL-3.0).
/**
 * Mastodon -- Instance timeline (federated).
 *
 * The same public endpoint with `remote=true` returns statuses the instance
 * knows about from other servers. No token is required.
 */

export const meta = {
  id: 'rome.rsshub-mastodon-timeline-remote',
  name: 'Mastodon · 联邦时间线',
  version: '1.0.0',
  apiVersion: '1',
  view: 'socialMedia',
  description: '读取 Mastodon 实例的联邦时间线',
  icon: 'https://mastodon.social/favicon.ico',
  params: {
    fields: [
      {
        key: 'site',
        type: 'text',
        label: '实例域名',
        help: '只填域名，不要带 https:// 前缀，例如 mastodon.social',
        required: true,
        default: ''
      },
      {
        key: 'only_media',
        type: 'select',
        label: '仅媒体',
        help: '选择 true 只显示带媒体的嘟文',
        default: 'false',
        options: [
          { value: 'false', label: '全部' },
          { value: 'true', label: '仅媒体' }
        ]
      }
    ]
  }
};

function escapeAttribute(text) {
  return String(text == null ? '' : text).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;')
}

function mediaHtml(attachments) {
  return (attachments || []).map((item) => {
    const url = escapeAttribute(item.remote_url || item.url || '')
    const description = escapeAttribute(item.description || '')

    switch (item.type) {
      case 'gifv':
        return `<p><video src="${url}" autoplay loop></video></p>`
      case 'video':
        return `<p><video src="${url}" controls loop></video></p>`
      case 'audio':
        return `<p><audio controls src="${url}"></audio></p>`
      case 'image':
        return `<p><img src="${url}" alt="${description}"></p>`
      default:
        return `<p><a href="${url}">媒体附件</a></p>`
    }
  }).join('')
}

function textOf(html) {
  return String(html || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
}

function toEntry(status) {
  const boostedBy = status.reblog ? status.account : null
  const item = status.reblog || status
  const content = String(item.content || '').replace(/<\/?span[^>]*>/g, '')
  const plain = textOf(content)
  const titleText = plain || textOf(item.spoiler_text) || '（无正文）'
  const entry = {
    id: `mastodon:${item.uri}`,
    title: `@${item.account?.username || 'unknown'}: ${titleText.slice(0, 100)}`,
    url: item.url || item.uri,
    author: item.account ? `${item.account.display_name || item.account.username} (@${item.account.acct})` : undefined,
    content: `${item.spoiler_text ? `<p>${escapeAttribute(item.spoiler_text)}</p>` : ''}${content}${mediaHtml(item.media_attachments)}`
  }

  if (boostedBy) {
    entry.summary = `转发自 @${boostedBy.username}`
  }

  const image = (item.media_attachments || []).find((attachment) => attachment.type === 'image')

  if (image) {
    entry.image = image.preview_url || image.url
  }

  const timestamp = Date.parse(item.created_at)

  if (!Number.isNaN(timestamp)) {
    entry.publishedAt = Math.floor(timestamp / 1000)
  }

  return entry
}

export async function fetch(ctx) {
  const site = String(ctx.params.site || '').trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '')
  const onlyMedia = ctx.params.only_media === 'true' ? 'true' : 'false'

  if (!site) {
    throw new Error('mastodon: 实例域名不能为空，例如 mastodon.social')
  }

  const url = `https://${site}/api/v1/timelines/public?remote=true&only_media=${onlyMedia}`
  const response = await ctx.fetch(url, { headers: { accept: 'application/json' } })

  if (!response.ok) {
    // 422 means the instance has switched anonymous public timelines off.
    const hint = response.status === 422 ? '（该实例未开放匿名公共时间线，请换一个实例）' : ''
    throw new Error(`mastodon: ${site} federated timeline returned ${response.status} ${response.statusText}${hint}`)
  }

  const list = await response.json()

  if (!Array.isArray(list)) {
    throw new Error(`mastodon: ${site} federated timeline did not return a JSON array`)
  }

  return { entries: list.map(toEntry), icon: `https://${site}/favicon.ico` }
}
