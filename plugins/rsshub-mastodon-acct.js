// Ported from RSSHub lib/routes/mastodon/acct.ts (AGPL-3.0).
/**
 * Mastodon -- User timeline.
 *
 * The account is looked up through the instance's public search endpoint
 * (v2/search needs no token for accounts since Mastodon 4.0), then its
 * statuses are read. Boosts are unwrapped so each entry is the written status.
 */

export const meta = {
  id: 'rome.rsshub-mastodon-acct',
  name: 'Mastodon · 用户时间线',
  version: '1.0.0',
  apiVersion: '1',
  view: 'socialMedia',
  description: '读取 Mastodon 用户的公开嘟文，例如 Mastodon@mastodon.social',
  icon: 'https://mastodon.social/favicon.ico',
  params: {
    fields: [
      {
        key: 'acct',
        type: 'text',
        label: '用户',
        help: 'user@host 形式，例如 Mastodon@mastodon.social',
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
  const acct = String(ctx.params.acct || '').trim().replace(/^@/, '')
  const onlyMedia = ctx.params.only_media === 'true' ? 'true' : 'false'
  const [user, host] = acct.split('@').filter(Boolean)

  if (!user || !host) {
    throw new Error('mastodon: 用户需要写成 user@host，例如 Mastodon@mastodon.social')
  }

  const search = await ctx.fetch(`https://${host}/api/v2/search?q=${encodeURIComponent(acct)}&type=accounts`, {
    headers: { accept: 'application/json' }
  })

  if (!search.ok) {
    throw new Error(`mastodon: lookup of ${acct} returned ${search.status} ${search.statusText}`)
  }

  const accounts = (await search.json())?.accounts

  if (!Array.isArray(accounts)) {
    throw new Error(`mastodon: lookup of ${acct} did not return accounts; the response shape changed`)
  }

  // An account on another server is listed there as user@its-host.
  const account = accounts.find((candidate) => candidate.acct === user || candidate.acct === `${user}@${host}`) || accounts[0]

  if (!account?.id) {
    throw new Error(`mastodon: ${acct} was not found on ${host}`)
  }

  const response = await ctx.fetch(`https://${host}/api/v1/accounts/${account.id}/statuses?only_media=${onlyMedia}`, {
    headers: { accept: 'application/json' }
  })

  if (!response.ok) {
    throw new Error(`mastodon: statuses of ${acct} returned ${response.status} ${response.statusText}`)
  }

  const list = await response.json()

  if (!Array.isArray(list)) {
    throw new Error(`mastodon: statuses of ${acct} did not return a JSON array`)
  }

  return {
    entries: list.map(toEntry),
    icon: account.avatar_static || account.avatar || `https://${host}/favicon.ico`
  }
}
