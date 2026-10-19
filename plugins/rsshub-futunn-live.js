// Ported from RSSHub lib/routes/futunn/live.ts (AGPL-3.0).
// 富途牛牛快讯 — news.futunn.com/main/live。
//
// 三种语言共用同一个接口，靠 x-news-site-lang 头区分（0 国语、1 粵語、
// 2 English）。接口返回的是 JSON，正文就在列表里，不用再打开详情页。

export const meta = {
  id: 'rome.rsshub-futunn-live',
  name: '富途牛牛 · 快讯',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: '富途牛牛的实时财经快讯',
  icon: 'https://news.futunn.com/favicon.ico',
  params: {
    fields: [
      {
        key: 'lang',
        type: 'select',
        label: '语言',
        help: '快讯的语言',
        default: 'Mandarin',
        required: false,
        options: [
          { value: 'Mandarin', label: '国语' },
          { value: 'Cantonese', label: '粵語' },
          { value: 'English', label: 'English' },
        ],
      },
    ],
  },
}

const ROOT = 'https://news.futunn.com'
const LANGS = { Mandarin: 0, Cantonese: 1, English: 2 }
const LIMIT = 30

function escape(text) {
  return String(text ?? '').replace(/[&<>"]/g, (ch) => {
    if (ch === '&') return '&amp;'
    if (ch === '<') return '&lt;'
    if (ch === '>') return '&gt;'
    return '&quot;'
  })
}

function seconds(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : undefined
}

export async function fetch(ctx) {
  const lang = String(ctx.params.lang ?? 'Mandarin').trim() || 'Mandarin'

  if (!Object.prototype.hasOwnProperty.call(LANGS, lang)) {
    throw new Error(`语言 ${lang} 无效，可选 Mandarin、Cantonese、English`)
  }

  const url = `${ROOT}/news-site-api/main/get-flash-list?pageSize=${LIMIT}`

  ctx.log.debug(`futunn: GET ${url}`)

  const response = await ctx.fetch(url, {
    headers: {
      accept: 'application/json',
      'x-news-site-lang': String(LANGS[lang]),
    },
  })

  if (!response.ok) {
    throw new Error(`富途牛牛快讯返回 ${response.status} ${response.statusText}`)
  }

  const body = await response.json()
  const news = body.data?.data?.news

  if (!Array.isArray(news)) {
    throw new Error('富途牛牛快讯接口没有返回 news 数组，接口可能已经变了')
  }

  const entries = news.map((item) => {
    const text = item.content ?? ''
    // 快讯正文平时是纯文本，但带链接时会直接给一小段 HTML，那种情况原样保留。
    const content = /<[a-z][^>]*>/i.test(text) ? text : `<p>${escape(text)}</p>`

    const entry = {
      // 快讯编号在站内唯一。
      id: `futunn:live:${item.id}`,
      title: item.title || text,
      url: item.detailUrl,
      content,
    }

    const publishedAt = seconds(item.time)
    if (publishedAt !== undefined) entry.publishedAt = publishedAt

    if (Array.isArray(item.quote) && item.quote.length > 0) {
      entry.summary = item.quote.map((quote) => quote.name).filter(Boolean).join(' · ')
    }

    // flash_pic.png 是快讯的默认占位图，不是这条新闻的配图。
    if (item.pic && !item.pic.includes('flash_pic.png')) entry.image = item.pic

    const audio = Array.isArray(item.audioInfos)
      ? item.audioInfos.find((track) => track.language === lang && track.audioUrl)
      : undefined

    if (audio) entry.content += `<p><a href="${audio.audioUrl}">收听音频</a></p>`

    return entry
  })

  if (entries.length === 0) {
    throw new Error('富途牛牛快讯没有返回任何内容')
  }

  return { entries, icon: `${ROOT}/favicon.ico` }
}
