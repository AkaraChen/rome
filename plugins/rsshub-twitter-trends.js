// Ported from RSSHub lib/routes/twitter/trends.ts (AGPL-3.0).
// X (Twitter) — trending topics by place.
//
// The upstream route authenticates with an app key and secret. This port uses
// the guest-token flow the web client itself uses: activate a guest session
// with the public web bearer token, then read the trends for the place. No
// account and no configured key are needed.

export const meta = {
  id: 'rome.rsshub-twitter-trends',
  name: 'X · 趋势',
  version: '1.0.0',
  apiVersion: '1',
  view: 'socialMedia',
  description: 'X 平台指定地区的热门趋势',
  icon: 'https://abs.twimg.com/favicons/twitter.3.ico',
  params: {
    fields: [
      {
        key: 'woeid',
        type: 'text',
        label: '地区 id',
        help: 'Yahoo WOEID，1 表示全球，23424856 表示日本',
        default: '1',
      },
    ],
  },
}

const BEARER = 'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA'
const ACTIVATE = 'https://api.x.com/1.1/guest/activate.json'
const TRENDS = 'https://api.x.com/1.1/trends/place.json'
// These endpoints answer 404 when no User-Agent is sent, so one is always set.
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'

async function guestToken(ctx) {
  const response = await ctx.fetch(ACTIVATE, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${BEARER}`,
      'content-type': 'application/json',
      'user-agent': UA,
    },
  })

  if (!response.ok) {
    throw new Error(`X 访客会话返回 ${response.status} ${response.statusText}`)
  }

  const payload = await response.json()
  if (!payload?.guest_token) {
    throw new Error('X 未返回访客令牌，接口可能已变化')
  }

  return payload.guest_token
}

export async function fetch(ctx) {
  const woeid = String(ctx.params.woeid || '1').trim()

  if (!/^\d+$/.test(woeid)) {
    throw new Error('地区 id 必须是数字，例如 1 表示全球')
  }

  const token = await guestToken(ctx)
  const response = await ctx.fetch(`${TRENDS}?id=${woeid}`, {
    headers: {
      authorization: `Bearer ${BEARER}`,
      'x-guest-token': token,
      accept: 'application/json',
      'user-agent': UA,
    },
  })

  if (!response.ok) {
    throw new Error(`X 趋势返回 ${response.status} ${response.statusText}`)
  }

  const payload = await response.json()
  const place = Array.isArray(payload) ? payload[0] : undefined

  if (!place || !Array.isArray(place.trends)) {
    throw new Error('X 趋势接口结构已变化')
  }

  const publishedAt = Date.parse(place.as_of)
  const entries = []

  for (const trend of place.trends) {
    if (!trend?.name || trend.promoted_content) continue

    const entry = {
      id: `twitter:trend:${woeid}:${trend.name}`,
      title: trend.name,
      url: String(trend.url || '').replace(/^http:/, 'https:'),
    }

    if (trend.tweet_volume) entry.summary = `${trend.name}（${trend.tweet_volume} 条推文）`
    if (Number.isFinite(publishedAt)) entry.publishedAt = Math.floor(publishedAt / 1000)

    entries.push(entry)
  }

  if (entries.length === 0) {
    throw new Error('X 趋势接口没有返回条目')
  }

  return { entries }
}
