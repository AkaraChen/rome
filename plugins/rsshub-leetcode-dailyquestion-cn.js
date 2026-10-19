// Ported from RSSHub lib/routes/leetcode/dailyquestion-cn.ts (AGPL-3.0).
/**
 * LeetCode -- 每日一题 (Chinese).
 *
 * Same shape as the international route, against leetcode.cn, which returns a
 * translated body. Falls back to the English body when a translation is missing.
 */

export const meta = {
  id: 'rome.rsshub-leetcode-dailyquestion-cn',
  name: 'LeetCode · 每日一题',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: '读取 LeetCode 中国站每日一题',
  icon: 'https://leetcode.cn/favicon.ico'
};

const HOST = 'https://leetcode.cn'
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36'
const DIFFICULTY = { Easy: '简单', Medium: '中等', Hard: '困难' }

const DAILY_QUERY = `query questionOfToday {
  todayRecord {
    date
    question {
      frontendQuestionId: questionFrontendId
      titleSlug
    }
  }
}`

const DETAIL_QUERY = `query questionData($titleSlug: String!) {
  question(titleSlug: $titleSlug) {
    questionFrontendId
    title
    translatedTitle
    titleSlug
    content
    translatedContent
    difficulty
    topicTags {
      name
      translatedName
    }
  }
}`

async function graphql(ctx, payload) {
  const response = await ctx.fetch(`${HOST}/graphql`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
      referer: `${HOST}/`,
      'user-agent': USER_AGENT
    },
    body: payload
  })

  if (!response.ok) {
    throw new Error(`leetcode: graphql returned ${response.status} ${response.statusText}`)
  }

  let data

  try {
    data = await response.json()
  } catch (error) {
    throw new Error(`leetcode: graphql did not return JSON: ${error.message}`)
  }

  if (data?.errors) {
    throw new Error(`leetcode: graphql error: ${data.errors[0]?.message || 'unknown'}`)
  }

  return data?.data
}

export async function fetch(ctx) {
  const daily = await graphql(ctx, { query: DAILY_QUERY, variables: {} })
  const today = daily?.todayRecord?.[0]

  if (!today?.question?.titleSlug) {
    throw new Error('leetcode: the daily question query returned no question; the response shape changed')
  }

  const details = (await graphql(ctx, { query: DETAIL_QUERY, variables: { titleSlug: today.question.titleSlug } }))?.question

  if (!details) {
    throw new Error(`leetcode: question ${today.question.titleSlug} returned no details`)
  }

  const tags = (details.topicTags || []).map((tag) => tag.translatedName || tag.name)
  const difficulty = DIFFICULTY[details.difficulty] || details.difficulty || ''
  const entry = {
    id: `leetcode:${details.titleSlug}`,
    title: `${details.questionFrontendId}. ${details.translatedTitle || details.title || details.titleSlug}`,
    url: `${HOST}/problems/${details.titleSlug}/`,
    content: details.translatedContent || details.content || ''
  }

  if (difficulty) {
    entry.summary = tags.length > 0 ? `${difficulty} · ${tags.join('、')}` : difficulty
  }

  if (today.date) {
    const timestamp = Date.parse(`${today.date}T00:00:00Z`)

    if (!Number.isNaN(timestamp)) {
      entry.publishedAt = Math.floor(timestamp / 1000)
    }
  }

  return { entries: [entry], icon: 'https://leetcode.cn/favicon.ico' }
}
