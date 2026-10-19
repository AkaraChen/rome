// Ported from RSSHub lib/routes/twitter/tweet.ts (AGPL-3.0).
// X (Twitter) — one tweet.
//
// The upstream route signs in with the developer API. This port reads the
// syndication endpoint that x.com itself uses to embed a tweet, which needs no
// credentials: the tweet id plus a token derived from it. Only that one tweet
// is returned, which is what the route is for.
//
// The `original` parameter of the upstream route selects a raw-data mode that
// the plugin protocol has no equivalent for; it is accepted and ignored.

export const meta = {
  id: 'rome.rsshub-twitter-tweet',
  name: 'X · 单条推文',
  version: '1.0.0',
  apiVersion: '1',
  view: 'socialMedia',
  description: 'X 平台单条推文的详情',
  icon: 'https://abs.twimg.com/favicons/twitter.3.ico',
  params: {
    fields: [
      {
        key: 'id',
        type: 'text',
        label: '用户名',
        help: '推文作者的屏幕名，例如 DIYgod',
        default: '',
      },
      {
        key: 'status',
        type: 'text',
        label: '推文 id',
        help: '推文链接末尾的数字，例如 1650844643997646852',
        default: '',
      },
      {
        key: 'original',
        type: 'text',
        label: '原始数据',
        help: '上游用于返回原始数据，本插件不支持，可留空',
        default: '',
      },
    ],
  },
}

const API = 'https://cdn.syndication.twimg.com/tweet-result'

// The embed endpoint wants a token derived from the tweet id; the formula is
// the one x.com ships in its own embed script.
function token(id) {
  return ((Number(id) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, '')
}

function escape(text) {
  const entities = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }
  return String(text).replace(/[&<>"]/g, (character) => entities[character])
}

export async function fetch(ctx) {
  const id = String(ctx.params.id || '').trim()
  const status = String(ctx.params.status || '').trim()

  if (!id) throw new Error('请填写推文作者的屏幕名')
  if (!status) throw new Error('请填写推文 id')

  const query = new URLSearchParams({ id: status, lang: 'en', token: token(status) })
  const response = await ctx.fetch(`${API}?${query}`, { headers: { accept: 'application/json' } })

  if (!response.ok) {
    throw new Error(`X 返回 ${response.status} ${response.statusText}`)
  }

  const tweet = await response.json()

  if (!tweet || !tweet.id_str) {
    throw new Error('推文不存在，或 X 的嵌入接口结构已变化')
  }

  const screenName = tweet.user?.screen_name || id
  const text = String(tweet.text || '').trim()

  const entry = {
    id: `twitter:tweet:${tweet.id_str}`,
    title: text.replace(/\s+/g, ' ').trim() || `@${screenName} 的推文`,
    url: `https://x.com/${screenName}/status/${tweet.id_str}`,
    content: `<p>${escape(text).replace(/\n/g, '<br>')}</p>`,
  }

  if (tweet.user?.name) entry.author = tweet.user.name
  if (tweet.user?.profile_image_url_https) entry.icon = tweet.user.profile_image_url_https

  const media = Array.isArray(tweet.mediaDetails) ? tweet.mediaDetails[0] : undefined
  if (media?.media_url_https) entry.image = media.media_url_https

  const publishedAt = Date.parse(tweet.created_at)
  if (Number.isFinite(publishedAt)) entry.publishedAt = Math.floor(publishedAt / 1000)

  return { entries: [entry] }
}
